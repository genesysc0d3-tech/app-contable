-- Vuelta atrás de 20260904210000_facturas_default_sii_local.
--
-- Trae las filas exactas que el UPDATE cambió (regla del fundador: la _DOWN
-- debe poder reponer lo que destruye). Estas 9 empresas estaban en 'simpleapi'
-- al 2026-09-04; el resto ya estaba en 'sii_local' o 'mock' y NO se tocó.

alter table public.empresas
  alter column facturas_emision_proveedor set default 'simpleapi';

update public.empresas
   set facturas_emision_proveedor = 'simpleapi'
 where id in (
   '76a468d2-4926-4e89-b24b-5e2a55420321',  -- Bit En SpA
   '750ae9cd-efbc-4cb7-9131-0670a28604e9',  -- E2E Test SpA
   '96d4e20e-c70f-490c-aca5-46561253feb9',  -- Empresa TEST SpA
   'bdcbd5d9-cb2e-4237-a1d3-0a9d1664718f',  -- Inmobiliaria Fica Bascur SpA
   'b1573127-f77e-44b1-8e99-9ecaa7747f43',  -- Lc Services Spa
   '3b5ee4d8-0b4c-4bdd-b4ef-11580a4155b4',  -- M & E SpA
   '8031d3cd-a5fc-40f2-bc4c-04d62aa7d965',  -- MH SOLUTIONS SPA
   'b1c8d908-744b-44cb-863d-b75dd6f1cf18',  -- persona natural
   '607ec0d9-f05b-49d3-a701-bec01dbf84b5'   -- SANDBOX MP SpA
 );
