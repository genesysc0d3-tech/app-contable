---
kind: doc
status: active
created_at: 2026-06-20
tags: [audit, devtools, playwright, massdte]
---

# Manual DevTools Audit

## Objetivo

Auditar MassDTE como usuario real sin tocar la extension SII ni el portal SII:
Chrome DevTools MCP sirve para inspeccion interactiva, Playwright reproduce el
recorrido y deja evidencia, y Lighthouse queda como medicion complementaria de
rendimiento/accesibilidad.

## Privacidad

- No escribir contrasenas, tokens, cookies, storageState ni claves en el repo.
- La sesion Playwright vive por defecto en `/tmp/e2e-state.json`.
- Screenshots van a `/tmp/massdte-audit-*` porque pueden contener datos de
  clientes.
- Los reportes en `artifacts/runs/` deben resumir hallazgos sin raw de clientes,
  XML, imagenes, responses privadas, correos completos, RUTs completos ni
  valores de cookies/localStorage.
- La extension SII, claves SII, certificados y CAF reales quedan fuera de esta
  auditoria.

## Configuracion MCP

El proyecto incluye `.mcp.json` con:

```json
{
  "mcpServers": {
    "chrome-devtools": {
      "command": "npx",
      "args": ["-y", "chrome-devtools-mcp@latest"]
    }
  }
}
```

Cuando el cliente MCP cargue esa configuracion, usar Chrome DevTools MCP para
inspeccionar Console, Network, DOM, Application, screenshots y Performance
basico. Si el MCP no esta disponible en la sesion del agente, usar
`scripts/audit-app-devtools.mjs` como recorrido verificable.

## Comandos

Captura manual de sesion Genesys:

```bash
npm run audit:app -- --capture-login --base-url=http://localhost:3001
```

Login por variables de entorno, sin escribir secretos en archivos:

```bash
AUDIT_EMAIL="genesysc0d3@gmail.com" AUDIT_PASSWORD="..." npm run audit:app -- --base-url=http://localhost:3001 --expect-dev
```

Reusar una sesion capturada:

```bash
npm run audit:app -- --base-url=http://localhost:3001 --state=/tmp/e2e-state.json --expect-dev
```

Comparar que una sesion no dev no vea el panel dev:

```bash
AUDIT_NONDEV_STATE=/tmp/e2e-nondev-state.json npm run audit:app -- --state=/tmp/e2e-state.json
```

Lighthouse complementario, solo si el paquete esta instalado localmente:

```bash
npm run audit:app -- --lighthouse
```

## Checklist DevTools Manual

1. Abrir Network con Preserve log y Disable cache.
2. Entrar como Genesys y abrir `/dev/cuentas`.
3. Revisar Console: cero `pageerror` y cero `console.error` no esperado.
4. Revisar Network: clasificar todo 4xx/5xx, redirects inesperados y requests
   fallidas.
5. Abrir detalle de cuenta desde `Detalle`.
6. Entrar con `Ver cliente` y confirmar banner `Modo soporte Genesys`.
7. Confirmar que `Volver a dev` retorna a `/dev/cuentas`.
8. En modo cliente confirmar bloqueos read-only: subir, emitir/job de emision,
   checkout y cambios/invitaciones de empresa.
9. En `/massdte` confirmar `Uso del mes`, selector de empresa cuando aplica,
   Equipo solo Business y bloqueo visual cuando existe lock activo.
10. Correr Lighthouse solo para `/massdte` y `/dev/cuentas`; no usarlo para
    validar reglas de negocio.

## Criterios De Aceptacion

- Genesys ve `/dev/cuentas` y `/dev/diagnostico`.
- Un usuario no dev no ve `Panel operador`.
- Modo cliente muestra banner, es solo lectura y permite volver al panel dev.
- Start/Pro no muestran Equipo/presencia; Business si.
- Si `/api/emision/jobs` reporta lock activo, la UI muestra emision bloqueada.
- Cero `pageerror`.
- Cero `console.error` no esperado.
- Todo 4xx/5xx queda clasificado como esperado o hallazgo.

## Formato De Reporte

Cada corrida debe crear un Markdown en `artifacts/runs/` con:

- trigger y alcance;
- base URL, origen de auth y ruta de screenshots;
- resumen de rutas visitadas;
- hallazgos ordenados por severidad;
- checks de reglas de negocio;
- errores de Console, Page Errors y Network;
- resultado Lighthouse si se ejecuto;
- validacion y timeline.

## Timeline

- 2026-06-20: se define contrato de auditoria y harness Playwright.
