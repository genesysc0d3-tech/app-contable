-- Vuelta atrás de 20260925180000_rut_inmutable_normalizado: la función vuelve a
-- comparar texto contra texto (versión de 20260822090000_rut_inmutable.sql).
-- Lo que destruye: nada de datos; vuelve el falso positivo para empresas con
-- RUT guardado con puntos/guion.
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
