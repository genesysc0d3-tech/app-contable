-- Campos para el editor ampliado de una propuesta (lo que el form de Emisión
-- Directa permite pero la propuesta no guardaba). Todos nullable/aditivos.
ALTER TABLE public.propuestas_ia ADD COLUMN IF NOT EXISTS receptor_direccion text;
ALTER TABLE public.propuestas_ia ADD COLUMN IF NOT EXISTS receptor_comuna text;
ALTER TABLE public.propuestas_ia ADD COLUMN IF NOT EXISTS medio_pago text;

COMMENT ON COLUMN public.propuestas_ia.medio_pago IS
  'Forma de pago elegida en el editor (efectivo/transferencia/etc.). Para la emisión.';
