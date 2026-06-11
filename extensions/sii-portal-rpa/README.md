# Motor Local SII

Extension Chrome/Chromium no publicada para probar el handshake local entre App Contable y una ventana dedicada del Portal SII.

## Instalar En Desarrollo

1. Abre `chrome://extensions`.
2. Activa `Modo desarrollador`.
3. Selecciona `Cargar descomprimida`.
4. Elige `extensions/sii-portal-rpa`.

## Estado Actual

- Responde `APP_CONTABLE_EXTENSION_PING` desde la app.
- Recibe `APP_CONTABLE_SII_BOLETA_JOB`.
- Crea una ventana popup dedicada en `https://eboleta.sii.cl/emitir/`.
- Muestra overlay de `HUMAN_REQUIRED` para login manual.
- Escanea internamente la pagina SII activa en modo solo lectura para apoyar el mapeo tecnico.
- Reporta cierre de ventana como `cancelled`.

Todavia no rellena formularios, no emite boletas y no captura PDF/folio.

## Seguridad

- No lee claves SII.
- No envia cookies SII a la app.
- No usa permisos `<all_urls>`.
- Solo opera dominios App Contable y SII declarados en `manifest.json`.
