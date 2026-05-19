-- Add 'auto' to tipo_contribuyente CHECK constraint
-- Also ensures the column exists on both empresas and clientes

ALTER TABLE public.empresas
  ADD COLUMN IF NOT EXISTS tipo_contribuyente text NOT NULL DEFAULT 'auto';

ALTER TABLE public.empresas
  DROP CONSTRAINT IF EXISTS empresas_tipo_contribuyente_check;

ALTER TABLE public.empresas
  ADD CONSTRAINT empresas_tipo_contribuyente_check
  CHECK (tipo_contribuyente IN ('afecto', 'exento', 'auto'));

ALTER TABLE public.empresas
  ALTER COLUMN tipo_contribuyente SET DEFAULT 'auto';

ALTER TABLE public.clientes
  ADD COLUMN IF NOT EXISTS tipo_contribuyente text NOT NULL DEFAULT 'auto';

ALTER TABLE public.clientes
  DROP CONSTRAINT IF EXISTS clientes_tipo_contribuyente_check;

ALTER TABLE public.clientes
  ADD CONSTRAINT clientes_tipo_contribuyente_check
  CHECK (tipo_contribuyente IN ('afecto', 'exento', 'auto'));

ALTER TABLE public.clientes
  ALTER COLUMN tipo_contribuyente SET DEFAULT 'auto';
