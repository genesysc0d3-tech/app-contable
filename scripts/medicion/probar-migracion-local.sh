#!/bin/zsh
# Prueba la migración 20261004140000 (foto + decisiones) en un Postgres 17 LOCAL y
# DESECHABLE en la Mac mini: initdb en un directorio temporal, puerto propio, sin
# Supabase y sin tocar ningún cluster existente. Al final lo apaga y lo borra.
#
#   ssh mini "zsh -lc 'cd <repo> && scripts/medicion/probar-migracion-local.sh'"
#
# Pasos: fixture mínimo → migración → prueba funcional (rollback) → DOWN (respalda
# y destruye) → migración de nuevo (idempotente sobre el respaldo) → prueba otra vez.
set -euo pipefail
export PGOPTIONS="-c client_min_messages=warning"
export LC_ALL=C LANG=C  # initdb/pg_ctl fallan con el locale es_CL del login

PGBIN=${PGBIN:-/opt/homebrew/opt/postgresql@17/bin}
PORT=${PORT:-55432}
REPO=$(cd "$(dirname "$0")/../.." && pwd)
MIG="$REPO/supabase/migrations/20261004140000_propuestas_foto_y_decisiones.sql"
DOWN="$REPO/supabase/migrations/20261004140000_propuestas_foto_y_decisiones_DOWN.sql"
SQLDIR="$REPO/scripts/medicion/sql"
DATA=$(mktemp -d /tmp/pgcm.XXXXXX)  # ruta corta: el socket unix tiene tope de ~100 chars

limpiar() { "$PGBIN/pg_ctl" -D "$DATA" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$DATA"; }
trap limpiar EXIT

"$PGBIN/initdb" -D "$DATA" -U postgres -A trust --locale=C -E UTF8 >/dev/null
"$PGBIN/pg_ctl" -D "$DATA" -o "-p $PORT -k $DATA -c listen_addresses=" -l "$DATA/log" -w start >/dev/null

# Guard: solo el socket local recién creado. Nunca un host remoto.
PSQL=("$PGBIN/psql" -X -q -v ON_ERROR_STOP=1 -h "$DATA" -p "$PORT" -U postgres)
"${PSQL[@]}" -c "create database medicion" >/dev/null
P=("${PSQL[@]}" -d medicion)

echo "== fixture";               "${P[@]}" -f "$SQLDIR/fixture-local-pg.sql" >/dev/null
echo "== migración";             "${P[@]}" -f "$MIG"
echo "== prueba funcional";      PGOPTIONS="-c client_min_messages=notice" "${P[@]}" -f "$SQLDIR/prueba-migracion.sql" 2>&1 | sed 's/^psql:[^ ]* NOTICE:  /  /'
echo "== verificación (lectura)"; "${P[@]}" -f "$SQLDIR/verificar-instrumentacion.sql"
echo "== medición sobre semilla sintética (es_prueba excluida)"
"${P[@]}" -f "$SQLDIR/semilla-local.sql" >/dev/null
PSQL="$PGBIN/psql" /opt/homebrew/bin/node "$REPO/scripts/medicion/medir-clasificador.mjs" \
  --db "postgresql:///medicion?host=$DATA&port=$PORT&user=postgres" --consulta ambas --sin-archivo
"${P[@]}" -c "delete from public.empresas" >/dev/null   # deja la base como antes del DOWN
echo "== DOWN";                  "${P[@]}" -f "$DOWN"
"${P[@]}" -At -c "select 'columnas orig_* tras DOWN: ' || count(*) from information_schema.columns where table_name='propuestas_ia' and column_name like 'orig_%'"
"${P[@]}" -At -c "select 'tablas de respaldo: ' || string_agg(tablename, ', ') from pg_tables where tablename like '\_respaldo\_%'"
echo "== migración otra vez (idempotente)"; "${P[@]}" -f "$MIG"; "${P[@]}" -f "$MIG"
echo "== prueba funcional otra vez"; PGOPTIONS="-c client_min_messages=notice" "${P[@]}" -f "$SQLDIR/prueba-migracion.sql" 2>&1 | grep -c "OK" | sed 's/^/  comprobaciones OK: /'
echo "== segundo DOWN: no pisa el primer respaldo"
sleep 1
"${P[@]}" -f "$DOWN"
N=$("${P[@]}" -At -c "select count(*) from pg_tables where tablename like '\_respaldo\_propuesta\_decisiones\_%'")
[[ "$N" == "2" ]] || { echo "FALLA: esperaba 2 respaldos del log, hay $N"; exit 1; }
echo "  respaldos del log tras dos DOWN: $N (OK)"
echo "LISTO"
