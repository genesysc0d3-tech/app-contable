#!/bin/bash
#
# Respaldo nocturno de la base de producción de massdte.
#
# Corre en el Mac mini (encendido 24/7). Vuelca Supabase, RESTAURA el volcado
# en un Postgres local y compara los conteos: si no calzan, el respaldo se
# considera fallido aunque el archivo exista. Un volcado que nunca se restauró
# es un archivo, no un respaldo.
#
# Avisa por correo SOLO cuando algo falla. El silencio significa que anduvo.
#
set -uo pipefail

CONF="$HOME/.massdte-respaldo/config"
DEST="$HOME/Respaldos/massdte"
LOG="$HOME/.massdte-respaldo/respaldo.log"
LOCK="$HOME/.massdte-respaldo/.corriendo"
PGBIN="/opt/homebrew/opt/postgresql@17/bin"
# Instancia PROPIA de Postgres 17 solo para verificar, en un puerto aparte: no
# toca el postgresql@16 del equipo (que ocupa el 5432 y se usa para otras cosas),
# y la levanta el propio guión — así no depende de launchd ni de que alguien
# haya iniciado sesión después de un reinicio.
VERIFDIR="$HOME/.massdte-respaldo/pg17"
VERIFPORT=5433
RETENCION_DIAS=14
# Tablas cuyo conteo debe coincidir entre el origen y la restauración.
TABLAS_TESTIGO="propuestas_ia movimientos_raw documentos_subidos clasificacion_reglas empresas usuarios"

STAMP=$(date +%Y-%m-%d)
ARCHIVO="$DEST/massdte-$STAMP.sql.gz"
TMPSQL=""
DBTMP="verif_respaldo_$$"

log(){ printf '%s  %s\n' "$(date '+%F %T')" "$*" >> "$LOG"; }

# Le cuenta a la app si el respaldo anduvo, para que el panel /dev lo muestre
# sin que nadie tenga que entrar a esta máquina a leer el log.
#
# SOLO viajan banderas y un conteo: NUNCA la ruta, el proveedor, el bucket ni
# el nombre de este equipo. El panel es una página web y el respaldo es lo
# último que queda si todo lo demás se cae — una captura filtrada no puede ser
# el mapa al tesoro. Y si este aviso falla, da lo mismo: el respaldo ya está
# hecho y el correo de alerta es el canal que manda.
avisar_app(){
  [ -n "${APP_URL:-}" ] && [ -n "${CRON_SECRET:-}" ] || return 0
  curl -s -m 10 -X POST "$APP_URL/api/ops/respaldo" \
    -H "Authorization: Bearer $CRON_SECRET" \
    -H "Content-Type: application/json" \
    -d "{\"ok\":$1,\"verificado\":$2,\"tablas\":${3:-null},\"motivo\":\"${4:-}\"}" \
    -o /dev/null 2>>"$LOG" || log "aviso a la app falló (no importa: el respaldo sí se hizo)"
}

# Único punto de salida por error: avisa y termina.
morir(){
  local motivo="$1"
  log "FALLÓ: $motivo"
  avisar "$motivo"
  avisar_app false false null "$motivo"
  limpiar
  exit 1
}

limpiar(){
  [ -n "$TMPSQL" ] && rm -f "$TMPSQL"
  "$PGBIN/dropdb" -h 127.0.0.1 -p "${VERIFPORT:-5433}" --if-exists "$DBTMP" 2>/dev/null
  rm -f "$LOCK"
}

avisar(){
  local motivo="$1"
  [ -z "${RESEND_KEY:-}" ] && return 0
  local cuerpo
  cuerpo=$(printf '<p>El respaldo de la base de <b>producción</b> no se completó.</p><p><b>Motivo:</b> %s</p><p>Equipo: %s · Fecha: %s</p><p>Últimas líneas del registro:</p><pre style="background:#f4f4f5;padding:12px;border-radius:8px;font-size:12px;overflow:auto">%s</pre>' \
    "$motivo" "$(scutil --get LocalHostName 2>/dev/null || hostname)" "$(date '+%F %T')" "$(tail -12 "$LOG" 2>/dev/null | sed 's/&/\&amp;/g; s/</\&lt;/g')")
  # curl y NO python: Cloudflare le devuelve 403 a urllib (error 1010). Se
  # descubrió probando la alerta a propósito — por eso las alertas se prueban.
  local cuerpo_json
  cuerpo_json=$(python3 -c 'import json,sys; print(json.dumps({
    "from": "MassDTE <no-reply@massdte.cl>",
    "to": [sys.argv[1]],
    "subject": "El respaldo de la base FALLO",
    "html": sys.argv[2],
  }))' "$ALERTA_A" "$cuerpo")
  local codigo
  codigo=$(curl -s -o /tmp/aviso.out -w '%{http_code}' -X POST "https://api.resend.com/emails" \
    -H "Authorization: Bearer $RESEND_KEY" -H "Content-Type: application/json" \
    --data "$cuerpo_json" 2>/dev/null)
  if [ "$codigo" = "200" ]; then
    log "aviso enviado"
  else
    log "EL AVISO NO SALIO (HTTP $codigo): $(head -c 200 /tmp/aviso.out 2>/dev/null)"
  fi
}

# Levanta (o crea) la instancia de verificación. Idempotente.
asegurar_postgres_verificacion(){
  if "$PGBIN/pg_isready" -h 127.0.0.1 -p "$VERIFPORT" -q 2>/dev/null; then return 0; fi
  if [ ! -f "$VERIFDIR/PG_VERSION" ]; then
    log "creando la instancia de verificación en $VERIFDIR"
    # LC_ALL=C y --no-locale: la sesión remota llega con una configuración
    # regional que initdb no reconoce, y sin esto se niega a crear el cluster.
    LC_ALL=C "$PGBIN/initdb" -D "$VERIFDIR" -U "$(whoami)" \
      --no-locale --encoding=UTF8 >>"$LOG" 2>&1 || return 1
  fi
  # LC_ALL=C también AL ARRANCAR, no solo al crear: con una regional inválida
  # macOS vuelve multihilo al postmaster y Postgres se niega a partir
  # ("postmaster became multithreaded during startup").
  LC_ALL=C LANG=C "$PGBIN/pg_ctl" -D "$VERIFDIR" \
    -o "-p $VERIFPORT -k $VERIFDIR -c listen_addresses=127.0.0.1" \
    -l "$VERIFDIR/servidor.log" start >>"$LOG" 2>&1 || return 1
  for _ in 1 2 3 4 5 6 7 8 9 10; do
    "$PGBIN/pg_isready" -h 127.0.0.1 -p "$VERIFPORT" -q 2>/dev/null && return 0
    sleep 1
  done
  return 1
}

# ── arranque ───────────────────────────────────────────────────────────────
[ -f "$CONF" ] || { echo "sin config en $CONF"; exit 1; }
# shellcheck disable=SC1090
source "$CONF"
mkdir -p "$DEST" "$(dirname "$LOG")"

# Un candado con el PID adentro: si el proceso ya no existe, el candado es basura
# de una corrida que se murió y no debe bloquear la de hoy.
if [ -f "$LOCK" ]; then
  if kill -0 "$(cat "$LOCK" 2>/dev/null)" 2>/dev/null; then
    log "otra corrida sigue viva, salgo"; exit 0
  fi
  log "candado huérfano, lo piso"
fi
echo $$ > "$LOCK"
trap limpiar EXIT
log "== inicio =="

# ── 1. volcar ──────────────────────────────────────────────────────────────
TMPSQL=$(mktemp "/tmp/massdte-dump.XXXXXX.sql")
"$PGBIN/pg_dump" "$PGURL" --no-owner --no-privileges \
  --schema=public --schema=auth --schema=storage \
  -f "$TMPSQL" 2>>"$LOG" || morir "pg_dump devolvió error"
[ -s "$TMPSQL" ] || morir "el volcado salió vacío"
log "volcado: $(du -h "$TMPSQL" | cut -f1)"

# ── 2. verificar restaurando de verdad ─────────────────────────────────────
asegurar_postgres_verificacion || morir "no pude levantar el Postgres 17 de verificación"
"$PGBIN/createdb" -h 127.0.0.1 -p "$VERIFPORT" "$DBTMP" 2>>"$LOG" || morir "no pude crear la base de verificación"
# Restaurar contra un Postgres que no es Supabase escupe errores ESPERADOS
# (sus roles no existen acá, y 17.11 no conoce parámetros de 17.6). Se filtran
# para que un error DE VERDAD no se pierda entre el ruido conocido.
"$PGBIN/psql" -q -h 127.0.0.1 -p "$VERIFPORT" -d "$DBTMP" -v ON_ERROR_STOP=0 -f "$TMPSQL" 2>&1 >/dev/null \
  | grep -vE 'unrecognized configuration parameter|schema "public" already exists|role "(authenticated|anon|service_role|supabase[a-z_]*|postgres)" does not exist|no privileges (were|could be) granted' \
  >> "$LOG"

desajustes=""
for t in $TABLAS_TESTIGO; do
  origen=$("$PGBIN/psql" "$PGURL" -tAc "select count(*) from public.$t" 2>/dev/null || echo "x")
  copia=$("$PGBIN/psql" -h 127.0.0.1 -p "$VERIFPORT" -d "$DBTMP" -tAc "select count(*) from public.$t" 2>/dev/null || echo "x")
  if [ "$origen" != "$copia" ]; then
    desajustes="$desajustes $t(origen=$origen restaurado=$copia)"
  else
    log "  ✓ $t: $origen filas"
  fi
done
[ -n "$desajustes" ] && morir "la restauración no calza:$desajustes"
log "restauración verificada"

# ── 3. comprimir y guardar ─────────────────────────────────────────────────
gzip -c "$TMPSQL" > "$ARCHIVO" || morir "falló la compresión"
rm -f "$TMPSQL"; TMPSQL=""
log "guardado: $ARCHIVO ($(du -h "$ARCHIVO" | cut -f1))"

# ── 4. segunda copia en R2 ─────────────────────────────────────────────────
if [ -n "${R2_ACCOUNT_ID:-}" ]; then
  RCLONE_CONFIG=/dev/null \
  rclone --config /dev/null copy "$ARCHIVO" ":s3:$R2_BUCKET/respaldos-db/" \
    --s3-provider Cloudflare \
    --s3-endpoint "https://$R2_ACCOUNT_ID.r2.cloudflarestorage.com" \
    --s3-access-key-id "$R2_ACCESS_KEY_ID" \
    --s3-secret-access-key "$R2_SECRET_ACCESS_KEY" \
    --s3-no-check-bucket 2>>"$LOG" || morir "no pude subir a R2"
  log "subido a R2"
fi

# ── 5. rotar: 14 días, salvando el primero de cada mes ─────────────────────
find "$DEST" -name 'massdte-*.sql.gz' -mtime "+$RETENCION_DIAS" | while read -r viejo; do
  case "$(basename "$viejo")" in
    *-01.sql.gz) log "conservo mensual: $(basename "$viejo")" ;;
    *) rm -f "$viejo"; log "rotado: $(basename "$viejo")" ;;
  esac
done

log "== fin OK — $(ls -1 "$DEST"/massdte-*.sql.gz 2>/dev/null | wc -l | tr -d ' ') respaldos guardados =="
avisar_app true true "$(printf '%s' "$TABLAS_TESTIGO" | wc -w | tr -d ' ')"
exit 0
