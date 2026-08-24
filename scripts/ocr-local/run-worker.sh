#!/bin/bash
# Arranque del worker de OCR para launchd.
#
# Toma la connection string del MISMO config del respaldo (~/.massdte-respaldo/
# config, chmod 600) en vez de duplicar el secreto en el plist. Así hay un solo
# lugar con la credencial en el mini.
export PATH="/opt/homebrew/bin:$PATH"
source "$HOME/.massdte-respaldo/config"
export DATABASE_URL="$PGURL"
cd "$HOME/massdte-ocr" || exit 1
exec node worker.mjs
