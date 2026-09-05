-- Tipo tributario por CARRIL: uno para boletas y otro para facturas.
--
-- Hasta hoy `empresas.tipo_contribuyente` era uno solo para toda la empresa, y
-- decidía a la vez 39 vs 41 (boletas) y 33 vs 34 (facturas). Eso obliga a las
-- empresas MIXTAS —giro exento por un lado y afecto por otro, que existen y son
-- legítimas— a elegir una sola verdad. La app ya reconoce la mezcla (el filtro
-- "Mixta" de la pestaña Emitir), pero la configuración no la permitía.
--
-- NULL = "hereda de tipo_contribuyente". Así ninguna empresa cambia de
-- comportamiento por esta migración: el backfill copia el valor actual a los dos
-- carriles, y quien no tenga nada sigue cayendo al general.
--
-- Valores: 'afecto' | 'exento' | 'auto' (mismos que tipo_contribuyente).

alter table public.empresas
  add column if not exists boletas_tipo_default text,
  add column if not exists facturas_tipo_default text;

alter table public.empresas
  drop constraint if exists empresas_boletas_tipo_default_check;
alter table public.empresas
  add constraint empresas_boletas_tipo_default_check
  check (boletas_tipo_default is null or boletas_tipo_default in ('afecto','exento','auto'));

alter table public.empresas
  drop constraint if exists empresas_facturas_tipo_default_check;
alter table public.empresas
  add constraint empresas_facturas_tipo_default_check
  check (facturas_tipo_default is null or facturas_tipo_default in ('afecto','exento','auto'));

-- Backfill: cada empresa arranca con lo que ya tenía, en los dos carriles.
update public.empresas
   set boletas_tipo_default  = coalesce(boletas_tipo_default, tipo_contribuyente),
       facturas_tipo_default = coalesce(facturas_tipo_default, tipo_contribuyente);
