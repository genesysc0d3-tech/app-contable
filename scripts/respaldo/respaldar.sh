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
# RUTA ABSOLUTA de rclone, no el nombre a secas: launchd no hereda el PATH de
# Homebrew, así que bajo el agente nocturno `rclone` no existe. Estuvo parchado
# a mano en el Mac mini durante dos semanas y el repo no lo sabía — la próxima
# copia del guión habría roto la subida a R2 en silencio.
RCLONE="${RCLONE:-/opt/homebrew/bin/rclone}"

# ── TLS VERIFICADO contra Supabase (2026-09-05) ────────────────────────────
# La conexión al pooler YA iba cifrada (TLS 1.3), pero sin `sslmode` libpq usa
# el modo `prefer`: cifra si puede y NO verifica el certificado del servidor.
# Contra un espía pasivo alcanza; contra alguien que se meta en el medio
# haciéndose pasar por el pooler, le entregábamos usuario y clave — y esta
# conexión se lleva la base ENTERA todas las noches.
#
# `verify-full` exige además que el certificado sea de quien dice ser. El
# pooler lo firma la CA propia de Supabase, que no está en el almacén del
# sistema, así que va fijada en un archivo al lado del config.
#
# CA raíz: "Supabase Root 2021 CA", vence 2031-04-26. Huella SHA-256:
#   80:70:25:AD:50:D4:ED:21:9D:2C:9C:7D:29:9C:00:4F:82:4E:B0:0C:F7:F6:5A:FE:F6:07:D0:7B:72:E6:CA:FA
#
# Si el archivo falta, el respaldo NO corre: preferimos una noche sin respaldo
# —que avisa por correo— antes que mandar la base entera por un canal que no
# sabemos con quién habla. Una noche se recupera; una base filtrada no.
# OJO: NO se exporta al entorno. Estas variables valen para CUALQUIER conexión
# de libpq, y el Postgres de verificación corre local sin TLS: exportarlas hizo
# que ni siquiera arrancara. Van SOLO delante de los comandos que salen a
# Supabase (el fail-closed cazó el error en la primera corrida).
CA_SUPABASE="$HOME/.massdte-respaldo/supabase-root.crt"
TLS_SUPABASE=(env PGSSLMODE=verify-full PGSSLROOTCERT="$CA_SUPABASE")
# Instancia PROPIA de Postgres 17 solo para verificar, en un puerto aparte: no
# toca el postgresql@16 del equipo (que ocupa el 5432 y se usa para otras cosas),
# y la levanta el propio guión — así no depende de launchd ni de que alguien
# haya iniciado sesión después de un reinicio.
VERIFDIR="$HOME/.massdte-respaldo/pg17"
VERIFPORT=5433
RETENCION_DIAS=14
# Tablas cuyo conteo debe coincidir entre el origen y la restauración.
TABLAS_TESTIGO="propuestas_ia movimientos_raw documentos_subidos clasificacion_reglas empresas usuarios"

# Modo A DEMANDA (`respaldar.sh --ahora`): regla del fundador 2026-09-05 — cada
# vez que se toca algo de Supabase (una migración, un borrado, un cambio de
# esquema) se hace un respaldo completo ANTES, sí o sí.
#
# Lleva la hora en el nombre a propósito: si en un mismo día se tocan tres
# cosas, el tercer respaldo no puede pisar al primero. El nocturno mantiene su
# nombre por día, que es lo que la rotación sabe leer.
AHORA=0
[ "${1:-}" = "--ahora" ] && AHORA=1

if [ "$AHORA" = "1" ]; then
  STAMP=$(date +%Y-%m-%d-%H%M)
else
  STAMP=$(date +%Y-%m-%d)
fi
ARCHIVO="$DEST/massdte-$STAMP.sql.gz"
TMPSQL=""
DBTMP="verif_respaldo_$$"

log(){ printf '%s  %s\n' "$(date '+%F %T')" "$*" >> "$LOG"; }

# Único punto de salida por error: avisa y termina.
morir(){
  local motivo="$1"
  log "FALLÓ: $motivo"
  avisar "$motivo"
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

[ -f "$CA_SUPABASE" ] || { log "sin el certificado de Supabase en $CA_SUPABASE"; avisar "Falta el certificado raíz de Supabase ($CA_SUPABASE): sin él no se verifica con quién hablamos y el respaldo no corre."; exit 1; }

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
if [ "$AHORA" = "1" ]; then log "== inicio (a demanda) =="; else log "== inicio =="; fi

# ── 1. volcar ──────────────────────────────────────────────────────────────
TMPSQL=$(mktemp "/tmp/massdte-dump.XXXXXX.sql")
"${TLS_SUPABASE[@]}" "$PGBIN/pg_dump" "$PGURL" --no-owner --no-privileges \
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
  "$RCLONE" --config /dev/null copy "$ARCHIVO" ":s3:$R2_BUCKET/respaldos-db/" \
    --s3-provider Cloudflare \
    --s3-endpoint "https://$R2_ACCOUNT_ID.r2.cloudflarestorage.com" \
    --s3-access-key-id "$R2_ACCESS_KEY_ID" \
    --s3-secret-access-key "$R2_SECRET_ACCESS_KEY" \
    --s3-no-check-bucket 2>>"$LOG" || morir "no pude subir a R2"
  log "subido a R2"
fi

# ── 4.b los ARCHIVOS al disco del mini ─────────────────────────────────────
# El volcado se lleva `storage` pero eso es la TABLA DE METADATOS: nombres,
# rutas, permisos. Los archivos en sí no viajan ahí. Sin este paso, restaurar
# dejaba una base que sabe perfectamente que existía "cartola-agosto.xlsx" en
# tal ruta, y esa ruta vacía. Para una boleta ya emitida eso es quedarse sin el
# respaldo del documento tributario.
#
# Se COPIA, nunca se sincroniza: si alguien borra un archivo arriba por error,
# la copia de acá tiene que sobrevivirlo. Un respaldo que se borra solo cuando
# el original se borra no es un respaldo.
#
# Incremental: rclone salta lo que ya está, y el Storage se baja por lista
# comparando tamaño. La primera corrida trae todo (unos 220 MB), las siguientes
# unos pocos MB.
#
# Si esto falla NO se invalida el volcado —la base es lo crítico— pero se avisa
# igual al final, porque un paso que falla en silencio es peor que no tenerlo.
ARCHIVOS_FALLIDOS=0

# R2 (PDFs emitidos, nómina del SII y los propios respaldos de la base)
if [ -n "${R2_ACCOUNT_ID:-}" ]; then
  mkdir -p "$DEST/archivos/r2"
  RCLONE_CONFIG=/dev/null \
  "$RCLONE" --config /dev/null copy ":s3:$R2_BUCKET/" "$DEST/archivos/r2/" \
    --s3-provider Cloudflare \
    --s3-endpoint "https://$R2_ACCOUNT_ID.r2.cloudflarestorage.com" \
    --s3-access-key-id "$R2_ACCESS_KEY_ID" \
    --s3-secret-access-key "$R2_SECRET_ACCESS_KEY" \
    --s3-no-check-bucket --ignore-existing 2>>"$LOG" \
    || { log "AVISO: falló la copia de R2"; ARCHIVOS_FALLIDOS=1; }
  log "R2 al día: $(find "$DEST/archivos/r2" -type f | wc -l | tr -d ' ') archivos"
fi

# Supabase Storage (cartolas e imágenes que sube el cliente). La lista sale de
# la base que ya tenemos a mano; cada objeto se baja con el service role.
if [ -n "${SUPABASE_URL:-}" ] && [ -n "${SUPABASE_SERVICE_ROLE:-}" ]; then
  mkdir -p "$DEST/archivos/storage"
  BAJADOS=0
  while IFS='|' read -r bucket ruta tam; do
    [ -z "$bucket" ] && continue
    destino="$DEST/archivos/storage/$bucket/$ruta"
    # ya está y pesa lo mismo → nada que hacer
    if [ -f "$destino" ] && [ "$(wc -c < "$destino" | tr -d ' ')" = "$tam" ]; then continue; fi
    mkdir -p "$(dirname "$destino")"
    # La ruta va CODIFICADA: los clientes suben archivos con espacios, tildes y
    # paréntesis ("BANCO ESTADO.xlsx" fue el primero que cayó). Sin esto curl
    # rechaza la URL y el archivo queda sin respaldar. Se respetan las barras:
    # son la jerarquía de carpetas, no un carácter a escapar.
    ruta_url=$(python3 -c 'import sys,urllib.parse; print(urllib.parse.quote(sys.argv[1], safe="/"))' "$ruta")
    if curl -fsS --max-time 120 \
         -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE" \
         "$SUPABASE_URL/storage/v1/object/$bucket/$ruta_url" -o "$destino" 2>>"$LOG"; then
      BAJADOS=$((BAJADOS+1))
    else
      log "AVISO: no pude bajar $bucket/$ruta"
      rm -f "$destino"
      ARCHIVOS_FALLIDOS=1
    fi
  done < <("${TLS_SUPABASE[@]}" "$PGBIN/psql" "$PGURL" -Atq -F'|' -c \
      "select bucket_id, name, coalesce((metadata->>'size')::bigint,0) from storage.objects where name is not null" 2>>"$LOG")
  log "Storage al día: $BAJADOS nuevos, $(find "$DEST/archivos/storage" -type f | wc -l | tr -d ' ') en total"
fi

# ── 5. rotar: 14 días, salvando el primero de cada mes ─────────────────────
# OJO: la rotación es SOLO de los volcados de la base y SOLO local. Ni la copia
# de R2 ni los archivos se rotan a propósito: pesan poco (unos 220 MB en total)
# y un archivo de un cliente que se borró arriba es justamente el que uno quiere
# tener de vuelta.
find "$DEST" -name 'massdte-*.sql.gz' -mtime "+$RETENCION_DIAS" | while read -r viejo; do
  case "$(basename "$viejo")" in
    # Los de a demanda (con hora en el nombre) se hicieron porque alguien iba a
    # tocar la base: ese es justo el que uno quiere de vuelta. No se rotan.
    massdte-????-??-??-????.sql.gz) log "conservo a demanda: $(basename "$viejo")" ;;
    *-01.sql.gz) log "conservo mensual: $(basename "$viejo")" ;;
    *) rm -f "$viejo"; log "rotado: $(basename "$viejo")" ;;
  esac
done

if [ "${ARCHIVOS_FALLIDOS:-0}" = "1" ]; then
  # La base quedó respaldada y verificada; lo que falló son archivos. Se avisa,
  # pero el respaldo NO se declara fallido: son dos cosas distintas y mezclarlas
  # haría que un PDF caído tape un volcado sano.
  log "== fin CON AVISOS: la base quedó bien, algún archivo no se pudo copiar =="
  avisar "La base quedó respaldada y verificada, pero algún archivo (Storage o R2) no se pudo copiar. Revisa el registro."
  exit 0
fi

log "== fin OK — $(ls -1 "$DEST"/massdte-*.sql.gz 2>/dev/null | wc -l | tr -d ' ') respaldos guardados =="
exit 0
