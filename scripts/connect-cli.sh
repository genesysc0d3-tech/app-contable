#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
ENV_FILE="$PROJECT_DIR/.env.local"

load_env() {
  if [[ ! -f "$ENV_FILE" ]]; then
    echo "ERROR: $ENV_FILE not found" >&2
    exit 1
  fi
  set -a
  source "$ENV_FILE"
  set +a
}

load_env

# ── GitHub ──
if [[ -n "${GITHUB_TOKEN:-}" ]]; then
  echo ">>> Configuring GitHub CLI..."
  echo "$GITHUB_TOKEN" | gh auth login --with-token
  gh auth status
else
  echo ">>> SKIP: GITHUB_TOKEN not set in .env.local"
fi

# ── Vercel ──
if [[ -n "${VERCEL_TOKEN:-}" ]]; then
  echo ">>> Configuring Vercel CLI..."
  vercel login --token "$VERCEL_TOKEN"
  vercel link --yes --project "$VERCEL_PROJECT_ID" --scope "$VERCEL_ORG_ID"
else
  echo ">>> SKIP: VERCEL_TOKEN not set in .env.local"
fi

# ── Supabase ──
if [[ -n "${SUPABASE_ACCESS_TOKEN:-}" ]]; then
  echo ">>> Configuring Supabase CLI..."
  echo "$SUPABASE_ACCESS_TOKEN" | supabase login --token-stdin
  supabase link --project-ref "$SUPABASE_PROJECT_ID"
else
  echo ">>> SKIP: SUPABASE_ACCESS_TOKEN not set in .env.local"
fi

echo ""
echo "=== DONE ==="
