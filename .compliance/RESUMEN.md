# Resumen de cumplimiento — AlphaCode SpA (MassDTE)

> **No es asesoría legal.** Borradores fundados en el texto oficial chileno para
> cumplir sin abogado; el abogado, cuando lo tengas, valida.
> Generado: 2026-06-25 · commit `f5338af` · sin clientes aún.

## Postura por marco

| Marco | Score | ✅ | ⚠️ | ❌ |
|---|---|---|---|---|
| **Ley 21.719** (datos personales, vigencia dic-2026) | **0.69** | 11 | 15 | 1 |
| **Ley 21.595** (delitos económicos, vigente) | **0.57** | 3 | 10 | 1 |

Lectura: **seguridad técnica fuerte; gobernanza y documentos en proceso.**

## Lo que YA cumples ✅ (lo difícil, hecho)

- **Aislamiento por cliente (RLS)** — y **probado** con test (`rls-isolation.test.ts`).
- **Cifrado** en tránsito (TLS/HSTS) y en reposo (Supabase).
- **Hashing** de contraseñas (Supabase Auth).
- **Logs/auditoría** (`cuenta_audit_events`, `ops_events`).
- **Secretos fuera del código** (tokens aislados + gate `audit:secrets`).
- **Minimización** (no se retiene PDF/XML/base64 crudo) y **privacy-by-default**.
- **IA con zero-retention** (OpenCode Go, sin entrenamiento con tus datos).

## Brechas priorizadas (lo que falta)

**Código:**
1. **Derechos ARCO** ✅ — endpoints `/api/derechos/exportar` y `/api/derechos/borrar` (anonimiza PII, conserva DTE 6 años).
2. **MFA admin** ❌ — habilitar 2FA en accesos de operador. *Última remediación de código self-service.*
3. **Activar backup** ⚠️ — tooling listo (`scripts/backup/`); encender en la Mini.
4. **Activar alertas** ⚠️ — código listo; setear `OPS_TG_*` en Vercel.

**Documentos (se generan con esta skill — próxima tanda):**
- 21.719: RAT, política de privacidad, consentimiento, **DPA**, anexo de
  transferencias, plan de brechas, EIPD, canal de derechos, registro de vulneraciones.
- 21.595: modelo de prevención de delitos, código de ética, matriz de riesgos,
  acta de encargado, reglamento de canal de denuncias.

**Gobernanza (declaración/decisión tuya):**
- Designar formalmente responsable de datos + encargado de prevención (acta).
- Capacitación, régimen disciplinario, canal de denuncias.

## Qué se resuelve solo vs. qué necesita insumo externo

- **Self-service (tú + esta skill):** todos los documentos + las remediaciones de
  código (ARCO, MFA) + activaciones (backup, alertas).
- **Necesita insumo externo (no self-service):**
  - **Firmar/aceptar los DPA** con cada proveedor (Supabase, Vercel, OpenCode,
    Telegram, Mercado Pago).
  - **Supervisión externa anual del MPD** (Ley 21.595).
  - **Abogado** (opcional, diferido hasta revenue): validar y formalizar.

## Datos pendientes en los documentos

`RUT`, `domicilio` y `correo de contacto` quedan como `[COMPLETAR]` hasta que los
tengas (empresa en formación). El resto está rellenado.

## Próximo paso

Documentos (14/14) ✅ y ARCO ✅ hechos. Queda **MFA** (última remediación de código
self-service) y luego todo es insumo humano: completar `[COMPLETAR]` (RUT,
domicilio, correo, nombre), firmar DPA, activar backup/alertas, y validación legal.
