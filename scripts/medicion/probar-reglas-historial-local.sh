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
# zsh: con errexit, una falla DENTRO de una función sale sin correr el trap EXIT (dejaba
# clusters vivos en /tmp/pgrh.*). TRAPZERR sí corre: limpia y sale.
TRAPZERR() { limpiar; trap - EXIT; exit 1; }

EXCLUIR="20261005120000|20261005120100" "$REPO/scripts/medicion/reproducir-esquema-local.sh" "$PORT" "$DATA"
P=("$PGBIN/psql" -X -q -v ON_ERROR_STOP=1 -h "$DATA" -p "$PORT" -U postgres -d postgres)
q() { "${P[@]}" -At -c "$1"; }
prueba() { PGOPTIONS="-c client_min_messages=notice" "${P[@]}" -f "$SQLDIR/prueba-reglas-historial.sql" 2>&1 | sed 's/^psql:[^ ]* NOTICE:  /  /'; }

echo "== semilla de reglas existentes (antes de la migración)"; "${P[@]}" -f "$SQLDIR/semilla-reglas-previas.sql" >/dev/null
# Huella de TODO lo que el clasificador lee de las reglas existentes (la migración A no
# debe cambiar NADA de eso; la B solo el nombre).
huella() { q "select count(*) || ':' || md5(string_agg(concat_ws('|', id, patron, patron_tipo, tipo_dte, tipo_propuesto, tipo_flujo_match, confianza, activa, prioridad, veces_aplicada, receptor_nombre_default, receptor_rut_default $1), ',' order by id)) from public.clasificacion_reglas"; }
H0=$(huella ", nombre"); H0SN=$(huella "")
echo "== migración A (sola: así corre ANTES del deploy del código)"; "${P[@]}" -f "$A"
H1=$(huella ", nombre")
[[ "$H0" == "$H1" ]] || { echo "FALLA: la migración A cambió reglas existentes ($H0 → $H1)"; exit 1; }
echo "  OK: ${H0%%:*} reglas existentes idénticas tras A (patrón, tipo, confianza, activa, prioridad, nombre…)"
echo "== migración B (después del deploy)"; "${P[@]}" -f "$B"
[[ "$H0SN" == "$(huella "")" ]] || { echo "FALLA: la migración B cambió algo más que el nombre"; exit 1; }
echo "  OK: B solo cambió nombres"
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
[[ $(q "select confianza from public.clasificacion_reglas where id = '00000000-0000-4000-8000-0000000000a2'") == "0.99" ]] || { echo "FALLA: la señal no quedó en 0.99"; exit 1; }
[[ "$H0SN" == "$(huella "")" ]] || { echo "FALLA: tras el DOWN las reglas existentes no son las de antes"; exit 1; }
echo "  OK: $DESPUES reglas intactas (huella idéntica a la de antes de la migración), columnas fuera, señal en 0.99"
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
