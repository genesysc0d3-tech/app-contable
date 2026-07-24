#!/usr/bin/env bash
#
# Empaqueta la extensión "App Contable Motor Local" para subir a la Chrome Web Store.
#
# Qué hace:
#   - Usa manifest.prod.json (sin localhost) como manifest.json del paquete.
#   - Deja fuera lo de desarrollo (README, ARQUITECTURA, manifest dev, .DS_Store).
#   - Genera dist/extension/masstest-motor-local-v<version>.zip listo para subir.
#
# Uso:  bash scripts/build-extension.sh
#
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
EXT_DIR="$ROOT/extensions/sii-portal-rpa"
OUT_DIR="$ROOT/dist/extension"

if [ ! -f "$EXT_DIR/manifest.prod.json" ]; then
  echo "❌ No encuentro $EXT_DIR/manifest.prod.json"; exit 1
fi

VERSION="$(grep '"version"' "$EXT_DIR/manifest.prod.json" | head -1 | sed -E 's/.*"version"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/')"
STAGE="$(mktemp -d)/masstest-motor-local"
mkdir -p "$STAGE" "$OUT_DIR"

# Copiar el árbol de la extensión EXCLUYENDO lo de desarrollo.
( cd "$EXT_DIR" && \
  find . -type f \
    ! -name 'manifest.json' \
    ! -name 'manifest.prod.json' \
    ! -name 'README.md' \
    ! -name 'ARQUITECTURA.md' \
    ! -name '.DS_Store' \
    ! -name '*.test.js' \
    -exec sh -c 'mkdir -p "$0/$(dirname "$1")" && cp "$1" "$0/$1"' "$STAGE" {} \; )

# El manifest de producción pasa a ser el manifest.json del paquete.
cp "$EXT_DIR/manifest.prod.json" "$STAGE/manifest.json"

ZIP="$OUT_DIR/masstest-motor-local-v$VERSION.zip"
rm -f "$ZIP"
( cd "$STAGE" && zip -rq "$ZIP" . -x '*.DS_Store' )

# Copia servible por la app (público, CDN de Vercel) → botón "Descargar" en /instalar-extension.
mkdir -p "$ROOT/public/descargas"
cp "$ZIP" "$ROOT/public/descargas/masstest-motor-local.zip"

echo "✅ Paquete listo: $ZIP"
echo "   Copia pública: public/descargas/masstest-motor-local.zip"
echo "   Versión: $VERSION"
echo "   Súbelo en https://chrome.google.com/webstore/devconsole (visibilidad: No listada)."
echo "   Después setea NEXT_PUBLIC_EXTENSION_STORE_URL en Vercel con la URL de la ficha."
