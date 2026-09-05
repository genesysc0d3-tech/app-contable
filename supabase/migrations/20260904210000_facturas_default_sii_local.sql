-- Las facturas nacían apuntando al carril equivocado.
--
-- `facturas_emision_proveedor` tenía DEFAULT 'simpleapi', residuo de cuando ese
-- era el único carril de facturas (el CHECK ni siquiera admitía 'sii_local'
-- hasta 20260826200000). Consecuencia: TODA empresa nueva nacía con las
-- facturas en el carril que exige certificado digital delegado, y al intentar
-- emitir recibía "el contribuyente aún no cargó su certificado digital SII" —
-- un .pfx que su carril no usa. Le pasó a un cliente real el 2026-09-04 con 3
-- facturas por $420.000 detenidas.
--
-- La migración 20260901150000 creyó arreglar esto pero tocó la columna LEGACY
-- `emision_proveedor`, que el resolver no lee para facturas: fue inerte.
--
-- Seguridad del backfill: se verificó en prod que NINGUNA de las 13 empresas
-- tiene `tiene_certificado_sii = true`, o sea nadie podía estar emitiendo por
-- SimpleAPI. El carril está inerte y moverlas no interrumpe a nadie.

alter table public.empresas
  alter column facturas_emision_proveedor set default 'sii_local';

update public.empresas
   set facturas_emision_proveedor = 'sii_local'
 where facturas_emision_proveedor = 'simpleapi';
