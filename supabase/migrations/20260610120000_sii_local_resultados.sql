-- Log persistente de resultados SII local capturados por la extensión.
-- Reemplaza el buffer en memoria del route /api/sii-local/result, que no
-- funciona en serverless multi-instancia (recover_latest era lotería:
-- solo servía si la misma instancia había atendido el POST original).
CREATE TABLE IF NOT EXISTS public.sii_local_resultados (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  job_id text,
  folio integer,
  status text NOT NULL,
  error text,
  result jsonb,
  received_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS sii_local_resultados_user_received_idx
  ON public.sii_local_resultados (user_id, received_at DESC);

ALTER TABLE public.sii_local_resultados ENABLE ROW LEVEL SECURITY;
-- Sin policies a propósito: solo el service role accede; los routes filtran por user_id.

COMMENT ON TABLE public.sii_local_resultados IS
  'Resultados de emisión SII local (extensión Chrome). Acceso exclusivo via service role. El PDF base64 se guarda censurado; la recuperación re-descarga el PDF desde su URL SII.';
