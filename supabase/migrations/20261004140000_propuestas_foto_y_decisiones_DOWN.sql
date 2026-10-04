-- Revierte 20261004140000_propuestas_foto_y_decisiones.sql.
--
-- ORDEN: revertir PRIMERO el código (el código nuevo escribe decision_* y
-- orig_tipo_dte_fuente; sin las columnas, sus updates/inserts fallarían). Antes de
-- correr esto: respaldo en la Mac mini (~/.massdte-respaldo/respaldar.sh --ahora).
--
-- DESTRUYE: el log propuesta_decisiones, las fotos orig_*, editado_* y el sello
-- decision_* de propuestas_ia, y empresas.es_prueba. Por eso primero los COPIA a
-- tablas _respaldo_*_<YYYYMMDD_HHMMSS> (RLS sin policies: solo service_role/postgres).
-- Borrarlas a mano cuando ya no hagan falta.
--
-- Salida de emergencia más liviana (sin tocar el esquema):
--   alter table public.propuestas_ia disable trigger trg_propuestas_ia_log_cambio;

set lock_timeout = '5s';

-- 1. Respaldo de lo que se destruye, con SUFIJO DE TIMESTAMP: un segundo DOWN
--    (tras re-aplicar la migración) jamás pisa ni se salta el respaldo anterior.
--    Si la tabla de respaldo ya existiera (dos DOWN en el mismo segundo), aborta.
do $$
declare
  v_sufijo text := to_char(clock_timestamp(), 'YYYYMMDD_HH24MISS');
  v_tabla text;
begin
  if to_regclass('public.propuesta_decisiones') is not null then
    v_tabla := '_respaldo_propuesta_decisiones_' || v_sufijo;
    if to_regclass('public.' || v_tabla) is not null then
      raise exception 'RESPALDO_YA_EXISTE: %, no se destruye nada', v_tabla;
    end if;
    execute format('create table public.%I as table public.propuesta_decisiones', v_tabla);
    execute format('alter table public.%I enable row level security', v_tabla);
    execute format('revoke all on table public.%I from public, anon, authenticated', v_tabla);
    raise notice 'respaldo: public.% (% filas)', v_tabla, (select count(*) from public.propuesta_decisiones);
  end if;

  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'propuestas_ia' and column_name = 'orig_capturada_at') then
    v_tabla := '_respaldo_propuestas_foto_' || v_sufijo;
    if to_regclass('public.' || v_tabla) is not null then
      raise exception 'RESPALDO_YA_EXISTE: %, no se destruye nada', v_tabla;
    end if;
    execute format($q$
      create table public.%I as
      select id, empresa_id,
             orig_capturada_at, orig_tipo_propuesto, orig_tipo_dte, orig_tipo_dte_fuente,
             orig_confianza, orig_fuente, orig_regla_id, orig_estado, orig_mesa,
             orig_con_receptor, orig_documento_id, editado_at, editado_canal,
             decision_canal, decision_por, decision_lote, decision_lote_n,
             decision_abierta, decision_soporte
      from public.propuestas_ia
      where orig_capturada_at is not null or decision_canal is not null or editado_at is not null$q$, v_tabla);
    execute format('alter table public.%I enable row level security', v_tabla);
    execute format('revoke all on table public.%I from public, anon, authenticated', v_tabla);
  end if;

  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'empresas' and column_name = 'es_prueba') then
    v_tabla := '_respaldo_empresas_es_prueba_' || v_sufijo;
    if to_regclass('public.' || v_tabla) is not null then
      raise exception 'RESPALDO_YA_EXISTE: %, no se destruye nada', v_tabla;
    end if;
    execute format('create table public.%I as select id, es_prueba from public.empresas where es_prueba', v_tabla);
    execute format('alter table public.%I enable row level security', v_tabla);
    execute format('revoke all on table public.%I from public, anon, authenticated', v_tabla);
  end if;
end $$;

-- 2. Triggers y funciones.
drop trigger if exists trg_propuestas_ia_log_borrado on public.propuestas_ia;
drop trigger if exists trg_propuestas_ia_log_cambio on public.propuestas_ia;
drop trigger if exists trg_propuestas_ia_antes on public.propuestas_ia;
drop trigger if exists trg_propuestas_ia_foto on public.propuestas_ia;
drop function if exists public.propuestas_ia_log_borrados();
drop function if exists public.propuestas_ia_log_cambios();
drop function if exists public.propuestas_ia_antes_de_cambiar();
drop function if exists public.propuestas_ia_foto_original();
drop function if exists public.resumen_propuestas_a_borrar(uuid, uuid, uuid);

-- 3. Log.
drop table if exists public.propuesta_decisiones;

-- 4. Columnas y constraints.
alter table public.propuestas_ia drop constraint if exists propuestas_ia_orig_tipo_dte_fuente_check;
alter table public.propuestas_ia drop constraint if exists propuestas_ia_decision_canal_check;
alter table public.propuestas_ia drop constraint if exists propuestas_ia_editado_canal_check;
alter table public.propuestas_ia drop constraint if exists propuestas_ia_decision_lote_n_check;
alter table public.propuestas_ia
  drop column if exists orig_capturada_at,
  drop column if exists orig_tipo_propuesto,
  drop column if exists orig_tipo_dte,
  drop column if exists orig_tipo_dte_fuente,
  drop column if exists orig_confianza,
  drop column if exists orig_fuente,
  drop column if exists orig_regla_id,
  drop column if exists orig_estado,
  drop column if exists orig_mesa,
  drop column if exists orig_con_receptor,
  drop column if exists orig_documento_id,
  drop column if exists editado_at,
  drop column if exists editado_canal,
  drop column if exists decision_canal,
  drop column if exists decision_por,
  drop column if exists decision_lote,
  drop column if exists decision_lote_n,
  drop column if exists decision_abierta,
  drop column if exists decision_soporte;

alter table public.empresas drop column if exists es_prueba;

reset lock_timeout;
