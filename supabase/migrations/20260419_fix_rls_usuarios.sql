-- Fix RLS en tabla usuarios: la política genérica "row level via usuarios"
-- se muerde la cola porque necesita un registro en usuarios para leer usuarios.
-- Se reemplaza por SELECT por id propio. El onboarding usa service role para insert.

DROP POLICY IF EXISTS "row level via usuarios" ON public.usuarios;

CREATE POLICY "usuarios ven su propio registro" ON public.usuarios
  FOR SELECT USING (id = auth.uid());

CREATE POLICY "usuarios manage via service role only" ON public.usuarios
  FOR ALL USING (false);
