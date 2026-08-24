# Plan de Respuesta a Brechas de Datos Personales

**Empresa:** AlphaCode SpA · **Responsable del plan:** Fundador · **Contacto:** privacidad@massdte.cl
**Plazo legal:** notificar a la Agencia **sin dilaciones indebidas** (Art. 14 sexies; la ley NO fija 72 horas — eso es estándar GDPR, no chileno). Mantener además un **registro de las vulneraciones** (ver `21719-registro-vulneraciones.md`), aunque no se notifiquen.

## Roles
- **Coordinador de incidente:** Fundador. **Equipo técnico:** Fundador + agentes/dev. **Apoyo legal:** [COMPLETAR — abogado cuando exista].

## Fase 1 — Detección y contención (0–4h)
1. Registrar fecha/hora de detección y quién detecta (alerta ops, reporte, etc.).
2. Contener: aislar sistemas, **revocar accesos y rotar credenciales** (`service_role`, tokens, passphrases).
3. Abrir bitácora del incidente (evidencia sanitizada en `artifacts/runs/`).

## Fase 2 — Evaluación (4–24h)
1. Qué datos y de cuántos titulares.
2. Riesgo para los titulares (alto / no alto).
3. Si hay proveedor involucrado (Supabase/Vercel/OpenCode/Telegram/Mercado Pago), exigirle la información.

## Fase 3 — Notificación (sin dilaciones indebidas)
1. **A la Agencia:** naturaleza, categorías y volumen, consecuencias probables, medidas, contacto.
2. **A los titulares:** cuando haya riesgo alto, y también si afecta **datos sensibles, económicos/financieros/bancarios o de niños, niñas y adolescentes** (MassDTE trata datos **financieros**, así que este supuesto aplica con frecuencia): qué pasó, qué datos, qué pueden hacer, contacto.

## Fase 4 — Cierre y mejora
Causa raíz · medidas correctivas · **agregar el test/gate que lo habría evitado** · actualizar RAT y este plan.

## Plantilla de aviso (borrador)
> El [FECHA] detectamos [DESCRIPCIÓN]. Datos afectados: [CATEGORÍAS], ~[N] titulares.
> Medidas adoptadas: [...]. Contacto: privacidad@massdte.cl.

## Prevención (ya implementado)
Backups (tooling listo), gates de secretos, `service_role` fuera de scripts de agente, guardas anti-wipe, aislamiento RLS probado, logs sanitizados, monitoreo `ops_events` + alertas. Ver `artifacts/docs/compliance/breach-procedure.md`.

---
*Borrador generado con compliance-cl (pack ley-21719). No constituye asesoría legal; revisar con un abogado.*
