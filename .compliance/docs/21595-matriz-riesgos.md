# Matriz de Riesgos de Delitos — AlphaCode SpA

**Fecha:** 2026-06-25 · **Versión:** 1.0 · **Responsable:** Encargado de Prevención (Fundador)

> Identifica, por proceso, dónde puede ocurrir un delito de la Ley 21.595, su nivel y el control que lo mitiga. Actualizar al menos anualmente.

| Proceso | Delito potencial | Probabilidad | Impacto | Nivel | Control mitigante | Control técnico (id) | Estado |
|---|---|---|---|---|---|---|---|
| Facturación / tributario (núcleo) | Delito tributario (documentos falsos) | media | alto | **medio** | Emisión la autoriza y revisa el usuario; trazabilidad; sin datos falsos | — | ⚠️ |
| Acceso a sistemas/datos de clientes | Delitos informáticos | media | alto | **medio** | Aislamiento por cuenta (RLS) + logs + MFA | `sec-tenant`✅, `sec-logs`✅, `sec-mfa`⬜ | ⚠️ |
| Pagos a proveedores | Lavado / cohecho | baja | medio | bajo | Autorización + registro | `ctrl-interno` | ⚠️ |
| Contratación con el Estado | Cohecho / fraude licitaciones | muy baja | alto | bajo | No aplica hoy (sin contratación estatal) | — | ✅ |
| Gastos / reembolsos | Administración desleal | baja | bajo | bajo | Pocos gastos; revisión entre socios | `ctrl-interno` | ⚠️ |
| Contrataciones / RRHH | Conflicto de interés | baja | bajo | bajo | Declaración de conflictos | — | ⚠️ |

## Notas
- Procesos de mayor exposición: **tributario** y **acceso a datos**. Remediación principal: completar `sec-mfa` y formalizar `ctrl-interno`.
- Los controles técnicos se evalúan en `state.json` (auditoría del repo).

---
*Borrador generado con compliance-cl (pack ley-21595). No constituye asesoría legal; revisar con un abogado.*
