-- Downgrade Business→Pro con más empresas vinculadas que el cupo del plan.
-- Regla del fundador (2026-08-22, "como Google"): Pro = 1 empresa = 1 cuenta;
-- al bajar de Business el titular elige UNA empresa operativa, UNA SOLA VEZ.
-- Las demás salen de la interfaz. Recuperarlas = volver a Business.
--
-- Diseño (simplificado por revisión adversarial): NO hay una columna nueva de
-- "empresa operativa" que cada superficie deba recordar consultar. La elección
-- se materializa en la pieza que TODOS los chokepoints ya respetan:
-- `cuenta_empresas.activa = false` (entitlements → EMPRESA_INACTIVA, selector,
-- Telegram, metering: todo la filtra hoy). `desactivada_motivo` distingue las
-- desactivadas por downgrade (re-activables solas al volver a Business) de las
-- desactivadas por soporte (que no deben revivir con un upgrade).

alter table public.cuenta_empresas
  add column if not exists desactivada_motivo text
    check (desactivada_motivo in ('fuera_de_plan', 'soporte'));

comment on column public.cuenta_empresas.desactivada_motivo is
  'Por qué activa=false: fuera_de_plan = downgrade (se reactiva sola al volver a un plan multiempresa); soporte = decisión manual (no se reactiva sola). NULL en filas activas.';

-- Marca de "la elección única ya se consumió" (y cuándo). Se limpia al
-- reactivar un plan multiempresa (la próxima bajada vuelve a preguntar).
alter table public.cuentas
  add column if not exists empresa_operativa_elegida_at timestamptz;
