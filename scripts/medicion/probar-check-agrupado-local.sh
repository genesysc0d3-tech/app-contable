#!/bin/zsh
# Prueba la migración de la Fase 4 (Check agrupado) en un Postgres 17 LOCAL y DESECHABLE
# en la Mac mini, sobre el ESQUEMA REAL (todas las migraciones del repo). Sin Supabase,
# sin prod. Al final lo apaga y lo borra.
#
#   ssh mini "zsh -lc 'cd <repo> && scripts/medicion/probar-check-agrupado-local.sh'"
#
# Pasos: esquema real SIN la migración → UP → prueba (up) → DOWN → prueba (down: el
# CHECK sigue aceptando check_grupo, check_grupo deja de contar como mirada, nacio_lote
# respaldado y fuera) → UP dos veces (idempotente) → prueba (up) otra vez.
set -euo pipefail
export LC_ALL=C LANG=C PGOPTIONS="-c client_min_messages=warning"
PGBIN=${PGBIN:-/opt/homebrew/opt/postgresql@17/bin}
PORT=${PORT:-55434}
REPO=$(cd "$(dirname "$0")/../.." && pwd)
MIG=$REPO/supabase/migrations
UP="$MIG/20261006120000_check_agrupado.sql"; DOWN="$MIG/20261006120000_check_agrupado_DOWN.sql"
SQLDIR="$REPO/scripts/medicion/sql"
DATA=$(mktemp -d /tmp/pgca.XXXXXX)
limpiar() { "$PGBIN/pg_ctl" -D "$DATA" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$DATA"; }
trap limpiar EXIT
TRAPZERR() { limpiar; trap - EXIT; exit 1; }

EXCLUIR="20261006120000" "$REPO/scripts/medicion/reproducir-esquema-local.sh" "$PORT" "$DATA"
P=("$PGBIN/psql" -X -q -v ON_ERROR_STOP=1 -h "$DATA" -p "$PORT" -U postgres -d postgres)
q() { "${P[@]}" -At -c "$1"; }
prueba() { PGOPTIONS="-c client_min_messages=notice" "${P[@]}" -v fase="$1" -f "$SQLDIR/prueba-check-agrupado.sql" 2>&1 | sed 's/^psql:[^ ]* NOTICE:  /  /'; }

echo "== UP"; "${P[@]}" -f "$UP"
echo "== prueba (up)"; prueba up
q "update public.clasificacion_reglas set nacio_lote = gen_random_uuid() where id = (select id from public.clasificacion_reglas where empresa_id is not null limit 1)" >/dev/null || true
echo "== DOWN"; "${P[@]}" -f "$DOWN"
[[ $(q "select count(*) from pg_tables where tablename like '\_respaldo\_nacio\_lote\_%'") == 1 ]] || { echo "FALLA: sin respaldo de nacio_lote"; exit 1; }
echo "== prueba (down)"; prueba down
echo "== UP dos veces (idempotente)"; "${P[@]}" -f "$UP"; "${P[@]}" -f "$UP"
echo "== prueba (up) otra vez"; prueba up | grep -c "OK" | sed 's/^/  comprobaciones OK: /'
echo LISTO
