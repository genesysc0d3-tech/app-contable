---
kind: doc
status: active
created_at: 2026-06-24
tags: [runbook, operations, bugfix, production]
---

# Runbook: arreglar un bug con clientes en producción

Objetivo: corregir sin romper lo que el cliente tiene ni perder datos.

## Regla de oro

Ni un agente ni un humano tocan prod directo. Se trabaja en rama, se verifica,
se mergea con CI verde, se observa. Cualquier cambio irreversible (migración,
borrado) lo aplica un humano.

## Antes de tocar

- [ ] Rama desde `dev` (`feature/*` o `fix/*`). Nunca en `dev`/`main`.
- [ ] Leer `docs/MEMORIA.md`; si toca planes/emisión/Telegram/gating, también
      `docs/DECISION_FINAL_PRODUCTO.txt`.
- [ ] ¿Toca zona P0? auth, RLS, pagos, emisión, locks, folios, extensión,
      OCR/IA, documentos, Telegram, soporte dev → doble cuidado + revisión senior.
- [ ] No leer `.env*`. No usar `service_role` en scripts locales contra prod.

## Durante

- [ ] Usar el guard existente en las APIs (sesión, empresa, cuenta, plan, rol).
- [ ] Nunca confiar en `empresa_id`/`cuenta_id`/`user_id`/plan/rol que vengan del
      cliente.
- [ ] No loguear crudo: xml, pdf, base64, prompts, cookies, tokens, RUT/email
      completos. Usar `recordOpsEvent` / `sanitizeOpsMetadata`.
- [ ] Cambio mínimo. No meter dependencias sin razón fuerte.

## Verificar (local, contra base de prueba)

- [ ] `npm run check:prod-readiness` (lint, test, audit:secrets, audit:safety,
      deps audit, build)
- [ ] Si toca emisión: `npm run audit:locks`
- [ ] Si toca roles/planes/Business: `npm run audit:roles`
- [ ] Si toca soporte/app-wide: `npm run audit:app`
- [ ] Si toca DB: migración ordenada + dry-run/lint de Supabase contra la base de
      PRUEBA, nunca prod.

## Desplegar

- [ ] PR a `dev`. CI verde obligatorio.
- [ ] Merge → deploy preview → revisar → recién ahí prod.
- [ ] Observar `/dev/diagnostico` y las alertas 15–30 min.

## Si algo sale mal → rollback

- **App:** Vercel → Deployments → el anterior → "Promote to Production"
  (vuelve en ~30s).
- **DB:** restaurar del backup/PITR (ver `scripts/backup/README.md`). Nunca
  "arreglar a mano" en prod sin respaldo.
- Comunicar al cliente si afectó sus datos (ver `compliance/breach-procedure.md`).

## Junior vs Senior

- **Junior:** scanners, scripts, docs, tests simples, wording, correr los gates.
- **Senior (revisión obligatoria):** auth/ownership/RLS/`service_role`,
  emisión/locks/folios/pagos/cupos, extensión/vault, diseño del rollback.
