-- Aprender-al-clasificar: la regla recuerda el tipo_dte (39 afecta / 41 exenta)
-- que el humano decidió al resolver un movimiento en Check. En la próxima cartola,
-- cuando la regla matchea, la propuesta nace con tipo_dte persistido → el gate de
-- emisión (evaluarEmision) ve `sinDecisionHumana = false` y la manda directo a
-- "listas", sin rebotar a Check. Solo las reglas de USUARIO (empresa_id set) usan
-- este campo para auto-pasar; las reglas globales (seed, empresa_id null) siguen
-- igual (tipo_dte null → el gate decide como hoy). Aditiva y segura: nadie que no
-- se actualice la lee, y default null preserva el comportamiento previo.
ALTER TABLE public.clasificacion_reglas
  ADD COLUMN IF NOT EXISTS tipo_dte smallint;

COMMENT ON COLUMN public.clasificacion_reglas.tipo_dte IS
  'DTE recordado de una decisión humana: 39 (afecta) / 41 (exenta) / null (no forzar). Solo reglas de usuario lo persisten en la propuesta para auto-pasar a listas.';

-- Invariante reforzada: una regla GLOBAL (empresa_id null, seed tributario) NUNCA
-- lleva tipo_dte — solo las de usuario recuerdan la decisión. Sin esto, un
-- tipo_dte en una global quedaría configurado en DB pero ignorado en silencio por
-- el classifier (que solo lo propaga para reglas de usuario). Idempotente.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'clasificacion_reglas_tipo_dte_solo_usuario'
  ) THEN
    ALTER TABLE public.clasificacion_reglas
      ADD CONSTRAINT clasificacion_reglas_tipo_dte_solo_usuario
      CHECK (empresa_id IS NOT NULL OR tipo_dte IS NULL);
  END IF;
END $$;
