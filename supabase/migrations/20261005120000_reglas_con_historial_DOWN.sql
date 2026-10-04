-- Revierte 20261005120000_reglas_con_historial.sql.
--
-- ORDEN: revertir PRIMERO el código (el código nuevo lee/escribe estado, veces_*,
-- aprendida_bajo_marca y llama incrementar_uso_reglas / evidencia_reglas). Antes de
-- correr esto: respaldo en la Mac mini (~/.massdte-respaldo/respaldar.sh --ahora).
--
-- clasificacion_reglas es SAGRADA: este DOWN no borra NINGUNA fila de reglas. Destruye
-- columnas (estado, contadores, origen, aprendida_bajo_marca) y la tabla de soportes;
-- por eso primero las COPIA a _respaldo_*_<YYYYMMDD_HHMMSS> (RLS sin policies: solo
-- service_role/postgres). Borrar los respaldos a mano cuando ya no hagan falta.
--
-- La señal aprendida_bajo_marca vuelve a la confianza 0.99 (lo que lee el código de la
-- Fase 2). Las reglas deshechas / huérfanas siguen apagadas (activa=false) y sin el
-- nombre del tercero: eso no se "des-hace".

set lock_timeout = '5s';

do $$
declare
  v_sufijo text := to_char(clock_timestamp(), 'YYYYMMDD_HH24MISS');
  v_tabla text;
begin
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'clasificacion_reglas' and column_name = 'estado') then
    v_tabla := '_respaldo_reglas_historial_' || v_sufijo;
    if to_regclass('public.' || v_tabla) is not null then
      raise exception 'RESPALDO_YA_EXISTE: %, no se destruye nada', v_tabla;
    end if;
    execute format($q$
      create table public.%I as
      select id, empresa_id, estado, veces_acunada, veces_confirmada, veces_corregida,
             nacio_hint, nacio_carril, documento_origen_id, estado_cambiado_at, deshecha_por,
             aprendida_bajo_marca, confianza
      from public.clasificacion_reglas$q$, v_tabla);
    execute format('alter table public.%I enable row level security', v_tabla);
    execute format('revoke all on table public.%I from public, anon, authenticated', v_tabla);
    raise notice 'respaldo: public.%', v_tabla;
  end if;

  if to_regclass('public.clasificacion_regla_soportes') is not null then
    v_tabla := '_respaldo_regla_soportes_' || v_sufijo;
    if to_regclass('public.' || v_tabla) is not null then
      raise exception 'RESPALDO_YA_EXISTE: %, no se destruye nada', v_tabla;
    end if;
    execute format('create table public.%I as table public.clasificacion_regla_soportes', v_tabla);
    execute format('alter table public.%I enable row level security', v_tabla);
    execute format('revoke all on table public.%I from public, anon, authenticated', v_tabla);
    raise notice 'respaldo: public.%', v_tabla;
  end if;

  -- La señal de la Fase 3 vuelve a ser la confianza de la Fase 2.
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'clasificacion_reglas' and column_name = 'aprendida_bajo_marca') then
    execute 'update public.clasificacion_reglas set confianza = 0.99 where aprendida_bajo_marca and empresa_id is not null and tipo_dte = 39';
  end if;
end $$;

-- Funciones y triggers.
drop trigger if exists trg_regla_soportes_al_borrar on public.clasificacion_regla_soportes;
drop trigger if exists trg_clasificacion_reglas_global_firme on public.clasificacion_reglas;
drop function if exists public.clasificacion_regla_soportes_al_borrar();
drop function if exists public.clasificacion_reglas_global_firme();
drop function if exists public.incrementar_uso_reglas(uuid[]);
drop function if exists public.evidencia_reglas(uuid, uuid[]);

-- Soportes (respaldados arriba).
drop table if exists public.clasificacion_regla_soportes;

-- Columnas y constraints de clasificacion_reglas (las FILAS se quedan).
alter table public.clasificacion_reglas drop constraint if exists clasificacion_reglas_estado_check;
alter table public.clasificacion_reglas drop constraint if exists clasificacion_reglas_global_firme_check;
alter table public.clasificacion_reglas drop constraint if exists clasificacion_reglas_apagada_check;
alter table public.clasificacion_reglas drop constraint if exists clasificacion_reglas_contadores_check;
alter table public.clasificacion_reglas drop constraint if exists clasificacion_reglas_documento_origen_fkey;
alter table public.clasificacion_reglas
  drop column if exists estado,
  drop column if exists veces_acunada,
  drop column if exists veces_confirmada,
  drop column if exists veces_corregida,
  drop column if exists nacio_hint,
  drop column if exists nacio_carril,
  drop column if exists documento_origen_id,
  drop column if exists estado_cambiado_at,
  drop column if exists deshecha_por,
  drop column if exists aprendida_bajo_marca;

reset lock_timeout;
