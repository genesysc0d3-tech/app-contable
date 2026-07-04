#!/usr/bin/env bash
# MassDTE restore — decrypt a backup and load it into a TARGET (disposable) DB.
# Use for: (a) the mandatory test-restore, (b) real recovery.
# It OVERWRITES the target and refuses obvious production hosts.

set -euo pipefail
export PATH="/opt/homebrew/bin:/opt/homebrew/opt/postgresql@17/bin:/usr/local/bin:/usr/local/opt/postgresql@17/bin:/usr/bin:/bin"

CONFIG="${MASSDTE_BACKUP_CONFIG:-$HOME/.massdte-backup/config.env}"
[ -f "$CONFIG" ] || { echo "Missing config file: $CONFIG"; exit 1; }
set -a; . "$CONFIG"; set +a
: "${BACKUP_PASSPHRASE:?set BACKUP_PASSPHRASE in config}"

FILE="${1:-}"; TARGET="${2:-}"
if [ -z "$FILE" ] || [ -z "$TARGET" ]; then
  cat <<'EOF'
Usage: ./restore-db.sh <encrypted-backup.fc.gpg> <target-postgres-url>

  <target-postgres-url> MUST be a disposable/empty database (your test DB or a
  fresh local one). This command OVERWRITES it.

Test-restore example (local Postgres):
  createdb massdte_restore_test
  ./restore-db.sh ~/massdte-backups/massdte-XXXX.fc.gpg \
      "postgresql://localhost/massdte_restore_test"
EOF
  exit 1
fi

# Safety: never restore over production by accident.
case "$TARGET" in
  *supabase.co*|*pooler.supabase.com*)
    echo "REFUSING: target looks like Supabase/production. Restore only into a disposable DB."
    exit 1 ;;
esac

printf 'This OVERWRITES %s\nType "restore" to continue: ' "$TARGET"
read -r ans
[ "$ans" = "restore" ] || { echo "aborted"; exit 1; }

tmp="$(mktemp -d "${TMPDIR:-/tmp}/massdte-rs.XXXXXX")"
trap 'rm -rf "$tmp"' EXIT
raw="$tmp/dump.fc"

echo "Decrypting..."
printf '%s' "$BACKUP_PASSPHRASE" | gpg --batch --yes --pinentry-mode loopback \
  --passphrase-fd 0 -o "$raw" --decrypt "$FILE"

echo "Restoring into $TARGET ..."
pg_restore --clean --if-exists --no-owner --no-privileges -d "$TARGET" "$raw"
echo "Done. Now compare row counts with the source DB to confirm the restore."
