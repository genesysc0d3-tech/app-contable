#!/bin/zsh
# Prueba las migraciones de la Fase 3 (reglas con historial + nombre sin tercero) en un
# Postgres 17 LOCAL y DESECHABLE en la Mac mini, sobre el ESQUEMA REAL (todas las
# migraciones del repo). Sin Supabase, sin prod. Al final lo apaga y lo borra.
#
#   ssh mini "zsh -lc 'cd <repo> && scripts/medicion/probar-reglas-historial-local.sh'"
#
# Pasos: esquema real SIN las 2 migraciones → semilla de reglas "existentes" →
# migración A + B → prueba funcional (rollback) → DOWN B (rearma nombres) → DOWN A
# (respalda y destruye; las filas de reglas se quedan) → A + B otra vez (dos veces:
# idempotente) → prueba otra vez → segundo DOWN A no pisa el primer respaldo.
set -euo pipefail
export LC_ALL=C LANG=C PGOPTIONS="-c client_min_messages=warning"
PGBIN=${PGBIN:-/opt/homebrew/opt/postgresql@17/bin}
PORT=${PORT:-55433}
REPO=$(cd "$(dirname "$0")/../.." && pwd)
MIG=$REPO/supabase/migrations
A="$MIG/20261005120000_reglas_con_historial.sql";       A_DOWN="$MIG/20261005120000_reglas_con_historial_DOWN.sql"
B="$MIG/20261005120100_reglas_nombre_sin_tercero.sql";  B_DOWN="$MIG/20261005120100_reglas_nombre_sin_tercero_DOWN.sql"
SQLDIR="$REPO/scripts/medicion/sql"
DATA=$(mktemp -d /tmp/pgrh.XXXXXX)
limpiar() { "$PGBIN/pg_ctl" -D "$DATA" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$DATA"; }
trap limpiar EXIT

EXCLUIR="20261005120000|20261005120100" "$REPO/scripts/medicion/reproducir-esquema-local.sh" "$PORT" "$DATA"
P=("$PGBIN/psql" -X -q -v ON_ERROR_STOP=1 -h "$DATA" -p "$PORT" -U postgres -d postgres)
q() { "${P[@]}" -At -c "$1"; }
prueba() { PGOPTIONS="-c client_min_messages=notice" "${P[@]}" -f "$SQLDIR/prueba-reglas-historial.sql" 2>&1 | sed 's/^psql:[^ ]* NOTICE:  /  /'; }

echo "== semilla de reglas existentes (antes de la migración)"; "${P[@]}" -f "$SQLDIR/semilla-reglas-previas.sql" >/dev/null
echo "== migración A + B";  "${P[@]}" -f "$A"; "${P[@]}" -f "$B"
echo "== prueba funcional"; prueba

echo "== DOWN B (rearma los nombres desde el patrón)"; "${P[@]}" -f "$B_DOWN"
N1=$(q "select nombre from public.clasificacion_reglas where id = '00000000-0000-4000-8000-0000000000a1'")
N3=$(q "select nombre from public.clasificacion_reglas where id = '00000000-0000-4000-8000-0000000000a3'")
N4=$(q "select nombre from public.clasificacion_reglas where id = '00000000-0000-4000-8000-0000000000a4'")
[[ "$N1" == "Auto: JUAN PEREZ → Exenta" && "$N3" == "Auto: PEDRO DIAZ" && "$N4" == "Arriendo oficina" ]] \
  || { echo "FALLA DOWN B: '$N1' / '$N3' / '$N4'"; exit 1; }
echo "  OK: '$N1' · '$N3' · '$N4'"

echo "== DOWN A (respalda y destruye columnas; las filas se quedan)"
ANTES=$(q "select count(*) from public.clasificacion_reglas")
"${P[@]}" -f "$A_DOWN"
DESPUES=$(q "select count(*) from public.clasificacion_reglas")
[[ "$ANTES" == "$DESPUES" ]] || { echo "FALLA: DOWN A borró reglas ($ANTES → $DESPUES)"; exit 1; }
[[ $(q "select count(*) from information_schema.columns where table_name='clasificacion_reglas' and column_name in ('estado','aprendida_bajo_marca')") == 0 ]] || { echo "FALLA: quedaron columnas"; exit 1; }
[[ $(q "select confianza from public.clasificacion_reglas where id = '00000000-0000-4000-8000-0000000000a2'") == "0.99" ]] || { echo "FALLA: la señal no volvió a 0.99"; exit 1; }
echo "  OK: $DESPUES reglas intactas, columnas fuera, señal de marca de vuelta en 0.99"
q "select 'respaldos: ' || string_agg(tablename, ', ') from pg_tables where tablename like '\_respaldo\_reglas\_historial\_%' or tablename like '\_respaldo\_regla\_soportes\_%'"

echo "== A + B otra vez (dos veces: idempotentes)"
"${P[@]}" -f "$A"; "${P[@]}" -f "$B"; "${P[@]}" -f "$A"; "${P[@]}" -f "$B"
echo "== prueba funcional otra vez"; prueba | grep -c "OK" | sed 's/^/  comprobaciones OK: /'
echo "== segundo DOWN A: no pisa el primer respaldo"
sleep 1
"${P[@]}" -f "$A_DOWN"
N=$(q "select count(*) from pg_tables where tablename like '\_respaldo\_reglas\_historial\_%'")
[[ "$N" == "2" ]] || { echo "FALLA: esperaba 2 respaldos, hay $N"; exit 1; }
echo "  respaldos tras dos DOWN: $N (OK)"
echo LISTO
