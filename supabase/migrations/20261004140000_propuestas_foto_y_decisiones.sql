-- Fase 1 del plan del clasificador (docs/plan-clasificador-cirujano-2026-10-03.md):
-- MEDIR antes de mover. Aditiva, SIN backfill.
--
-- (a) FOTO AL NACER en propuestas_ia (orig_*): lo que el sistema propuso cuando la
--     fila nació. La llena un trigger BEFORE INSERT y otro trigger la vuelve
--     INMUTABLE (FOTO_ORIGINAL_INMUTABLE). orig_capturada_at NULL = fila vieja
--     "sin foto" (no se rellena: una foto inventada con el valor actual daría
--     precisión 100% falsa). La app solo manda orig_tipo_dte_fuente (de dónde salió
--     el 39/41); si un camino no la manda, queda 'desconocido' y se ve al medir.
-- (b) SELLO de la decisión (decision_*): cada acción lo escribe en el MISMO UPDATE
--     (canal, quién, lote, tamaño del lote, si la fila estaba abierta, soporte). Si
--     una escritura no sella (decision_lote igual al anterior), el trigger la marca
--     'sin_sello' — nada se escapa, ni Telegram ni una escritura directa.
-- (c) LOG propuesta_decisiones: un trigger AFTER UPDATE por SENTENCIA (tablas de
--     transición) copia antes/después de tipo/dte/estado/receptor/total. Atómico con
--     el cambio, cero viajes extra. Sin PII: del receptor solo "tenía/no tenía".
--     AFTER DELETE deja una fila 'borrado' — salvo que la empresa ya no exista
--     (purga ARCO: no recrear datos de una cuenta recién purgada). Sin FK a empresas.
-- (d) resumen_propuestas_a_borrar(): SOLO conteos, para la auditoría de borrados.
-- (e) empresas.es_prueba (como livemode de Stripe): toda medición la respeta. El
--     marcado de las empresas internas va en un script aparte
--     (scripts/medicion/sql/marcar-empresas-prueba.sql), NO acá.
--
-- Lock: ADD COLUMN nullable sin default y ADD COLUMN con default constante son solo
-- metadata (instantáneos); los CHECK van NOT VALID (no escanean). lock_timeout para
-- no hacer cola detrás de una transacción larga: si no obtiene el lock, falla y se
-- reintenta en horario bajo.
-- Rollback: 20261004140000_propuestas_foto_y_decisiones_DOWN.sql (respalda antes).

set lock_timeout = '5s';

-- ── (a)+(b) columnas ────────────────────────────────────────────────────────────
alter table public.propuestas_ia
  add column if not exists orig_capturada_at    timestamptz,
  add column if not exists orig_tipo_propuesto  text,
  add column if not exists orig_tipo_dte        smallint,
  add column if not exists orig_tipo_dte_fuente text,
  add column if not exists orig_confianza       numeric,
  add column if not exists orig_fuente          text,
  add column if not exists orig_regla_id        uuid,     -- sin FK: borrar la regla no cambia la foto
  add column if not exists orig_estado          text,
  add column if not exists orig_mesa            text,
  add column if not exists orig_con_receptor    boolean,  -- solo "tenía RUT", nunca el valor
  add column if not exists orig_documento_id    uuid,     -- sin FK: sobrevive al borrado
  add column if not exists editado_at           timestamptz,
  add column if not exists editado_canal        text,
  add column if not exists decision_canal       text,
  add column if not exists decision_por         uuid,
  add column if not exists decision_lote        uuid,
  add column if not exists decision_lote_n      integer,
  add column if not exists decision_abierta     boolean,
  add column if not exists decision_soporte     boolean;

-- Listas cerradas (espejo de src/lib/propuestas/sello.ts y src/lib/ai/tipo-dte-fuente.ts;
-- un test estático exige que calcen). NOT VALID: no escanea; rige para filas nuevas/editadas.
alter table public.propuestas_ia drop constraint if exists propuestas_ia_orig_tipo_dte_fuente_check;
alter table public.propuestas_ia add constraint propuestas_ia_orig_tipo_dte_fuente_check check (
  orig_tipo_dte_fuente is null or orig_tipo_dte_fuente in (
    'salida_o_no_boletar', 'categoria_exenta', 'regla', 'regla_forzada_exenta', 'no_venta',
    'auto_empresa_exenta', 'auto_no_firme', 'auto_glosa_exenta', 'auto_sin_tipo',
    'auto_contribuyente_afecto', 'auto_glosa_afecta', 'auto_hint_afecta', 'auto_sin_evidencia_afecta',
    'telegram_comprobante', 'telegram_asegurada', 'telegram_manual',
    'plantilla_facturas', 'factura_unica', 'cuadre_cartola', 'desconocido'
  )
) not valid;

alter table public.propuestas_ia drop constraint if exists propuestas_ia_decision_canal_check;
alter table public.propuestas_ia add constraint propuestas_ia_decision_canal_check check (
  decision_canal is null or decision_canal in (
    'check_fila', 'check_detalle', 'check_lote', 'aprobar_cartola', 'devolver_cartola',
    'propagacion', 'mcp', 'telegram', 'sistema', 'sin_sello'
  )
) not valid;

alter table public.propuestas_ia drop constraint if exists propuestas_ia_editado_canal_check;
alter table public.propuestas_ia add constraint propuestas_ia_editado_canal_check check (
  editado_canal is null or editado_canal in (
    'check_fila', 'check_detalle', 'check_lote', 'aprobar_cartola', 'devolver_cartola',
    'propagacion', 'mcp', 'telegram', 'sistema', 'sin_sello'
  )
) not valid;

alter table public.propuestas_ia drop constraint if exists propuestas_ia_decision_lote_n_check;
alter table public.propuestas_ia add constraint propuestas_ia_decision_lote_n_check check (
  decision_lote_n is null or decision_lote_n > 0
) not valid;

comment on column public.propuestas_ia.orig_capturada_at is
  'Foto al nacer (Fase 1 medición). NULL = fila anterior a la migración, sin foto. Inmutable (trigger).';
comment on column public.propuestas_ia.orig_tipo_dte_fuente is
  'De dónde salió el tipo_dte al nacer (regla, auto_*, categoria_exenta…). desconocido = el camino de insert no lo informó.';
comment on column public.propuestas_ia.decision_canal is
  'Sello de la última escritura: canal (check_fila/…/sistema). sin_sello = la escritura no selló (lo pone el trigger).';

-- (e) empresas de prueba. Constante → metadata-only en PG11+.
alter table public.empresas add column if not exists es_prueba boolean not null default false;
comment on column public.empresas.es_prueba is
  'Empresa interna/de prueba (como livemode de Stripe). Toda medición la excluye. Se marca con scripts/medicion/sql/marcar-empresas-prueba.sql.';

-- ── (c) log ─────────────────────────────────────────────────────────────────────
create table if not exists public.propuesta_decisiones (
  id                     bigint generated always as identity primary key,
  created_at             timestamptz not null default now(),
  empresa_id             uuid not null,     -- SIN FK (purga ARCO); purga-cuenta borra explícito
  propuesta_id           uuid not null,     -- SIN FK: el rastro sobrevive al borrado
  documento_id           uuid,
  accion                 text not null check (accion in ('cambio', 'borrado')),
  canal                  text not null,
  usuario_id             uuid,
  lote_id                uuid,
  lote_n                 integer,
  abierta                boolean,
  soporte                boolean,
  mesa                   text,
  antes_tipo_propuesto   text,
  despues_tipo_propuesto text,
  antes_tipo_dte         smallint,
  despues_tipo_dte       smallint,
  antes_estado           text,
  despues_estado         text,
  antes_con_receptor     boolean,
  despues_con_receptor   boolean,
  receptor_cambio        boolean not null default false,
  total_cambio           boolean not null default false,
  orig_fuente            text,
  orig_tipo_dte_fuente   text,
  orig_confianza         numeric,
  orig_tipo_dte          smallint,
  con_foto               boolean not null
);
create index if not exists idx_prop_dec_empresa_fecha on public.propuesta_decisiones (empresa_id, created_at desc);
create index if not exists idx_prop_dec_propuesta on public.propuesta_decisiones (propuesta_id, created_at);
create index if not exists idx_prop_dec_created on public.propuesta_decisiones (created_at);

-- Solo lectura interna: RLS sin policies + revoke (solo service_role / postgres).
alter table public.propuesta_decisiones enable row level security;
revoke all on table public.propuesta_decisiones from public, anon, authenticated;
revoke all on sequence public.propuesta_decisiones_id_seq from public, anon, authenticated;

comment on table public.propuesta_decisiones is
  'Log de decisiones sobre propuestas_ia (Fase 1 medición). Lo escriben triggers; sin PII de terceros. Retención: src/app/api/audit/cron (RETENCION_DECISIONES_DIAS).';

-- ── Trigger 1: foto al nacer (BEFORE INSERT, por fila) ──────────────────────────
create or replace function public.propuestas_ia_foto_original()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  new.orig_capturada_at    := now();
  new.orig_tipo_propuesto  := new.tipo_propuesto;
  new.orig_tipo_dte        := new.tipo_dte;
  new.orig_tipo_dte_fuente := coalesce(new.orig_tipo_dte_fuente, 'desconocido');
  new.orig_confianza       := new.confianza;
  new.orig_fuente          := new.fuente_clasificacion;
  new.orig_regla_id        := new.regla_id;
  new.orig_estado          := new.estado;
  new.orig_mesa            := new.mesa;
  new.orig_con_receptor    := new.receptor_rut is not null;
  select m.documento_id into new.orig_documento_id
    from public.movimientos_raw m where m.id = new.movimiento_id;
  -- El sello no nace: nacer no es una decisión.
  new.decision_canal := null; new.decision_por := null; new.decision_lote := null;
  new.decision_lote_n := null; new.decision_abierta := null; new.decision_soporte := null;
  new.editado_at := null; new.editado_canal := null;
  return new;
end
$$;

-- ── Trigger 2: candado de la foto + sello obligatorio + marca de editado ───────
create or replace function public.propuestas_ia_antes_de_cambiar()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if (new.orig_capturada_at, new.orig_tipo_propuesto, new.orig_tipo_dte, new.orig_tipo_dte_fuente,
      new.orig_confianza, new.orig_fuente, new.orig_regla_id, new.orig_estado, new.orig_mesa,
      new.orig_con_receptor, new.orig_documento_id)
     is distinct from
     (old.orig_capturada_at, old.orig_tipo_propuesto, old.orig_tipo_dte, old.orig_tipo_dte_fuente,
      old.orig_confianza, old.orig_fuente, old.orig_regla_id, old.orig_estado, old.orig_mesa,
      old.orig_con_receptor, old.orig_documento_id) then
    raise exception 'FOTO_ORIGINAL_INMUTABLE: la foto al nacer de la propuesta no se edita'
      using errcode = 'P0001';
  end if;

  -- Nadie selló esta escritura (el lote no cambió) → sin_sello. decision_por queda
  -- con quien esté autenticado (null bajo service role).
  if new.decision_lote is not distinct from old.decision_lote then
    new.decision_canal   := 'sin_sello';
    new.decision_por     := auth.uid();
    new.decision_lote    := null;
    new.decision_lote_n  := null;
    new.decision_abierta := null;
    new.decision_soporte := null;
  end if;

  if (new.tipo_propuesto, new.tipo_dte, new.total, new.receptor_rut, new.receptor_nombre, new.cliente_id)
       is distinct from
     (old.tipo_propuesto, old.tipo_dte, old.total, old.receptor_rut, old.receptor_nombre, old.cliente_id)
     or (new.estado = 'editado' and old.estado is distinct from 'editado') then
    new.editado_at    := now();
    new.editado_canal := new.decision_canal;
  end if;
  return new;
end
$$;

-- ── Trigger 3: log de cambios (AFTER UPDATE, POR SENTENCIA, tablas de transición)
-- Un chunk de 50 = UN insert…select. Solo registra si cambió algo que importa para
-- medir (tipo/dte/estado/receptor/cliente/total): un cambio de glosa no deja fila.
create or replace function public.propuestas_ia_log_cambios()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.propuesta_decisiones (
    empresa_id, propuesta_id, documento_id, accion, canal, usuario_id,
    lote_id, lote_n, abierta, soporte, mesa,
    antes_tipo_propuesto, despues_tipo_propuesto, antes_tipo_dte, despues_tipo_dte,
    antes_estado, despues_estado, antes_con_receptor, despues_con_receptor,
    receptor_cambio, total_cambio,
    orig_fuente, orig_tipo_dte_fuente, orig_confianza, orig_tipo_dte, con_foto)
  select n.empresa_id, n.id, coalesce(n.orig_documento_id, m.documento_id), 'cambio',
    coalesce(n.decision_canal, 'sin_sello'), n.decision_por,
    n.decision_lote, n.decision_lote_n, n.decision_abierta, n.decision_soporte, n.mesa,
    o.tipo_propuesto, n.tipo_propuesto, o.tipo_dte, n.tipo_dte,
    o.estado, n.estado, o.receptor_rut is not null, n.receptor_rut is not null,
    (o.receptor_rut, o.receptor_nombre, o.cliente_id) is distinct from (n.receptor_rut, n.receptor_nombre, n.cliente_id),
    o.total is distinct from n.total,
    coalesce(n.orig_fuente, n.fuente_clasificacion), n.orig_tipo_dte_fuente,
    coalesce(n.orig_confianza, n.confianza), n.orig_tipo_dte, n.orig_capturada_at is not null
  from new_rows n
  join old_rows o on o.id = n.id
  left join public.movimientos_raw m on m.id = n.movimiento_id and n.orig_documento_id is null
  where (o.tipo_propuesto, o.tipo_dte, o.estado, o.receptor_rut, o.receptor_nombre, o.cliente_id, o.total)
        is distinct from
        (n.tipo_propuesto, n.tipo_dte, n.estado, n.receptor_rut, n.receptor_nombre, n.cliente_id, n.total);
  return null;
end
$$;

-- ── Trigger 4: log de borrados (AFTER DELETE, por sentencia) ────────────────────
-- Salta si la empresa ya no existe: en la purga ARCO la cascada empresas →
-- propuestas_ia dispara esto con la empresa ya borrada; no recreamos su rastro.
create or replace function public.propuestas_ia_log_borrados()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.propuesta_decisiones (
    empresa_id, propuesta_id, documento_id, accion, canal, mesa,
    antes_tipo_propuesto, antes_tipo_dte, antes_estado, antes_con_receptor,
    orig_fuente, orig_tipo_dte_fuente, orig_confianza, orig_tipo_dte, con_foto)
  select o.empresa_id, o.id, o.orig_documento_id, 'borrado', 'borrado', o.mesa,
    o.tipo_propuesto, o.tipo_dte, o.estado, o.receptor_rut is not null,
    coalesce(o.orig_fuente, o.fuente_clasificacion), o.orig_tipo_dte_fuente,
    coalesce(o.orig_confianza, o.confianza), o.orig_tipo_dte, o.orig_capturada_at is not null
  from old_rows o
  where exists (select 1 from public.empresas e where e.id = o.empresa_id);
  return null;
end
$$;

drop trigger if exists trg_propuestas_ia_foto on public.propuestas_ia;
create trigger trg_propuestas_ia_foto
  before insert on public.propuestas_ia
  for each row execute function public.propuestas_ia_foto_original();

drop trigger if exists trg_propuestas_ia_antes on public.propuestas_ia;
create trigger trg_propuestas_ia_antes
  before update on public.propuestas_ia
  for each row execute function public.propuestas_ia_antes_de_cambiar();

drop trigger if exists trg_propuestas_ia_log_cambio on public.propuestas_ia;
create trigger trg_propuestas_ia_log_cambio
  after update on public.propuestas_ia
  referencing old table as old_rows new table as new_rows
  for each statement execute function public.propuestas_ia_log_cambios();

drop trigger if exists trg_propuestas_ia_log_borrado on public.propuestas_ia;
create trigger trg_propuestas_ia_log_borrado
  after delete on public.propuestas_ia
  referencing old table as old_rows
  for each statement execute function public.propuestas_ia_log_borrados();

-- ── (d) resumen para la auditoría de borrados: SOLO conteos ─────────────────────
-- Sin glosas, nombres ni RUT. Claves = códigos del sistema (fuente, estado, tipo).
-- p_propuesta_id opcional: devolverAOmitidos borra UNA propuesta.
create or replace function public.resumen_propuestas_a_borrar(
  p_empresa_id uuid,
  p_documento_id uuid,
  p_propuesta_id uuid default null
)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with p as (
    select coalesce(p.orig_fuente, p.fuente_clasificacion, 'sin_fuente') as fuente,
           coalesce(p.orig_tipo_dte_fuente, 'sin_foto') as tipo_dte_fuente,
           p.estado,
           coalesce(p.tipo_dte::text, 'sin_tipo') as tipo_dte,
           p.editado_at is not null as editada,
           p.orig_capturada_at is null as sin_foto,
           case
             when coalesce(p.orig_confianza, p.confianza) is null then 'sin'
             when coalesce(p.orig_confianza, p.confianza) >= 0.85 then 'alta'
             when coalesce(p.orig_confianza, p.confianza) >= 0.80 then 'bulk'
             when coalesce(p.orig_confianza, p.confianza) >= 0.50 then 'baja'
             else 'muy_baja'
           end as banda
    from public.propuestas_ia p
    join public.movimientos_raw m on m.id = p.movimiento_id
    where p.empresa_id = p_empresa_id
      and (p_documento_id is not null or p_propuesta_id is not null)
      and (p_documento_id is null or m.documento_id = p_documento_id)
      and (p_propuesta_id is null or p.id = p_propuesta_id)
  )
  select jsonb_build_object(
    'total', (select count(*) from p),
    'editadas', (select count(*) from p where editada),
    'sin_foto', (select count(*) from p where sin_foto),
    'por_fuente', coalesce((select jsonb_object_agg(fuente, n) from (select fuente, count(*) n from p group by 1) x), '{}'::jsonb),
    'por_tipo_dte_fuente', coalesce((select jsonb_object_agg(tipo_dte_fuente, n) from (select tipo_dte_fuente, count(*) n from p group by 1) x), '{}'::jsonb),
    'por_estado', coalesce((select jsonb_object_agg(estado, n) from (select estado, count(*) n from p group by 1) x), '{}'::jsonb),
    'por_tipo_dte', coalesce((select jsonb_object_agg(tipo_dte, n) from (select tipo_dte, count(*) n from p group by 1) x), '{}'::jsonb),
    'por_banda_confianza', coalesce((select jsonb_object_agg(banda, n) from (select banda, count(*) n from p group by 1) x), '{}'::jsonb)
  );
$$;

revoke all on function public.propuestas_ia_foto_original() from public, anon, authenticated;
revoke all on function public.propuestas_ia_antes_de_cambiar() from public, anon, authenticated;
revoke all on function public.propuestas_ia_log_cambios() from public, anon, authenticated;
revoke all on function public.propuestas_ia_log_borrados() from public, anon, authenticated;
revoke all on function public.resumen_propuestas_a_borrar(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.resumen_propuestas_a_borrar(uuid, uuid, uuid) to service_role;

reset lock_timeout;
