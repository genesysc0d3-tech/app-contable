# Implementation Summary

## Cambios

- Se agrego configuracion por empresa para `mock` o `baseapi`.
- Se agrego modo sandbox BaseAPI controlado desde el popup Empresa.
- Se implemento adapter server-side que usa `BASEAPI_*` sin exponer secretos al cliente.
- Se conecto `emitir-lote` para conservar el mock actual y usar BaseAPI solo cuando la empresa lo selecciona.
- Se dejo `BASEAPI_BOLETA_ENDPOINT` como override para ajustar la ruta si BaseAPI entrega un endpoint especifico de boletas 39/41.
- Se agrego metadata por boleta (`emision_proveedor`, `emision_sandbox`, `proveedor_respuesta`) para que los PDFs locales no etiqueten emisiones BaseAPI como mock.
- Se corrigio la boleta de prueba BaseAPI con `track_id=9939045780` para reflejar `baseapi/sandbox`.
- BaseAPI ahora solicita `descargar_pdf: true` y los botones Ver/Descargar usan el PDF base64 del proveedor cuando existe.
- El generador local queda reservado para boletas emitidas por mock.
- La emision por lote ahora crea tambien un registro en `documentos_subidos` para que la boleta aparezca en Agregados/Subidos.
- Se agrego backfill para la boleta de prueba BaseAPI `track_id=9939045780`.
- La emision manual de boleta unica (`emitir-boleta`) ahora usa el mismo proveedor configurado: mock o BaseAPI, guarda metadata del proveedor y crea el agregado correspondiente.
- Auditoria de visibilidad: el dashboard diario filtraba por `fecha_emision`; BaseAPI sandbox podia devolver una fecha externa. Ahora la app guarda la fecha solicitada localmente para visibilidad diaria, mantiene la respuesta BaseAPI como metadata y el dashboard tambien considera `created_at`.
- Se agrego backfill para emisiones BaseAPI recientes que no tenian documento agregado o tenian fecha de sandbox fuera del dia visible.
- Se corrigio la fecha de emision para usar `America/Santiago`; antes `toISOString().slice(0, 10)` podia guardar manana despues de las 20:00 en Chile y ocultar boletas en la mesa diaria.
- Se aplico backfill para emisiones de prueba creadas el 2026-06-02 en la noche local que habian quedado fechadas como 2026-06-03.
- Auditoria BaseAPI: el MCP en `https://baseapi.cl/api/mcp` es solo lectura y no emite/anula documentos. La documentacion REST publica de DTE Emision expone facturas 33/34, guias 52, NC/ND; `GET /api/v1/sii/dte/tipos` confirma emitibles `33,34,56,61`.
- Se retiro el default incorrecto que mandaba boletas 39/41 al endpoint `/api/v1/sii/dte/emitir/factura`; ahora BaseAPI para boletas exige `BASEAPI_BOLETA_ENDPOINT` si BaseAPI habilita un endpoint privado/custom.

## Verificacion

- `rtk tsc --noEmit`: sin errores.
- Lint focalizado en archivos core modificados: sin issues.
- `rtk npm run lint -- "src/lib/chile-date.ts" "src/app/api/intermediaria/emitir-boleta/route.ts" "src/app/api/intermediaria/emitir-lote/route.ts"`: sin errores.
- `rtk npm run lint -- "src/lib/intermediario/client.ts" "src/proxy.ts"`: sin errores.
- `rtk lint`: el lint global sigue fallando por deuda previa no relacionada.
