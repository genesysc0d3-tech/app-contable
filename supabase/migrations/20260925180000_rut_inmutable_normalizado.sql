-- RUT inmutable: comparar RUTs NORMALIZADOS, no texto contra texto.
--
-- Incidente 2026-09-25 (LC y MH, vía Matías): "traté de poner la dirección y
-- salió RUT_INMUTABLE", "puse exento y no se guarda", "le doy a la X y sale el
-- mismo mensaje varias veces". Las dos empresas tienen el RUT guardado con
-- puntos y guion ("77.632.399-3"); el formulario de emisor lo manda limpio
-- ("776323993"); `new.rut is distinct from old.rut` veía dos textos distintos
-- → "el RUT cambió" → y como ya emitieron boletas, el trigger rechazaba TODO el
-- guardado (dirección, tipo de contribuyente, lo que fuera). El auto-guardado
-- al cerrar reintentaba y repetía el error.
--
-- Ahora el trigger compara sin puntos, guion ni espacios y con la K en
-- mayúscula: solo un RUT DISTINTO de verdad sigue bloqueado con boletas
-- emitidas (la bisagra del diseño original no cambia). Idempotente.
create or replace function public.empresas_rut_inmutable()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  rut_viejo text := regexp_replace(upper(coalesce(old.rut, '')), '[^0-9K]', '', 'g');
  rut_nuevo text := regexp_replace(upper(coalesce(new.rut, '')), '[^0-9K]', '', 'g');
begin
  if rut_viejo is distinct from rut_nuevo then
    if exists (select 1 from public.boletas_emitidas b where b.empresa_id = old.id limit 1) then
      raise exception 'RUT_INMUTABLE: la empresa % ya tiene boletas emitidas en el SII; su RUT no puede cambiar. Contacta a soporte.', old.id
        using errcode = 'P0001';
    end if;
  end if;
  return new;
end;
$$;
