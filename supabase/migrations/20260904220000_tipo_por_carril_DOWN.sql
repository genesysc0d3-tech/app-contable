-- Vuelta atrás de 20260904220000_tipo_por_carril.
--
-- Las columnas son ADITIVAS y nacieron copiando `tipo_contribuyente`, así que
-- borrarlas no pierde información que no esté ya en esa columna — salvo lo que
-- el usuario haya cambiado DESPUÉS en un solo carril. Si esta vuelta atrás se
-- ejecuta con carriles ya divergentes, esa divergencia se pierde: exportarla
-- antes si importa (select id, boletas_tipo_default, facturas_tipo_default).

alter table public.empresas drop constraint if exists empresas_boletas_tipo_default_check;
alter table public.empresas drop constraint if exists empresas_facturas_tipo_default_check;
alter table public.empresas drop column if exists boletas_tipo_default;
alter table public.empresas drop column if exists facturas_tipo_default;
