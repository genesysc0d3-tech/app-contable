-- RUT de empresa INMUTABLE una vez que existen boletas emitidas.
--
-- Diseño (fundador, 2026-08-22): el RUT del emisor es la identidad tributaria
-- de la empresa y la fuente de verdad que viaja en cada job de emisión hacia
-- la extensión (el campo RUT manual de la extensión se elimina en 0.1.8 y pasa
-- a confiar en el de la app). Esa confianza exige que el RUT no pueda cambiar
-- por debajo: el control vive en la capa insaltable (trigger), no en la UI.
--
-- Bisagra deliberada: MIENTRAS la empresa no tenga boletas emitidas, el RUT
-- se puede corregir (autoservicio para el typo detectado a tiempo). Con
-- boletas emitidas, NADIE lo cambia — ni el service role: la corrección
-- post-emisión es cirugía de soporte con humano (deshabilitar trigger en una
-- transacción manual, con auditoría).

create or replace function public.empresas_rut_inmutable()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.rut is distinct from old.rut then
    if exists (select 1 from public.boletas_emitidas b where b.empresa_id = old.id limit 1) then
      raise exception 'RUT_INMUTABLE: la empresa % ya tiene boletas emitidas en el SII; su RUT no puede cambiar. Contacta a soporte.', old.id
        using errcode = 'P0001';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_empresas_rut_inmutable on public.empresas;
create trigger trg_empresas_rut_inmutable
  before update of rut on public.empresas
  for each row
  execute function public.empresas_rut_inmutable();
