-- El default legacy 'mock' de emision_proveedor era andamiaje ("mock no es
-- producto"): una empresa real jamás debe nacer apuntando al simulador.
-- Las columnas nuevas (boletas/facturas) ya tienen default real y el resolver
-- las prefiere; esto alinea la legacy y las dos empresas de clientes reales
-- que nacieron con ella en 'mock'.
ALTER TABLE public.empresas ALTER COLUMN emision_proveedor SET DEFAULT 'sii_local';

UPDATE public.empresas SET emision_proveedor = 'sii_local'
WHERE id IN ('b1573127-f77e-44b1-8e99-9ecaa7747f43', '8031d3cd-a5fc-40f2-bc4c-04d62aa7d965')
  AND emision_proveedor = 'mock';
