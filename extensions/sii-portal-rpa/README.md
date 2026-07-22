# Motor Local SII

Extension Chrome/Chromium no publicada para probar el handshake local entre App Contable y una ventana dedicada del Portal SII.

## Instalar En Desarrollo

1. Abre `chrome://extensions`.
2. Activa `Modo desarrollador`.
3. Selecciona `Cargar descomprimida`.
4. Elige `extensions/sii-portal-rpa`.

## Estado Actual

Emite boletas electrónicas REALES end-to-end (39/41) en el Portal SII, single y en lote,
con captura de folio y persistencia de vuelta en la app. Bóveda de credenciales cifrada
con llave partida (envelope). Ver `ARQUITECTURA.md` para el flujo.

## Publicar en la Chrome Web Store

Ver `PUBLICAR.md` (textos de ficha, justificación de permisos, checklist) y
`scripts/build-extension.sh` (genera el `.zip` listo para subir con `manifest.prod.json`).

## Seguridad

- No lee claves SII.
- No envia cookies SII a la app.
- No usa permisos `<all_urls>`.
- Solo opera dominios App Contable y SII declarados en `manifest.json`.
