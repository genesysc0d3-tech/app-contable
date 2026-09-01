-- Reversa: default legacy de vuelta a 'mock' y las 2 empresas de clientes a su
-- valor previo (ambas estaban en 'mock'). Filas afectadas por la UP: 2.
ALTER TABLE public.empresas ALTER COLUMN emision_proveedor SET DEFAULT 'mock';
UPDATE public.empresas SET emision_proveedor = 'mock'
WHERE id IN ('b1573127-f77e-44b1-8e99-9ecaa7747f43', '8031d3cd-a5fc-40f2-bc4c-04d62aa7d965');
