-- Configuracion global de la app (API keys, preferencias, etc.)
CREATE TABLE IF NOT EXISTS public.app_config (
  name text PRIMARY KEY,
  value text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.app_config ENABLE ROW LEVEL SECURITY;

-- Solo lectura para usuarios autenticados (nunca devolvemos el valor por GET)
CREATE POLICY "usuarios autenticados pueden leer app_config"
  ON public.app_config FOR SELECT
  USING (auth.role() = 'authenticated');

-- Solo service_role puede insertar/actualizar (via API route)
CREATE POLICY "service_role puede insertar app_config"
  ON public.app_config FOR INSERT
  WITH CHECK (auth.role() = 'service_role');

CREATE POLICY "service_role puede actualizar app_config"
  ON public.app_config FOR UPDATE
  USING (auth.role() = 'service_role');
