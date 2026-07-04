#!/usr/bin/env bash
set -euo pipefail

# ──────────────────────────────────────────────────────────────────
# Migrar repo de holaavisoapp-del a genesysc0d3
# ──────────────────────────────────────────────────────────────────
# 1. Crea .env.github con:
#
#    GH_TOKEN=ghp_tu_token_aqui
#    GH_USER=genesysc0d3
#    GH_EMAIL=tu@email.com
#
# 2. bash scripts/migrar-github.sh
# ──────────────────────────────────────────────────────────────────

ENV_FILE=".env.github"

if [ ! -f "$ENV_FILE" ]; then
  echo "[ERROR] Crea .env.github primero:"
  echo ""
  echo "  GH_TOKEN=ghp_tu_token_aqui"
  echo "  GH_USER=genesysc0d3"
  echo "  GH_EMAIL=tu@email.com"
  exit 1
fi

set -a
source "$ENV_FILE"
set +a

REPO_NAME="app-contable"

echo "=== 1. Crear repo en genesysc0d3 ==="
curl -s -X POST "https://api.github.com/user/repos" \
  -H "Authorization: token $GH_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"name\":\"$REPO_NAME\", \"private\":false, \"description\":\"App contable SaaS para Chile\"}" \
  | python3 -c "import sys,json; d=json.load(sys.stdin); print('OK:', d.get('clone_url', d.get('message','error')))"

echo ""
echo "=== 2. Cambiar remote origin ==="
git remote set-url origin "https://$GH_USER:$GH_TOKEN@github.com/$GH_USER/$REPO_NAME.git"
echo "Remote changed to: https://github.com/$GH_USER/$REPO_NAME.git"

echo ""
echo "=== 3. Pushear rama dev al nuevo repo ==="
git push -u origin dev 2>&1 || git push origin dev 2>&1

echo ""
echo "=== 4. Pushear main al nuevo repo ==="
git push -u origin main 2>&1 || git push origin main 2>&1

echo ""
echo "=== 5. Pushear todas las ramas feature ==="
for branch in $(git branch -r | grep -v HEAD | sed 's/origin\///' | grep -v main | grep -v dev); do
  if git rev-parse --verify "$branch" 2>/dev/null; then
    git push origin "$branch" 2>&1 || echo "skip $branch"
  fi
done

echo ""
echo "=== 6. Conectar Vercel al nuevo repo ==="
npx -y vercel logout --non-interactive 2>/dev/null || true
export GH_TOKEN="$GH_TOKEN"
npx -y vercel login --token "$GH_TOKEN" --non-interactive 2>&1 || true
echo "Logueate manual en Vercel Dashboard con GitHub si es necesario"

echo ""
echo "=== LISTO ==="
echo "Nuevo repo: https://github.com/$GH_USER/$REPO_NAME"
echo "Para configurar auto-deploy Vercel:"
echo "1. Ve a https://vercel.com/genesysc0d3-1037s-projects/app-contable/settings/git"
echo "2. Conecta el repo $GH_USER/app-contable"
echo "3. Production Branch: dev"
