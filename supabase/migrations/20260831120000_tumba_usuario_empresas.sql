-- TUMBA de usuario_empresas (autorizada por el fundador el 2026-08-31).
--
-- Era el sobreviviente del primer diseño multiempresa (jun-2026): conectar
-- persona → empresa directo, sin pasar por la cuenta. Ese diseño se abandonó a
-- mitad de camino — ganó el modelo de la cuenta pagadora (cuenta_usuarios +
-- cuenta_empresas, del que hoy cuelga TODO el RLS) — pero la tabla quedó, y
-- cuatro lugares del código le siguieron escribiendo por costumbre.
--
-- Medido en producción antes de escribir esto: 10 filas, CERO policies que la
-- lean, cero vistas, y la única función que la leía (empresas_del_usuario) no
-- la llama nadie — solo existe en su propia migración.
--
-- Por qué borrar y no dejar: es una trampa dormida. El plan v1 del RLS quiso
-- colgar la seguridad de acá porque el nombre PARECE correcto, y se habría
-- anulado solo. Un cable que no va a ninguna parte se corta.
--
-- Respaldos hechos antes de correr esto (regla del fundador, misma fecha):
-- volcado completo manual en el Mac mini + las 10 filas exactas van en la
-- migración _DOWN, que restaura esquema Y datos.

drop function if exists public.empresas_del_usuario();
drop table if exists public.usuario_empresas;

-- Que no quede nada colgando de la tabla muerta.
do $$
declare pendientes int;
begin
  select count(*) into pendientes
  from pg_policies
  where schemaname = 'public'
    and (coalesce(qual, '') like '%usuario_empresas%'
      or coalesce(with_check, '') like '%usuario_empresas%');
  if pendientes <> 0 then
    raise exception 'Quedaron % policies leyendo usuario_empresas', pendientes;
  end if;
end $$;
