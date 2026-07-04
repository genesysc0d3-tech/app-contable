# BaseAPI Emision De Boletas

## Objetivo

Permitir que la tanda diaria de boletas listas para emitir use un proveedor configurable sin romper el mock actual.

## Alcance

- Mantener el proveedor mock como default.
- Agregar BaseAPI como proveedor alternativo server-side.
- Usar variables `BASEAPI_*` sin leer ni exponer `.env.local`.
- Conectar la emision por lote al proveedor seleccionado.
- Agregar configuracion visible en el popup de empresa.

## Restricciones

- No tocar el flujo de revision ni carga.
- No exponer API keys al cliente.
- No eliminar el mock ni la tabla de CAF mock.
- La primera integracion BaseAPI debe soportar sandbox.

## Verificacion

- Typecheck/build o lint disponible.
- El flujo mock debe seguir funcionando si no hay configuracion BaseAPI.
