#!/usr/bin/env bash
# MassDTE database backup — encrypted pg_dump, offsite copy, alerts.
# Runs on the always-on Mac Mini via launchd. See README.md.
# Secrets are read at runtime from a chmod 600 config file OUTSIDE the repo;
# they are never written into this script nor committed.

set -euo pipefail

# launchd starts with a minimal PATH; make sure our tools resolve.
export PATH="/opt/homebrew/bin:/opt/homebrew/opt/postgresql@17/bin:/usr/local/bin:/usr/local/opt/postgresql@17/bin:/usr/bin:/bin:/usr/sbin:/sbin"

CONFIG="${MASSDTE_BACKUP_CONFIG:-$HOME/.massdte-backup/config.env}"

log() { echo "[$(TZ=America/Santiago date '+%Y-%m-%d %H:%M:%S %Z')] $*"; }

notify_fail() {
  log "FAIL: $1"
  if [ -n "${BACKUP_TG_TOKEN:-}" ] && [ -n "${BACKUP_TG_CHATID:-}" ]; then
    curl -fsS --max-time 20 "https://api.telegram.org/bot${BACKUP_TG_TOKEN}/sendMessage" \
      -d chat_id="${BACKUP_TG_CHATID}" -d text="🔴 MassDTE backup FAILED: $1" >/dev/null 2>&1 || true
  fi
  if [ -n "${BACKUP_HEALTHCHECK_URL:-}" ]; then
    curl -fsS --max-time 20 "${BACKUP_HEALTHCHECK_URL}/fail" >/dev/null 2>&1 || true
  fi
}
trap 'notify_fail "error near line $LINENO"' ERR

[ -f "$CONFIG" ] || { echo "Missing config file: $CONFIG (copy config.env.example)"; exit 1; }
set -a; . "$CONFIG"; set +a

: "${BACKUP_PGURL:?set BACKUP_PGURL in config}"
: "${BACKUP_PASSPHRASE:?set BACKUP_PASSPHRASE in config}"
BACKUP_DIR="${BACKUP_DIR:-$HOME/massdte-backups}"
KEEP_LOCAL="${KEEP_LOCAL:-28}"
PGDUMP="${BACKUP_PG_BIN:-pg_dump}"

mkdir -p "$BACKUP_DIR"
exec >>"$BACKUP_DIR/backup.log" 2>&1   # everything below is appended to the log

ts="$(date -u +%Y%m%dT%H%M%SZ)"
tmp="$(mktemp -d "${TMPDIR:-/tmp}/massdte-bk.XXXXXX")"
trap 'notify_fail "error near line $LINENO"; rm -rf "$tmp"' ERR
raw="$tmp/dump.fc"
enc="$BACKUP_DIR/massdte-${ts}.fc.gpg"

log "backup start -> $(basename "$enc")"

# 1) Dump (custom format = compressed + best for selective restore)
"$PGDUMP" --no-owner --no-privileges -Fc -f "$raw" "$BACKUP_PGURL"

# 2) Integrity: the archive must be readable, not just present
pg_restore --list "$raw" >/dev/null

size="$(stat -f%z "$raw" 2>/dev/null || stat -c%s "$raw")"
[ "$size" -gt 1000 ] || { notify_fail "dump too small ($size bytes) — aborting"; exit 1; }

# 3) Encrypt (AES-256 via gpg symmetric; passphrase via stdin, never argv)
printf '%s' "$BACKUP_PASSPHRASE" | gpg --batch --yes --pinentry-mode loopback \
  --passphrase-fd 0 --symmetric --cipher-algo AES256 -o "$enc" "$raw"

rm -rf "$tmp"
trap 'notify_fail "error near line $LINENO"' ERR
log "encrypted backup ready ($(du -h "$enc" | cut -f1))"

# 4) Offsite copy (R2 / any S3-compatible) — strongly recommended
if [ -n "${BACKUP_R2_BUCKET:-}" ] && [ -n "${BACKUP_R2_ENDPOINT:-}" ]; then
  aws s3 cp "$enc" "s3://${BACKUP_R2_BUCKET}/$(basename "$enc")" \
    --endpoint-url "$BACKUP_R2_ENDPOINT" --only-show-errors
  log "offsite copy uploaded (R2: ${BACKUP_R2_BUCKET})"
else
  log "WARNING: no offsite target set — condition #1 (offsite copy) NOT met"
fi

# 5) Local rotation: keep newest KEEP_LOCAL (bash-3.2 safe)
{ ls -1t "$BACKUP_DIR"/massdte-*.fc.gpg 2>/dev/null || true; } \
  | awk -v k="$KEEP_LOCAL" 'NR>k' \
  | while IFS= read -r old; do rm -f "$old" && log "pruned local $(basename "$old")"; done

# 6) Success signals
if [ -n "${BACKUP_HEALTHCHECK_URL:-}" ]; then
  curl -fsS --max-time 20 "${BACKUP_HEALTHCHECK_URL}" >/dev/null 2>&1 || true
fi
if [ -n "${BACKUP_TG_TOKEN:-}" ] && [ -n "${BACKUP_TG_CHATID:-}" ] && [ "${BACKUP_TG_NOTIFY_OK:-0}" = "1" ]; then
  curl -fsS --max-time 20 "https://api.telegram.org/bot${BACKUP_TG_TOKEN}/sendMessage" \
    -d chat_id="${BACKUP_TG_CHATID}" -d text="🟢 MassDTE backup OK ($(basename "$enc"))" >/dev/null 2>&1 || true
fi

trap - ERR
log "backup OK"
