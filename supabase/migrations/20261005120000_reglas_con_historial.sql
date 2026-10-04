-- Fase 3 del plan del clasificador (docs/plan-clasificador-cirujano-2026-10-03.md):
-- REGLAS CON HISTORIAL. Aditiva. clasificacion_reglas es tabla SAGRADA: nada acá
-- borra filas; una regla que pierde su evidencia queda 'huerfana', no desaparece.
--
-- (a) clasificacion_reglas: estado + contadores separados + de dónde nació.
--     DECISIÓN DEL FUNDADOR (línea base 2026-10-04): las reglas EXISTENTES quedan
--     'firme' (el ADD COLUMN con default 'firme' las deja así, sin backfill que las
--     degrade). Recién después el default pasa a 'a_prueba' → solo las NUEVAS nacen a
--     prueba. Las globales (empresa_id null) siempre 'firme' (trigger + CHECK).
-- (b) aprendida_bajo_marca reemplaza la señal "confianza 0.99" de la Fase 2 (regla 39
--     confirmada por una persona sobre una cartola P2P/forex). Las filas con esa señal
--     se MARCAN (aprendida_bajo_marca=true) y su confianza 0.99 NO se toca: el código
--     viejo (ventana entre esta migración y el deploy) sigue leyendo 0.99, y el nuevo
--     también la reconoce por la confianza.
-- (c) clasificacion_regla_soportes: qué cartolas sostienen cada regla (acuñó /
--     confirmó / corrigió). RLS por empresa (solo lectura para la clienta; escribe el
--     service role). Borrar la cartola cascada su soporte.
-- (d) Trigger: si se borra el ÚLTIMO soporte de una regla NACIDA CON HISTORIAL
--     (ligada_a_cartolas: las existentes quedan en false y NUNCA se apagan solas), que
--     no esté deshecha y que no clasifique filas vivas en OTRAS cartolas → 'huerfana':
--     activa=false y nombre sin tercero. El PATRÓN SE CONSERVA (sacar el tercero del
--     patrón es la Fase 2 de privacidad, HMAC). No borra la fila.
-- (e) incrementar_uso_reglas(uuid[]): uso atómico (reemplaza leer-y-escribir).
-- (f) evidencia_reglas(empresa[, reglas]): SOLO LECTURA. Confirmaciones por
--     documento POSTERIORES a la última corrección (evidencia_desde), si alguna fue
--     mirada, aciertos por fila y una glosa de muestra. evidencia_reglas_lote: lo
--     mismo en UN jsonb (una ejecución por apertura, sin el tope de 1.000 filas).
-- (g) Índice propuestas_ia(regla_id): lo usan la evidencia, el trigger y Deshacer.
--     CREATE INDEX normal, no CONCURRENTLY (así el archivo corre igual dentro o fuera
--     de una transacción): bloquea las ESCRITURAS a propuestas_ia mientras se
--     construye; con ~6.000 filas (línea base 2026-10-04) son milisegundos.
--
-- ORDEN DE DEPLOY: (1) esta migración (aditiva; el código viejo sigue igual: las
-- existentes quedan firmes y con su confianza); (2) deploy del código de la Fase 3;
-- (3) DESPUÉS, 20261005120100_reglas_nombre_sin_tercero.sql (nombres).
--
-- Lock: ADD COLUMN con default constante = metadata. lock_timeout para no hacer cola.
-- Rollback: 20261005120000_reglas_con_historial_DOWN.sql (respalda antes de destruir).

set lock_timeout = '5s';

-- ── (a)+(b) columnas ────────────────────────────────────────────────────────────
alter table public.clasificacion_reglas
  add column if not exists estado               text    not null default 'firme',
  add column if not exists veces_acunada        integer not null default 0,
  add column if not exists veces_confirmada     integer not null default 0,
  add column if not exists veces_corregida      integer not null default 0,
  add column if not exists nacio_hint           text,
  add column if not exists nacio_carril         text,
  add column if not exists documento_origen_id  uuid,
  add column if not exists estado_cambiado_at   timestamptz,
  add column if not exists deshecha_por         uuid,
  add column if not exists aprendida_bajo_marca boolean not null default false,
  add column if not exists evidencia_desde      timestamptz,
  add column if not exists corregidas_en_ventana integer not null default 0,
  add column if not exists corregida_at         timestamptz,
  add column if not exists disputa_eleccion     smallint,
  add column if not exists disputa_racha        integer not null default 0,
  add column if not exists ligada_a_cartolas    boolean not null default false;

-- Desde ahora, una regla nueva nace a prueba y ligada a sus cartolas (las de arriba ya
-- quedaron firmes y NO ligadas: el trigger de huérfanas jamás las toca).
alter table public.clasificacion_reglas alter column estado set default 'a_prueba';
alter table public.clasificacion_reglas alter column ligada_a_cartolas set default true;

-- (g) índice para "filas de esta regla" (evidencia, trigger de huérfanas, Deshacer).
create index if not exists idx_propuestas_ia_regla on public.propuestas_ia (regla_id) where regla_id is not null;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'clasificacion_reglas_documento_origen_fkey') then
    alter table public.clasificacion_reglas
      add constraint clasificacion_reglas_documento_origen_fkey
      foreign key (documento_origen_id) references public.documentos_subidos(id) on delete set null not valid;
  end if;
end $$;

alter table public.clasificacion_reglas drop constraint if exists clasificacion_reglas_estado_check;
alter table public.clasificacion_reglas add constraint clasificacion_reglas_estado_check check (
  estado in ('a_prueba', 'firme', 'en_disputa', 'deshecha', 'huerfana')
);
-- Global = firme. Deshecha/huérfana = apagada.
alter table public.clasificacion_reglas drop constraint if exists clasificacion_reglas_global_firme_check;
alter table public.clasificacion_reglas add constraint clasificacion_reglas_global_firme_check check (
  empresa_id is not null or estado = 'firme'
);
alter table public.clasificacion_reglas drop constraint if exists clasificacion_reglas_apagada_check;
alter table public.clasificacion_reglas add constraint clasificacion_reglas_apagada_check check (
  estado not in ('deshecha', 'huerfana') or activa = false
);
alter table public.clasificacion_reglas drop constraint if exists clasificacion_reglas_contadores_check;
alter table public.clasificacion_reglas add constraint clasificacion_reglas_contadores_check check (
  veces_acunada >= 0 and veces_confirmada >= 0 and veces_corregida >= 0
  and corregidas_en_ventana >= 0 and disputa_racha >= 0
);

comment on column public.clasificacion_reglas.estado is
  'a_prueba (nueva, sin evidencia) | firme (existente o con 2-3 cartolas emitidas sin corrección) | en_disputa | deshecha (la deshizo una persona) | huerfana (se borró su última cartola). Ver src/lib/ai/regla-evidencia.ts.';
comment on column public.clasificacion_reglas.veces_acunada is
  'Cuántas veces una persona la enseñó en Check (acuñar). veces_aplicada = cuántas filas clasificó.';
comment on column public.clasificacion_reglas.veces_confirmada is
  'Cartolas distintas con boleta emitida del mismo tipo y sin corrección (derivado: evidencia_reglas, cron).';
comment on column public.clasificacion_reglas.veces_corregida is
  'Acciones en que una persona cambió el tipo de una fila que esta regla clasificó (una por regla y acción).';
comment on column public.clasificacion_reglas.nacio_carril is
  'Canal de la decisión que la acuñó (check_fila/check_detalle/check_lote).';
comment on column public.clasificacion_reglas.evidencia_desde is
  'Solo cuentan confirmaciones de filas nacidas DESPUÉS de esto (la última corrección). NULL = toda la historia.';
comment on column public.clasificacion_reglas.corregidas_en_ventana is
  'Correcciones dentro de la ventana de evidencia actual (se reinicia con evidencia_desde). 2 → en_disputa.';
comment on column public.clasificacion_reglas.corregida_at is
  'Última corrección registrada. Una cartola que confirma con filas nacidas después vence la ventana (corregidas_en_ventana = 0).';
comment on column public.clasificacion_reglas.disputa_eleccion is
  'En disputa: la última elección MIRADA de la persona (39/41). La misma 2 veces seguidas (disputa_racha) → sale con ese tipo.';
comment on column public.clasificacion_reglas.ligada_a_cartolas is
  'Nació con historial (Fase 3): si se borra la última cartola que la sostiene queda huérfana. Las existentes antes de la migración = false (nunca se apagan solas).';
comment on column public.clasificacion_reglas.aprendida_bajo_marca is
  'Regla 39 confirmada por una persona sobre una cartola marcada P2P/forex: no se vuelve a preguntar. Reemplaza la señal confianza 0.99 de la Fase 2.';

-- (b) la señal 0.99 de la Fase 2 se marca en su campo propio (la confianza se queda).
update public.clasificacion_reglas
   set aprendida_bajo_marca = true
 where empresa_id is not null and tipo_dte = 39 and confianza >= 0.99 and not aprendida_bajo_marca;

-- Globales siempre firmes, venga de donde venga el insert/update (seeds futuros incluidos).
create or replace function public.clasificacion_reglas_global_firme()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.empresa_id is null then
    new.estado := 'firme';
  end if;
  if tg_op = 'UPDATE' and new.estado is distinct from old.estado and new.estado_cambiado_at is not distinct from old.estado_cambiado_at then
    new.estado_cambiado_at := now();
  end if;
  return new;
end
$$;
drop trigger if exists trg_clasificacion_reglas_global_firme on public.clasificacion_reglas;
create trigger trg_clasificacion_reglas_global_firme
  before insert or update on public.clasificacion_reglas
  for each row execute function public.clasificacion_reglas_global_firme();

-- ── (c) soportes ────────────────────────────────────────────────────────────────
create table if not exists public.clasificacion_regla_soportes (
  id            bigint generated always as identity primary key,
  regla_id      uuid not null references public.clasificacion_reglas(id) on delete cascade,
  documento_id  uuid not null references public.documentos_subidos(id) on delete cascade,
  empresa_id    uuid not null references public.empresas(id) on delete cascade,
  -- El movimiento puntual que la enseñó (glosa viva para "Lo que aprendí"). SET NULL:
  -- un reproceso borra movimientos sin borrar la cartola; eso no la deja huérfana.
  movimiento_id uuid references public.movimientos_raw(id) on delete set null,
  rol           text not null check (rol in ('acuno', 'confirmo', 'corrigio')),
  created_at    timestamptz not null default now(),
  unique (regla_id, documento_id, rol)
);
create index if not exists idx_regla_soportes_regla on public.clasificacion_regla_soportes (regla_id);
create index if not exists idx_regla_soportes_documento on public.clasificacion_regla_soportes (documento_id);
create index if not exists idx_regla_soportes_empresa on public.clasificacion_regla_soportes (empresa_id);
create index if not exists idx_regla_soportes_movimiento on public.clasificacion_regla_soportes (movimiento_id) where movimiento_id is not null;

alter table public.clasificacion_regla_soportes enable row level security;
revoke all on table public.clasificacion_regla_soportes from public, anon, authenticated;
grant select on table public.clasificacion_regla_soportes to authenticated;
grant all on table public.clasificacion_regla_soportes to service_role;
drop policy if exists "soportes: la empresa lee los suyos" on public.clasificacion_regla_soportes;
create policy "soportes: la empresa lee los suyos" on public.clasificacion_regla_soportes
  for select to authenticated
  using (empresa_id = (select public.empresa_autorizada()));

comment on table public.clasificacion_regla_soportes is
  'Qué cartolas sostienen cada regla aprendida (acuno/confirmo/corrigio). Borrar la última → la regla queda huerfana (trigger). Fase 3 del clasificador.';

-- ── (d) última cartola borrada → huérfana (no se borra la fila ni el patrón) ────
create or replace function public.clasificacion_regla_soportes_al_borrar()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- AFTER ROW: corre al final de la sentencia, cuando ya se fueron todos los
  -- soportes que esa sentencia borraba (cascada de la cartola incluida). Las filas de
  -- la cartola que se borra pueden seguir ahí (orden de cascadas no garantizado): por
  -- eso se excluyen por documento, no por existencia.
  update public.clasificacion_reglas r
     set estado = 'huerfana',
         activa = false,
         nombre = case
           when r.tipo_dte in (41, 34) then 'Contraparte de una cartola borrada · Exenta'
           when r.tipo_dte in (39, 33) then 'Contraparte de una cartola borrada · Afecta'
           else 'Contraparte de una cartola borrada'
         end,
         estado_cambiado_at = now()
   where r.id = old.regla_id
     and r.empresa_id is not null
     and r.ligada_a_cartolas
     and r.estado not in ('huerfana', 'deshecha')
     and not exists (select 1 from public.clasificacion_regla_soportes s where s.regla_id = old.regla_id)
     and not exists (
       select 1 from public.propuestas_ia p
         join public.movimientos_raw m on m.id = p.movimiento_id
        where p.regla_id = old.regla_id
          and m.documento_id is distinct from old.documento_id
     );
  return null;
end
$$;
drop trigger if exists trg_regla_soportes_al_borrar on public.clasificacion_regla_soportes;
create trigger trg_regla_soportes_al_borrar
  after delete on public.clasificacion_regla_soportes
  for each row execute function public.clasificacion_regla_soportes_al_borrar();

-- ── (e) uso atómico ─────────────────────────────────────────────────────────────
-- Un id repetido N veces suma N. Sin leer-y-escribir: dos cartolas en paralelo no se pisan.
create or replace function public.incrementar_uso_reglas(p_regla_ids uuid[])
returns integer
language sql
security invoker
set search_path = public, pg_temp
as $$
  with c as (
    select id, count(*)::int as n from unnest(p_regla_ids) as id where id is not null group by id
  ), u as (
    update public.clasificacion_reglas r
       set veces_aplicada = r.veces_aplicada + c.n, last_used_at = now()
      from c
     where r.id = c.id
    returning 1
  )
  select count(*)::int from u;
$$;

-- ── (f) evidencia (solo lectura) ────────────────────────────────────────────────
-- Confirmación = DOCUMENTO distinto con boleta emitida (aceptada: no anulada ni
-- rechazada; no sandbox) del
-- mismo tipo_dte de la regla, de una propuesta que la regla clasificó (regla_id) y
-- que ninguna persona corrigió (ningún evento humano que cambió el tipo_dte).
-- Mirada = algún evento check_fila/check_detalle, o check_lote/aprobar_cartola con
-- lote ≤ 25 (espejo de esDecisionMirada en src/lib/ai/regla-evidencia.ts).
create or replace function public.evidencia_reglas(p_empresa_id uuid, p_regla_ids uuid[] default null)
returns table (
  regla_id uuid,
  confirmadas integer,
  confirmadas_miradas integer,
  aciertos integer,
  soportes integer,
  confirmadas_tras_correccion integer,
  documentos_confirman uuid[],
  glosa text
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  with r as (
    select cr.id, cr.tipo_dte, cr.evidencia_desde, cr.corregida_at
      from public.clasificacion_reglas cr
     where cr.empresa_id = p_empresa_id
       and (p_regla_ids is null or cr.id = any(p_regla_ids))
  ),
  p as (
    select pr.id, pr.regla_id, coalesce(pr.orig_documento_id, m.documento_id) as documento_id,
           m.descripcion, pr.created_at
      from public.propuestas_ia pr
      join r on r.id = pr.regla_id
      join public.movimientos_raw m on m.id = pr.movimiento_id
     where pr.empresa_id = p_empresa_id
       -- solo filas nacidas después de la última corrección (B1: las confirmaciones
       -- viejas eran del tipo corregido y no pueden re-promover la regla)
       and pr.created_at > coalesce(r.evidencia_desde, '-infinity'::timestamptz)
  ),
  ok as (
    select p.id, p.regla_id, p.documento_id,
           p.created_at > coalesce(r.corregida_at, 'infinity'::timestamptz) as tras_correccion,
           exists (
             select 1 from public.propuesta_decisiones d
              where d.propuesta_id = p.id
                and (d.canal in ('check_fila', 'check_detalle')
                     or (d.canal in ('check_lote', 'aprobar_cartola') and d.lote_n <= 25))
           ) as mirada
      from p
      join r on r.id = p.regla_id
     where exists (
             select 1 from public.boletas_emitidas b
              where b.propuesta_id = p.id
                and b.empresa_id = p_empresa_id
                and b.estado in ('aceptado', 'aceptado_reparos')
                and b.emision_sandbox is not true
                and b.tipo_dte = r.tipo_dte
           )
       and not exists (
             select 1 from public.propuesta_decisiones d
              where d.propuesta_id = p.id
                and d.canal in ('check_fila', 'check_detalle', 'check_lote', 'mcp', 'telegram')
                and d.antes_tipo_dte is distinct from d.despues_tipo_dte
           )
       -- una hermana que la PROPAGACIÓN ligó a la regla (misma cartola que la enseñó, a
       -- ciegas) no es evidencia independiente
       and not exists (
             select 1 from public.propuesta_decisiones d
              where d.propuesta_id = p.id and d.canal = 'propagacion'
           )
  ),
  docs as (
    select ok.regla_id, ok.documento_id, bool_or(ok.mirada) as mirada, count(*)::int as filas,
           bool_or(ok.tras_correccion) as tras_correccion
      from ok
     where ok.documento_id is not null
     group by 1, 2
  ),
  glosa_soporte as (
    select distinct on (s.regla_id) s.regla_id, m.descripcion
      from public.clasificacion_regla_soportes s
      join r on r.id = s.regla_id
      join public.movimientos_raw m on m.id = s.movimiento_id
     where s.empresa_id = p_empresa_id
     order by s.regla_id, s.created_at desc
  ),
  glosa_propuesta as (  -- la glosa no depende de la ventana de evidencia
    select distinct on (pr.regla_id) pr.regla_id, m.descripcion
      from public.propuestas_ia pr
      join r on r.id = pr.regla_id
      join public.movimientos_raw m on m.id = pr.movimiento_id
     where pr.empresa_id = p_empresa_id
     order by pr.regla_id, pr.created_at desc
  )
  select r.id,
         coalesce((select count(*) from docs where docs.regla_id = r.id), 0)::int,
         coalesce((select count(*) from docs where docs.regla_id = r.id and docs.mirada), 0)::int,
         coalesce((select sum(filas) from docs where docs.regla_id = r.id), 0)::int,
         coalesce((select count(*) from public.clasificacion_regla_soportes s where s.regla_id = r.id), 0)::int,
         coalesce((select count(*) from docs where docs.regla_id = r.id and docs.tras_correccion), 0)::int,
         coalesce((select array_agg(docs.documento_id order by docs.documento_id) from docs where docs.regla_id = r.id), '{}'::uuid[]),
         coalesce((select gs.descripcion from glosa_soporte gs where gs.regla_id = r.id),
                  (select gp.descripcion from glosa_propuesta gp where gp.regla_id = r.id))
    from r;
$$;

-- Lo mismo en UN valor (jsonb): una ejecución por apertura de "Lo que aprendí", sin
-- paginar ni re-ejecutar (PostgREST corta los conjuntos en 1.000 filas, no un escalar).
create or replace function public.evidencia_reglas_lote(p_empresa_id uuid, p_regla_ids uuid[] default null)
returns jsonb
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select coalesce(jsonb_agg(to_jsonb(e)), '[]'::jsonb) from public.evidencia_reglas(p_empresa_id, p_regla_ids) e;
$$;

revoke all on function public.clasificacion_reglas_global_firme() from public, anon, authenticated;
revoke all on function public.clasificacion_regla_soportes_al_borrar() from public, anon, authenticated;
revoke all on function public.incrementar_uso_reglas(uuid[]) from public, anon, authenticated;
revoke all on function public.evidencia_reglas(uuid, uuid[]) from public, anon, authenticated;
grant execute on function public.incrementar_uso_reglas(uuid[]) to service_role;
grant execute on function public.evidencia_reglas(uuid, uuid[]) to service_role;
revoke all on function public.evidencia_reglas_lote(uuid, uuid[]) from public, anon, authenticated;
grant execute on function public.evidencia_reglas_lote(uuid, uuid[]) to service_role;

reset lock_timeout;
