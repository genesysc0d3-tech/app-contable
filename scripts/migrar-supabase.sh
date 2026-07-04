#!/usr/bin/env bash
set -euo pipefail

# ──────────────────────────────────────────────────────────────────
# Migrar a nueva cuenta de Supabase
# ──────────────────────────────────────────────────────────────────
# 1. Crea un archivo .env.setup (ya está en .gitignore) con:
#
#    SUPABASE_DB_PASSWORD=xxx           # la password que pusiste al crear el proyecto (NO la service_role key)
#    NEXT_PUBLIC_SUPABASE_URL=https://xxx.supabase.co
#    NEXT_PUBLIC_SUPABASE_ANON_KEY=xxx
#    SUPABASE_SERVICE_ROLE_KEY=xxx
#    DEV_EMAIL=tu@email.com
#    DEV_PASSWORD=tu-clave
#
# 2. Ejecuta:
#    bash scripts/migrar-supabase.sh
# ──────────────────────────────────────────────────────────────────

ENV_FILE=".env.setup"

if [ ! -f "$ENV_FILE" ]; then
  echo "[ERROR] Crea primero $ENV_FILE con las credenciales del nuevo proyecto."
  echo "        Usa esto como template (sin los corchetes):"
  echo ""
  echo "        SUPABASE_DB_PASSWORD=password_que_pusiste_al_crear_proyecto"
  echo "        NEXT_PUBLIC_SUPABASE_URL=https://xxx.supabase.co"
  echo "        NEXT_PUBLIC_SUPABASE_ANON_KEY=xxx"
  echo "        SUPABASE_SERVICE_ROLE_KEY=xxx"
  echo "        DEV_EMAIL=tu@email.com"
  echo "        DEV_PASSWORD=tu-clave"
  exit 1
fi

set -a
source "$ENV_FILE"
set +a

PROJECT_REF=$(echo "$NEXT_PUBLIC_SUPABASE_URL" | sed -E 's|https?://([^.]+)\..*|\1|')

echo "=== 1. Linkear proyecto Supabase ==="
if [ -n "${SUPABASE_DB_PASSWORD:-}" ]; then
  supabase link --project-ref "$PROJECT_REF" --password "$SUPABASE_DB_PASSWORD"
elif [ -n "${SUPABASE_ACCESS_TOKEN:-}" ]; then
  supabase link --project-ref "$PROJECT_REF"
else
  echo "[ERROR] Necesito SUPABASE_DB_PASSWORD (la del proyecto) o SUPABASE_ACCESS_TOKEN (sbp_...) en .env.setup"
  exit 1
fi

echo ""
echo "=== 2. Aplicar migrations ==="
supabase db push

echo ""
echo "=== 3. Crear usuario dev en Auth ==="
if [ -n "${DEV_EMAIL:-}" ] && [ -n "${DEV_PASSWORD:-}" ]; then
  curl -s -X POST "$NEXT_PUBLIC_SUPABASE_URL/auth/v1/admin/users" \
    -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
    -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
    -H "Content-Type: application/json" \
    -d "{\"email\":\"$DEV_EMAIL\",\"password\":\"$DEV_PASSWORD\",\"email_confirm\":true}" \
    | python3 -m json.tool
  echo "[OK] Usuario $DEV_EMAIL creado"
else
  echo "[SKIP] DEV_EMAIL / DEV_PASSWORD no definidos — creá el usuario manual en Supabase Dashboard > Authentication > Users"
fi

echo ""
echo "=== 4. Sincronizar .env.local (solo las keys de Supabase) ==="
# Reemplaza SOLO las 3 líneas de Supabase, deja el resto igual
if [[ "$OSTYPE" == "darwin"* ]]; then
  sed -i '' "s|^NEXT_PUBLIC_SUPABASE_URL=.*|NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL|" .env.local 2>/dev/null || true
  sed -i '' "s|^NEXT_PUBLIC_SUPABASE_ANON_KEY=.*|NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY|" .env.local 2>/dev/null || true
  sed -i '' "s|^SUPABASE_SERVICE_ROLE_KEY=.*|SUPABASE_SERVICE_ROLE_KEY=$SUPABASE_SERVICE_ROLE_KEY|" .env.local 2>/dev/null || true
else
  sed -i "s|^NEXT_PUBLIC_SUPABASE_URL=.*|NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL|" .env.local 2>/dev/null || true
  sed -i "s|^NEXT_PUBLIC_SUPABASE_ANON_KEY=.*|NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY|" .env.local 2>/dev/null || true
  sed -i "s|^SUPABASE_SERVICE_ROLE_KEY=.*|SUPABASE_SERVICE_ROLE_KEY=$SUPABASE_SERVICE_ROLE_KEY|" .env.local 2>/dev/null || true
fi
echo "[OK] .env.local actualizado"

echo ""
echo "=== 5. Sincronizar env vars en Vercel ==="
echo "[MANUAL] Instalá Vercel CLI y ejecutá:"
echo ""
echo "  npx vercel env add NEXT_PUBLIC_SUPABASE_URL"
echo "  npx vercel env add NEXT_PUBLIC_SUPABASE_ANON_KEY"
echo "  npx vercel env add SUPABASE_SERVICE_ROLE_KEY"
echo "  npx vercel env add MISTRAL_API_KEY"
echo "  npx vercel env add AI_PROVIDER"
echo "  npx vercel env add MISTRAL_MODEL"
echo ""
echo "O configuralo manual en https://vercel.com/holaavisoapp-del/app-contable/settings/environment-variables"

echo ""
echo "=== 6. Hacer deploy de la rama correcta ==="
echo "Ve a Vercel dashboard > app-contable > Settings > Git > Production Branch"
echo "y cámbiala de 'main' a 'dev' (o la rama que tenga la app real)."
echo "Luego hace un push a dev y se deploya solo."
echo ""
echo "=== LISTO ==="
