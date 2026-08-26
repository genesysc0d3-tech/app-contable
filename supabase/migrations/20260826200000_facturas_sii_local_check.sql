-- Carril REAL de facturas (33/34 por el Sistema de Facturación Gratuito del
-- SII, extensión sii_local): el CHECK de empresas.facturas_emision_proveedor
-- venía de la era SimpleAPI-only (20260608202426) y rechazaba 'sii_local' —
-- el toggle nuevo del paso Emisor rebotaba con "aplica las migraciones".
-- Idempotente: drop + add.

ALTER TABLE public.empresas
  DROP CONSTRAINT IF EXISTS empresas_facturas_emision_proveedor_check;

ALTER TABLE public.empresas
  ADD CONSTRAINT empresas_facturas_emision_proveedor_check
    CHECK (facturas_emision_proveedor IN ('mock', 'sii_local', 'simpleapi'));
