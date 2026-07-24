-- C2 (auditoría 2026-07-24) — RLS de `empresas` demasiado abierta.
--
-- La policy era FOR ALL (SELECT+INSERT+UPDATE+DELETE) para cualquier miembro de
-- la empresa, sin distinción de rol. Vía PostgREST con la anon key + el JWT del
-- usuario (ambos accesibles desde el navegador), un miembro podía:
--   * DELETE FROM empresas WHERE id = <su empresa>  → cascada ON DELETE que
--     destruye boletas_emitidas / documentos_tributarios REALES (folios emitidos
--     al SII; obligación legal de conservar 6 años).
--   * UPDATE ... SET trial_inicio = NULL / plan_activo = true  → resetear el
--     trial infinitas veces o activarse el plan gratis (bypass de metering/cobro).
--
-- Verificado en el código: TODA mutación legítima de `empresas` usa el SERVICE
-- ROLE (que bypassa RLS):
--   * config de la empresa  → empresa/actions.ts (createServiceClient)
--   * alta / rollback        → onboarding/actions.ts (admin)
--   * plan_activo / plan     → pagos/webhook, pagos/cron, panel dev (service)
-- Ningún flujo muta `empresas` por la sesión del usuario. Por lo tanto el rol
-- miembro (`authenticated`) solo necesita LECTURA.

DROP POLICY IF EXISTS "usuarios ven su empresa" ON public.empresas;

-- Miembros: SOLO SELECT de su propia empresa. Sin policy de INSERT/UPDATE/DELETE
-- para `authenticated` → esas operaciones quedan denegadas vía PostgREST. Las
-- operaciones legítimas siguen intactas porque van por service role (bypassa RLS).
CREATE POLICY "empresas: miembros leen su empresa" ON public.empresas
  FOR SELECT USING (
    id IN (SELECT empresa_id FROM public.usuarios WHERE id = auth.uid())
  );
