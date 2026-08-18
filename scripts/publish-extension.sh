#!/usr/bin/env bash
#
# Publica la extensión "MassDTE — Motor Local" en la Chrome Web Store por API.
#
# Qué hace:
#   1. (opcional) bump de versión en los 4 lugares que el test obliga a sincronizar.
#   2. build-extension.sh → dist/extension/massdte-motor-local-v<version>.zip
#   3. Sube el zip al ítem existente (:upload) y lo publica (:publish).
#   4. Consulta el estado del ítem para confirmar.
#
# Requiere .chromewebstore/credentials.json (gitignoreado, NUNCA en el repo):
#   { "client_id", "client_secret", "refresh_token", "publisher_id", "extension_id" }
# Cómo obtenerlos: extensions/sii-portal-rpa/PUBLICAR.md (sección API).
#
# Uso:
#   bash scripts/publish-extension.sh                # publica la versión actual del manifest
#   bash scripts/publish-extension.sh 0.1.6          # bump a 0.1.6 + build + publicar
#   DRY_RUN=1 bash scripts/publish-extension.sh      # solo build + verificación de token, no sube
#
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CREDS="$ROOT/.chromewebstore/credentials.json"
EXT_DIR="$ROOT/extensions/sii-portal-rpa"

if [ ! -f "$CREDS" ]; then
  echo "❌ Falta $CREDS — ver PUBLICAR.md (sección API) para generarlo."; exit 1
fi
command -v jq >/dev/null || { echo "❌ Necesito jq (brew install jq)."; exit 1; }

# --- 1) bump opcional --------------------------------------------------------
NEW_VERSION="${1:-}"
if [ -n "$NEW_VERSION" ]; then
  if ! [[ "$NEW_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    echo "❌ Versión inválida: $NEW_VERSION (esperado X.Y.Z)"; exit 1
  fi
  echo "→ Bump a $NEW_VERSION en los 4 archivos sincronizados"
  perl -pi -e "s/\"version\":\\s*\"[0-9.]+\"/\"version\": \"$NEW_VERSION\"/" "$EXT_DIR/manifest.json" "$EXT_DIR/manifest.prod.json"
  perl -pi -e "s/EXTENSION_VERSION = \"[0-9.]+\"/EXTENSION_VERSION = \"$NEW_VERSION\"/" "$EXT_DIR/modules/core.js"
  perl -pi -e "s/EXTENSION_VERSION_ACTUAL = \"[0-9.]+\"/EXTENSION_VERSION_ACTUAL = \"$NEW_VERSION\"/" "$ROOT/src/lib/extension.ts"
fi

VERSION="$(grep '"version"' "$EXT_DIR/manifest.prod.json" | head -1 | sed -E 's/.*"version"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/')"

# --- 2) build ----------------------------------------------------------------
echo "→ Build v$VERSION"
bash "$ROOT/scripts/build-extension.sh" >/dev/null
ZIP="$ROOT/dist/extension/massdte-motor-local-v$VERSION.zip"
[ -f "$ZIP" ] || { echo "❌ No se generó $ZIP"; exit 1; }
# sanity: el zip trae la versión que dice
ZIP_VER="$(unzip -p "$ZIP" manifest.json | jq -r .version)"
[ "$ZIP_VER" = "$VERSION" ] || { echo "❌ El zip dice v$ZIP_VER pero esperaba v$VERSION"; exit 1; }
echo "  ✓ $ZIP"

# --- 3) token ----------------------------------------------------------------
CLIENT_ID="$(jq -r .client_id "$CREDS")"
CLIENT_SECRET="$(jq -r .client_secret "$CREDS")"
REFRESH_TOKEN="$(jq -r .refresh_token "$CREDS")"
PUBLISHER_ID="$(jq -r .publisher_id "$CREDS")"
EXTENSION_ID="$(jq -r .extension_id "$CREDS")"
for v in CLIENT_ID CLIENT_SECRET REFRESH_TOKEN PUBLISHER_ID EXTENSION_ID; do
  [ -n "${!v}" ] && [ "${!v}" != "null" ] || { echo "❌ credentials.json: falta $v"; exit 1; }
done

echo "→ Obteniendo access token"
TOKEN_JSON="$(curl -sS -X POST https://oauth2.googleapis.com/token \
  -d client_id="$CLIENT_ID" -d client_secret="$CLIENT_SECRET" \
  -d refresh_token="$REFRESH_TOKEN" -d grant_type=refresh_token)"
ACCESS_TOKEN="$(echo "$TOKEN_JSON" | jq -r '.access_token // empty')"
if [ -z "$ACCESS_TOKEN" ]; then
  echo "❌ No pude obtener access token:"; echo "$TOKEN_JSON" | jq -r '.error_description // .error // .'; exit 1
fi
echo "  ✓ token OK"

if [ "${DRY_RUN:-0}" = "1" ]; then
  echo "DRY_RUN=1 → no subo ni publico. Build y token verificados."; exit 0
fi

# API v1.1 (www.googleapis.com/chromewebstore/v1.1): es la que responde para este
# publisher (verificado 2026-08-17: GET item → 200 con crxVersion). La v2
# (chromewebstore.googleapis.com/v2/publishers/{id}/items/{id}:fetchStatus) devolvía
# 404 HTML para este proyecto; si algún día v1.1 deja de responder, migrar a v2:
#   POST /upload/v2/publishers/{pub}/items/{id}:upload   (zip como body)
#   POST /v2/publishers/{pub}/items/{id}:publish          (body JSON opcional)
#   GET  /v2/publishers/{pub}/items/{id}:fetchStatus
BASE="https://www.googleapis.com"
HDR_VER="x-goog-api-version: 2"

# --- 4) upload ---------------------------------------------------------------
echo "→ Subiendo v$VERSION al ítem $EXTENSION_ID"
UP="$(curl -sS -X PUT "$BASE/upload/chromewebstore/v1.1/items/$EXTENSION_ID" \
  -H "Authorization: Bearer $ACCESS_TOKEN" -H "$HDR_VER" \
  -H "Content-Type: application/zip" \
  --data-binary @"$ZIP")"
if echo "$UP" | jq -e '.error' >/dev/null 2>&1; then
  echo "❌ Upload falló:"; echo "$UP" | jq .; exit 1
fi
UP_STATE="$(echo "$UP" | jq -r '.uploadState // "?"')"
echo "  uploadState=$UP_STATE  itemError=$(echo "$UP" | jq -c '.itemError // []')"
if [ "$UP_STATE" != "SUCCESS" ] && [ "$UP_STATE" != "IN_PROGRESS" ]; then
  echo "❌ Upload no exitoso ($UP_STATE). No publico."; echo "$UP" | jq .; exit 1
fi

# --- 5) publish --------------------------------------------------------------
# publishTarget=default publica al canal público del ítem; la visibilidad (no
# listada) es la configurada en la ficha y NO cambia por esta llamada.
echo "→ Publicando (mantiene la visibilidad configurada en la ficha: no listada)"
PUB="$(curl -sS -X POST "$BASE/chromewebstore/v1.1/items/$EXTENSION_ID/publish?publishTarget=default" \
  -H "Authorization: Bearer $ACCESS_TOKEN" -H "$HDR_VER" \
  -H "Content-Length: 0")"
if echo "$PUB" | jq -e '.error' >/dev/null 2>&1; then
  echo "❌ Publish falló:"; echo "$PUB" | jq .; exit 1
fi
echo "  status=$(echo "$PUB" | jq -c '.status // []')  detail=$(echo "$PUB" | jq -c '.statusDetail // []')"

# --- 6) estado ---------------------------------------------------------------
echo "→ Estado del ítem"
curl -sS "$BASE/chromewebstore/v1.1/items/$EXTENSION_ID?projection=DRAFT" \
  -H "Authorization: Bearer $ACCESS_TOKEN" -H "$HDR_VER" | jq -c 'del(.publicKey)' 2>/dev/null || true

echo "✅ v$VERSION enviada. Google la revisa y la publica sola (no listada); los usuarios se auto-actualizan."
echo "   Recuerda commitear el bump (manifests + core.js + extension.ts + public/descargas/*.zip)."
