# scripts/

Utilidades de MassDTE. Regla base: **nada destructivo corre contra producción
sin guardia explícita**, y los secretos se leen de archivos gitignored, nunca
hardcodeados ni impresos.

## Gates de calidad / seguridad

| Comando | Qué hace |
|---|---|
| `npm run audit:secrets` | Busca secretos en archivos trackeados (no imprime valores) |
| `npm run audit:safety` | Patrones de riesgo MassDTE (service-role-in-client bloquea) |
| `npm run check:prod-readiness` | Corre lint, test, audit:secrets, audit:safety, deps audit, build |
| `npm run audit:app` | Auditoría DevTools de soporte/app-wide (requiere sesión) |
| `npm run audit:roles` | Matriz Start/Pro/Business (requiere sesión) |
| `npm run audit:locks` | Lock de emisión por cuenta (requiere sesión) |

## Backups

`scripts/backup/` — respaldo cifrado de la base (pg_dump → cifrado → offsite),
para correr en la Mac Mini. Ver `scripts/backup/README.md`.

## Limpieza de datos (¡con guardia!)

| Script | Comportamiento |
|---|---|
| `reset-db.js` (`npm run cb4w`) | Borra tablas de prueba. **Se niega contra producción** salvo `MASSDTE_ALLOW_PROD_WIPE=1` + confirmación `WIPE PROD` |
| `reset-completo.sql` | **Dry-run por defecto** (`ROLLBACK`); cambiar a `COMMIT` para aplicar |
| `limpiar-test.sql` | **Dry-run por defecto**; preserva aprendizaje y boletas reales |
| `limpiar-test-storage.mjs` | Limpia objetos de Storage de prueba |

Para datos de prueba, preferir el **simulador (staging)**, no producción
(ver `reference_supabase_project` en memoria).

## SII / emisión / dev (no tocar sin contexto)

`sii-*.mjs`, `app-login.mjs`, `login-capture.mjs`, `connect-cli.sh`,
`supabase-local-token.sh`, `migrar-*.sh`, `p2p-journey.mjs`, `r2-test.mjs`,
`visual-pass.mjs` — tooling de exploración/operación. Varios usan el perfil
Playwright/Chrome local; no lanzar headless sobre el perfil compartido.

## Credenciales

Tokens locales y aislados (`.git/.git-credentials-local`, `.vercel/token`,
`.supabase/token`, `.env.github`). Ver `reference_isolated_credentials` en
memoria. Para pushes que tocan `.github/workflows` se necesita el `GH_TOKEN` de
`.env.github` (tiene scope `workflow`).
