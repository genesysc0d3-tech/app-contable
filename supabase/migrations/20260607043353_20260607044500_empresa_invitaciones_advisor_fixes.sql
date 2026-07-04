-- Ajustes post-advisor para empresa_invitaciones.
-- Mantiene el modelo de fase 1 y evita warnings nuevos de performance.

CREATE INDEX IF NOT EXISTS idx_empresa_invitaciones_invited_by
  ON public.empresa_invitaciones (invited_by)
  WHERE invited_by IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_empresa_invitaciones_accepted_by
  ON public.empresa_invitaciones (accepted_by)
  WHERE accepted_by IS NOT NULL;

DROP POLICY IF EXISTS "miembros leen empresa invitaciones" ON public.empresa_invitaciones;
CREATE POLICY "miembros leen empresa invitaciones" ON public.empresa_invitaciones
  FOR SELECT USING (
    empresa_id IN (
      SELECT u.empresa_id
      FROM public.usuarios u
      WHERE u.id = (SELECT auth.uid())
    )
  );
