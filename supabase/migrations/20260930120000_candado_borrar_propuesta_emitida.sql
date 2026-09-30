-- DOBLE CANDADO, candado 2 (base de datos) — 2026-09-30.
--
-- Regla del fundador: "las emitidas nunca vuelven; el documento en Check con
-- emitidas no se puede borrar; solo vuelve lo que no se terminó". "Si falla uno
-- tenemos otro".
--
-- Candado 1 = la app (src/lib/emission/bloqueo-borrado.ts, fail-closed) en
-- eliminar-documento, deshacer-documento, reproceso y devolverAOmitidos.
-- Candado 2 = ESTE trigger: si una propuesta_ia tiene emisión, la base se niega a
-- borrarla, venga el DELETE de donde venga (ruta, server action, script, cascada).
--
-- Por qué hace falta: boletas_emitidas.propuesta_id y emision_jobs.propuesta_id son
-- ON DELETE SET NULL. Borrar la propuesta deja la boleta / la lápida HUÉRFANA
-- (propuesta_id NULL) y re-subir la cartola crea una propuesta nueva sin candado →
-- la misma venta se puede emitir dos veces en el SII.
--
-- Cascadas reales (20260410_schema_base.sql): documentos_subidos → movimientos_raw
-- (ON DELETE CASCADE) → propuestas_ia (ON DELETE CASCADE). Un trigger BEFORE DELETE
-- FOR EACH ROW también corre en las filas borradas por cascada, y la excepción
-- aborta la SENTENCIA COMPLETA (y su transacción): borrar el documento, sus
-- movimientos o la empresa entera no deja nada a medias. Es lo buscado.
--
-- BLOQUEA si la propuesta tiene:
--   (a) una boleta NO anulada y NO sandbox. emision_sandbox es NOT NULL DEFAULT
--       false (20260606120000); igual se usa IS NOT TRUE para tratar un NULL como
--       real (fail-closed). Sandbox = emisión de prueba del proveedor externo
--       legado (BaseAPI), explícitamente marcada: nunca tuvo folio real en el SII.
--       Las boletas 'mock' NO se eximen: emision_proveedor tiene DEFAULT 'mock',
--       así que un insert que olvide el proveedor etiquetaría como mock una real.
--       Las de prueba se borran primero (ver "limpieza" abajo).
--   (b) un emision_jobs en 'revision_pendiente' (lápida a medias), o en
--       'created' / 'running' — vencido o no: una lápida sin_respuesta es un running
--       vencido, y un running colgado es un resultado DESCONOCIDO (el folio pudo
--       salir). Más estricto que la UI a propósito: aquí no hay reloj ni corte.
-- Las filas que YA quedaron huérfanas (propuesta_id NULL) no participan.
--
-- Rendimiento: 2 sondas por fila borrada, ambas con índice parcial existente:
--   boletas_emitidas: idx_boletas_propuesta (propuesta_id) WHERE propuesta_id IS NOT NULL
--                     (y idx_boletas_propuesta_unica_vigente, WHERE estado <> 'anulada')
--   emision_jobs:     idx_emision_jobs_en_vuelo (created/running) e
--                     idx_emision_jobs_revision (revision_pendiente), ambos por propuesta_id
-- Una cartola de 5.000 filas = 10.000 index lookups: milisegundos.
--
-- BYPASS (mínimo y auditado) para usos legítimos con datos de PRUEBA:
--   BEGIN;
--   SELECT set_config('massdte.permitir_borrado_emitidas', 'on', true);  -- solo esta transacción
--   ... DELETE ...;
--   COMMIT;
-- Reglas del bypass:
--   * Es LOCAL a la transacción (tercer argumento true): se apaga solo al COMMIT/ROLLBACK.
--   * Se IGNORA si la sesión viene de PostgREST con rol 'anon' o 'authenticated'
--     (request.jwt.claims): una clienta nunca puede activarlo. En la práctica solo
--     sirve desde el SQL editor / psql (postgres) o service role consciente.
--   * Cada propuesta con emisión borrada con bypass deja una fila en
--     public.propuestas_borradas_con_emision (quién, cuándo, qué había). Si la
--     transacción se revierte, la fila de auditoría también (solo queda lo que se borró).
--   * Ningún código de la app lo usa. Si algún día hace falta, que sea explícito y revisado.
--
-- Usos legítimos de borrado, cómo quedan:
--   * scripts/limpiar-test.sql (ritual "limpia"): borra primero las boletas mock y
--     ahora CONSERVA también las propuestas con job abierto/lápida (igual que ya
--     conservaba las de boletas no-mock) → no toca el trigger ni usa bypass.
--   * scripts/reset-completo.sql (reset total, SOLO entornos de prueba): borra todas
--     las boletas primero y activa el bypass en su transacción (auditado), porque
--     los jobs a medias de prueba harían saltar el trigger.
--   * Purga de cuenta (derecho ARCO, src/lib/derechos/purga-cuenta.ts): ya se niega
--     si hay boletas; ahora también si hay emisiones abiertas/lápidas, ANTES de borrar
--     archivos. Esas cuentas requieren criterio humano (retención 6 años).
--   * Rollback de onboarding / empresa recién creada: no tiene propuestas. Sin efecto.
--   * Re-subir la cartola: crea propuestas nuevas; no borra. Reprocesar la misma
--     cartola (limpiarInsercionesPrevias) ya se negaba con boletas; ahora también
--     con lápidas, y el trigger lo respalda.
--   * TRUNCATE no dispara triggers de fila; pero propuestas_ia es referida por FK,
--     así que TRUNCATE exige CASCADE (arrasa boletas también) — nadie lo usa.
--
-- Idempotente. Revertir: 20260930120000_candado_borrar_propuesta_emitida_DOWN.sql.

create table if not exists public.propuestas_borradas_con_emision (
  id bigserial primary key,
  propuesta_id uuid not null,
  empresa_id uuid,
  boletas_vivas integer not null,
  jobs_abiertos integer not null,
  db_user text not null default current_user,
  session_user_name text not null default session_user,
  jwt_role text,
  created_at timestamptz not null default now()
);

comment on table public.propuestas_borradas_con_emision is
  'Auditoría del bypass massdte.permitir_borrado_emitidas: cada propuesta con boleta/job abierto borrada a conciencia (datos de prueba). Solo service role.';

-- Solo service role (sin políticas).
alter table public.propuestas_borradas_con_emision enable row level security;
revoke all on public.propuestas_borradas_con_emision from anon, authenticated;

create or replace function public.propuestas_ia_candado_emision()
returns trigger
language plpgsql
security definer          -- ve boletas/jobs aunque el que borra no tenga RLS para leerlos
set search_path = public, pg_temp
as $$
declare
  v_boletas integer;
  v_jobs integer;
  v_jwt_role text;
  v_bypass boolean;
begin
  select count(*) into v_boletas
  from public.boletas_emitidas b
  where b.propuesta_id = old.id
    and b.estado is distinct from 'anulada'
    and b.emision_sandbox is not true;

  select count(*) into v_jobs
  from public.emision_jobs j
  where j.propuesta_id = old.id
    and j.estado in ('created', 'running', 'revision_pendiente');

  if v_boletas = 0 and v_jobs = 0 then
    return old;
  end if;

  v_bypass := coalesce(current_setting('massdte.permitir_borrado_emitidas', true), '') = 'on';
  if v_bypass then
    -- Una clienta (PostgREST anon/authenticated) nunca puede usar el bypass.
    v_jwt_role := nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role';
    v_bypass := coalesce(v_jwt_role, '') not in ('anon', 'authenticated');
  end if;

  if v_bypass then
    insert into public.propuestas_borradas_con_emision (propuesta_id, empresa_id, boletas_vivas, jobs_abiertos, jwt_role)
    values (old.id, old.empresa_id, v_boletas, v_jobs, v_jwt_role);
    raise warning 'PROPUESTA_CON_EMISION bypass: propuesta % borrada con % boleta(s) y % job(s) abiertos (auditado)',
      old.id, v_boletas, v_jobs;
    return old;
  end if;

  raise exception 'PROPUESTA_CON_EMISION: la propuesta % tiene % boleta(s) emitida(s) y % emisión(es) abierta(s) o a medias; no se puede borrar', old.id, v_boletas, v_jobs
    using errcode = 'MDE01',
          hint = 'Las emitidas nunca vuelven. Anula la boleta o resuelve la lápida (verificar folio / declarar que no salió) antes de borrar. Datos de prueba: ver bypass en la migración 20260930120000.';
end;
$$;

comment on function public.propuestas_ia_candado_emision() is
  'Candado 2: BEFORE DELETE en propuestas_ia; lanza PROPUESTA_CON_EMISION (MDE01) si hay boleta no anulada/no sandbox o emision_jobs created/running/revision_pendiente.';

-- La función es de trigger: nadie la llama directo.
revoke all on function public.propuestas_ia_candado_emision() from public, anon, authenticated;

drop trigger if exists trg_propuestas_ia_candado_emision on public.propuestas_ia;
create trigger trg_propuestas_ia_candado_emision
  before delete on public.propuestas_ia
  for each row execute function public.propuestas_ia_candado_emision();
