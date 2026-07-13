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
