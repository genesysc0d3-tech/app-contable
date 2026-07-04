-- F1: la quilla del modelo multi-fuente. Una TRANSACCIÓN (hecho económico) puede
-- tener VARIOS movimientos (fuentes) apuntándola → 1 boleta por transacción.
--
-- ADITIVO Y SEGURO: nada lee transaccion_id todavía. La asignación + el cruce son
-- F3 (motor de correlación). Hasta entonces transaccion_id queda null.
CREATE TABLE IF NOT EXISTS public.transacciones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  monto_clp numeric NOT NULL,                 -- monto del hecho (sigue a la plata)
  fecha date NOT NULL,
  hora time,                                   -- nullable: no toda fuente la trae
  contraparte text,
  -- abierta: 1 fuente, sin cruzar · confirmada: cruce confiable/humano · por_revisar: ambiguo
  estado text NOT NULL DEFAULT 'abierta' CHECK (estado IN ('abierta', 'confirmada', 'por_revisar')),
  movimiento_ancla_id uuid,                    -- el movimiento "cash" que fija el monto de la boleta
  correlacionada_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_transacciones_empresa_estado ON public.transacciones (empresa_id, estado);
-- clave del matching (F3): barrido por empresa + fecha + monto
CREATE INDEX IF NOT EXISTS idx_transacciones_match ON public.transacciones (empresa_id, fecha, monto_clp);
-- RLS on, sin policy pública por ahora (solo service role; la lectura cliente se
-- agrega en F4 cuando la mesa muestre transacciones). Deny-by-default = seguro.
ALTER TABLE public.transacciones ENABLE ROW LEVEL SECURITY;

-- La N:1 vive acá: muchos movimientos → una transacción.
ALTER TABLE public.movimientos_raw
  ADD COLUMN IF NOT EXISTS transaccion_id uuid REFERENCES public.transacciones(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_mov_transaccion ON public.movimientos_raw (transaccion_id);

-- La propuesta también apunta a la transacción (1 propuesta emitible por transacción).
ALTER TABLE public.propuestas_ia
  ADD COLUMN IF NOT EXISTS transaccion_id uuid REFERENCES public.transacciones(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_prop_transaccion ON public.propuestas_ia (transaccion_id);
