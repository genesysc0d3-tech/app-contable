-- Paso P — persiste la DECISIÓN HUMANA del tipo de boleta tomada en Check,
-- para que la cola de Emitir la lea en vez de re-adivinarla (única fuente de
-- verdad). NULL = sin decisión humana explícita → la cola aplica su gate de
-- confianza (motor emision-decision.ts). Columna aditiva y nullable: el código
-- degrada con gracia mientras no esté aplicada.

ALTER TABLE public.propuestas_ia
  ADD COLUMN IF NOT EXISTS tipo_dte smallint;

ALTER TABLE public.propuestas_ia
  DROP CONSTRAINT IF EXISTS propuestas_ia_tipo_dte_check;
ALTER TABLE public.propuestas_ia
  ADD CONSTRAINT propuestas_ia_tipo_dte_check
  CHECK (tipo_dte IS NULL OR tipo_dte IN (39, 41, 61));

COMMENT ON COLUMN public.propuestas_ia.tipo_dte IS
  'Decisión humana del tipo de DTE (39 afecta / 41 exenta / 61 NC) tomada en Check. NULL = sin decisión explícita; la cola aplica su gate de confianza.';
