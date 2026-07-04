#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TOKEN_FILE="$ROOT_DIR/.supabase/token"
WORK_DIR="/private/tmp/app-contable-supabase-work-$$"

if [[ ! -s "$TOKEN_FILE" ]]; then
  echo "Missing local Supabase token at .supabase/token" >&2
  exit 1
fi

if [[ $# -lt 2 ]]; then
  echo "Usage: $0 <migration list|db pull|db push|db lint|db dump|inspect db|gen types> [args...]" >&2
  exit 2
fi

case "$1 $2" in
  "migration list"|"db pull"|"db push"|"db lint"|"db dump"|"inspect db"|"gen types") ;;
  *)
    echo "Command not allowed by local wrapper: $*" >&2
    exit 2
    ;;
esac

cleanup() {
  rm -rf "$WORK_DIR"
}
trap cleanup EXIT

mkdir -p "$WORK_DIR"
ln -s "$ROOT_DIR/supabase" "$WORK_DIR/supabase"

export SUPABASE_ACCESS_TOKEN
SUPABASE_ACCESS_TOKEN="$(cat "$TOKEN_FILE")"

cd "$WORK_DIR"
exec supabase "$@"
