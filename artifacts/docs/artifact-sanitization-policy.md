---
kind: doc
status: active
created_at: 2026-06-25
tags: [artifacts, sanitization, security, policy]
---

# Política de sanitización de artifacts

Los artifacts (`artifacts/runs`, `docs`, `signals`, `tasks`) son versionados y/o
locales. **Nunca** deben contener secretos, datos crudos de clientes, ni rutas
personales absolutas.

## Prohibido en cualquier artifact

- Tokens, claves, cookies, `service_role`, passphrases, `GH_TOKEN`.
- Certificados, CAF, PFX, claves privadas.
- XML/PDF/base64 de documentos reales; cartolas; OCR/prompts/responses crudos.
- RUT o email completos de clientes reales (enmascarar: `12.xxx.xxx-x`).
- URLs internas completas con IDs largos.
- **Rutas personales absolutas** (`/Users/<usuario>/...`, perfiles Chrome,
  storage states).

## Requerido al escribir un artifact

- Rutas relativas o marcadores: `<repo>`, `<home>`, no `/Users/take/...`.
- Resumir evidencia, no pegar payloads crudos.
- Enmascarar identificadores; mantener solo lo no sensible.

## Cómo se hace cumplir

- `npm run audit:secrets` bloquea secretos en archivos trackeados (reporta
  `archivo:línea:tipo`, nunca el valor).
- `.gitignore`: `/artifacts/*` ignora todo salvo `README.md`, `signals/`,
  `tasks/`, `docs/`, `runs/` (`.md`). Cualquier otro archivo bajo `artifacts/`
  (p.ej. `artifacts/playwright-auth/**`, storage states) **no se commitea**.
- `audit:safety` marca logs con datos sensibles.

## Si un artifact ya filtró algo

- Secreto real → quitar, **rotar** la credencial, no solo borrar el archivo
  (queda en el historial). Ver `compliance/breach-procedure.md`.
- Ruta personal → sanitizar el archivo actual (`/Users/<user>/...` → `<home>`).
  El historial con rutas absolutas es severidad baja (no secreto), no requiere
  reescritura de historia.
