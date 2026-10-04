#!/bin/zsh
# Reproduce el esquema REAL (todas las migraciones del repo, sin _DOWN) en un
# Postgres 17 local desechable de la Mac mini, sobre stubs mínimos de Supabase.
# El historial del repo no es reproducible 100% en orden estricto (hay migraciones
# aplicadas a mano fuera de orden), así que va en PASADAS: cada archivo en su propia
# transacción (-1); lo que falla se reintenta en la pasada siguiente hasta que no
# haya progreso. Imprime lo que nunca entró.
#
#   reproducir-esquema-local.sh <puerto> <dir-datos>   (deja el cluster ARRIBA; el llamador lo baja)
#   EXCLUIR="20261004160000"  → migraciones a dejar fuera (p. ej. la que se va a probar)
set -uo pipefail
export LC_ALL=C LANG=C PGOPTIONS="-c client_min_messages=error"
PGBIN=${PGBIN:-/opt/homebrew/opt/postgresql@17/bin}
PORT=$1; DATA=$2
REPO=$(cd "$(dirname "$0")/../.." && pwd)
"$PGBIN/initdb" -D "$DATA" -U postgres -A trust --locale=C -E UTF8 >/dev/null
"$PGBIN/pg_ctl" -D "$DATA" -o "-p $PORT -k $DATA -c listen_addresses= -c wal_level=logical" -l "$DATA/log" -w start >/dev/null
P=("$PGBIN/psql" -X -q -v ON_ERROR_STOP=1 -h "$DATA" -p "$PORT" -U postgres -d postgres)
"${P[@]}" -f "$REPO/scripts/medicion/sql/stubs-supabase-local.sql" >/dev/null
pend=($(ls "$REPO"/supabase/migrations/*.sql | grep -v _DOWN | grep -v -E "${EXCLUIR:-^$}" \
  | awk -F/ '{n=$NF; split(n,a,"_"); v=a[1]; while (length(v)<14) v=v"0"; print v" "$0}' | sort | cut -d" " -f2))
total=${#pend}
for pasada in 1 2 3 4 5 6; do
  fallan=()
  for f in $pend; do "${P[@]}" -1 -f "$f" >/dev/null 2>&1 || fallan+=("$f"); done
  (( ${#fallan} == ${#pend} )) && break
  pend=($fallan)
  (( ${#pend} == 0 )) && break
done
echo "esquema real: $((total - ${#pend}))/$total migraciones aplicadas"
for f in $pend; do echo "  NO ENTRÓ: $(basename $f): $("${P[@]}" -1 -f "$f" 2>&1 | grep -m1 ERROR)"; done
