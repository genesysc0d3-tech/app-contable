-- Preparacion multiusuario: invitaciones por empresa sin cambiar el modelo
-- actual usuarios.empresa_id. Esto permite sumar usuarios a una empresa antes
-- de migrar a membresias multiempresa.

CREATE TABLE IF NOT EXISTS public.empresa_invitaciones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  email text NOT NULL,
  rol text NOT NULL DEFAULT 'contador' CHECK (rol IN ('owner', 'admin', 'contador', 'viewer')),
  token_hash text NOT NULL UNIQUE,
  estado text NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente', 'aceptada', 'revocada', 'expirada')),
  invited_by uuid REFERENCES public.usuarios(id) ON DELETE SET NULL,
  accepted_by uuid REFERENCES public.usuarios(id) ON DELETE SET NULL,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '7 days'),
  accepted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_empresa_invitaciones_empresa_estado
  ON public.empresa_invitaciones (empresa_id, estado, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_empresa_invitaciones_email_estado
  ON public.empresa_invitaciones (lower(email), estado);

CREATE UNIQUE INDEX IF NOT EXISTS idx_empresa_invitaciones_pendiente_unica
  ON public.empresa_invitaciones (empresa_id, lower(email))
  WHERE estado = 'pendiente';

ALTER TABLE public.empresa_invitaciones ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "empresa invitaciones via usuarios" ON public.empresa_invitaciones;
DROP POLICY IF EXISTS "miembros leen empresa invitaciones" ON public.empresa_invitaciones;
CREATE POLICY "miembros leen empresa invitaciones" ON public.empresa_invitaciones
  FOR SELECT USING (
    empresa_id IN (SELECT empresa_id FROM public.usuarios WHERE id = auth.uid())
  );

-- No hay policies INSERT/UPDATE/DELETE para usuarios autenticados. Las
-- escrituras pasan por server actions con service role y validacion de rol.
REVOKE SELECT ON public.empresa_invitaciones FROM authenticated;
GRANT SELECT (
  id,
  empresa_id,
  email,
  rol,
  estado,
  invited_by,
  accepted_by,
  expires_at,
  accepted_at,
  created_at
) ON public.empresa_invitaciones TO authenticated;
