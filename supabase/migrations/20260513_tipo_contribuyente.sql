ALTER TABLE public.clientes
  ADD COLUMN IF NOT EXISTS tipo_contribuyente text NOT NULL DEFAULT 'afecto'
  CHECK (tipo_contribuyente IN ('afecto', 'exento'));
