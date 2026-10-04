-- Fase 4 del plan del clasificador (docs/plan-clasificador-cirujano-2026-10-03.md):
-- CHECK AGRUPADO — preguntar en grupo ("¿les vendiste algo a estas personas?"), no fila
-- por fila. Aditiva y chica:
--
-- (a) Canal de decisión 'check_grupo' en los CHECK del sello (decision_canal y
--     editado_canal). Un canal PROPIO (no reutilizar check_lote): la medición distingue
--     "aprobó 300 de una sin mirar" de "respondió una pregunta sobre 12 personas".
--     abierta=true solo en las personas que la clienta tocó a mano en "Algunas".
-- (b) clasificacion_reglas.nacio_lote: el gesto (la respuesta) que acuñó la regla. Así
--     "Deshacer" de una respuesta apaga SOLO las reglas que nacieron en ella.
-- (c) evidencia_reglas: una decisión check_grupo con abierta=true cuenta como MIRADA
--     (umbral firme 2 en vez de 3); check_grupo que cambia el tipo_dte es una decisión
--     humana (esa fila no confirma a la regla). Espejo de esDecisionMirada
--     (src/lib/ai/regla-evidencia.ts). Mismo cuerpo que 20261005120000 + esas 2 líneas.
--
-- Lock: CHECK NOT VALID (no escanea), ADD COLUMN nullable sin default (metadata).
-- Rollback: 20261006120000_check_agrupado_DOWN.sql.

set lock_timeout = '5s';

-- ── (a) canal check_grupo ───────────────────────────────────────────────────────
alter table public.propuestas_ia drop constraint if exists propuestas_ia_decision_canal_check;
alter table public.propuestas_ia add constraint propuestas_ia_decision_canal_check check (
  decision_canal is null or decision_canal in (
    'check_fila', 'check_detalle', 'check_lote', 'check_grupo', 'aprobar_cartola', 'devolver_cartola',
    'propagacion', 'mcp', 'telegram', 'sistema', 'sin_sello'
  )
) not valid;

alter table public.propuestas_ia drop constraint if exists propuestas_ia_editado_canal_check;
alter table public.propuestas_ia add constraint propuestas_ia_editado_canal_check check (
  editado_canal is null or editado_canal in (
    'check_fila', 'check_detalle', 'check_lote', 'check_grupo', 'aprobar_cartola', 'devolver_cartola',
    'propagacion', 'mcp', 'telegram', 'sistema', 'sin_sello'
  )
) not valid;

-- ── (b) regla ← respuesta que la acuñó ──────────────────────────────────────────
alter table public.clasificacion_reglas add column if not exists nacio_lote uuid;  -- sin FK: es un lote de propuesta_decisiones
create index if not exists idx_clasificacion_reglas_nacio_lote
  on public.clasificacion_reglas (empresa_id, nacio_lote) where nacio_lote is not null;
comment on column public.clasificacion_reglas.nacio_lote is
  'Check agrupado (Fase 4): lote (decision_lote) de la respuesta en grupo que la acuñó. Deshacer esa respuesta la apaga. NULL = nació por otro camino.';

-- ── (c) evidencia: check_grupo mirado ───────────────────────────────────────────
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
                     or (d.canal in ('check_lote', 'aprobar_cartola') and d.lote_n <= 25)
                     or (d.canal = 'check_grupo' and d.abierta is true))
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
                and d.canal in ('check_fila', 'check_detalle', 'check_lote', 'check_grupo', 'mcp', 'telegram')
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

revoke all on function public.evidencia_reglas(uuid, uuid[]) from public, anon, authenticated;
grant execute on function public.evidencia_reglas(uuid, uuid[]) to service_role;

reset lock_timeout;
