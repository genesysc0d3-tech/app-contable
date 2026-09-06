-- Team Business, fase 1 (2026-09-06): la PUERTA.
--
-- Diseño del fundador: en el popup del botón de empresa se agrega alguien al
-- team y se marca con TICKS qué empresas de la cuenta puede ver. Sin tick no
-- ve nada de esa empresa — ni por la app ni por la base. El titular ve todo.
--
-- Cuatro piezas, una sola regla:
--   1. Business trae 3 personas (antes 1: no se podía invitar a nadie).
--   2. `cuenta_usuario_empresas` = los ticks. Fila = permiso. Sin fila = no.
--   3. `empresa_autorizada()` exige el tick (o ser titular). Es la regla única
--      de las 17 policies: cambia acá y cambia en todas.
--   4. La invitación lleva los ticks (`empresas_permitidas`) y al aceptar se
--      copian de la FILA, jamás del request.
-- Más dos RPC que faltaban: quitar a alguien (atómico: membresía, ticks y
-- conector MCP en la misma transacción) y editar sus ticks.

-- 1 ─────────────────────────────────────────────────────────────────────────
update public.planes_config
set personas_incluidas = 3,
    features = (
      select coalesce(jsonb_agg(
        case when f::text like '"Equipo%'
          then to_jsonb('Equipo: hasta 3 personas, cada una ve solo las empresas que le marques'::text)
          else f end), features)
      from jsonb_array_elements(features) as f),
    updated_at = now()
where codigo = 'business';

-- 2 ─────────────────────────────────────────────────────────────────────────
create table if not exists public.cuenta_usuario_empresas (
  cuenta_id uuid not null references public.cuentas(id) on delete cascade,
  usuario_id uuid not null references public.usuarios(id) on delete cascade,
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (cuenta_id, usuario_id, empresa_id),
  -- Un tick sin membresía no existe: al borrar la membresía caen sus ticks.
  foreign key (cuenta_id, usuario_id)
    references public.cuenta_usuarios(cuenta_id, usuario_id) on delete cascade
);

comment on table public.cuenta_usuario_empresas is
  'Los ticks del team: qué empresas de la cuenta puede ver cada miembro. Fila = permiso; sin fila = no ve esa empresa (fail-closed). El titular no necesita filas: ve todo. Escribe solo el service role vía las RPC team_*.';

create index if not exists idx_cuenta_usuario_empresas_usuario
  on public.cuenta_usuario_empresas(usuario_id, empresa_id);

alter table public.cuenta_usuario_empresas enable row level security;

-- Los miembros activos de la cuenta ven los ticks de su cuenta (para pintar
-- el team). Nadie escribe por PostgREST: solo las RPC.
drop policy if exists cuenta_usuario_empresas_select on public.cuenta_usuario_empresas;
create policy cuenta_usuario_empresas_select on public.cuenta_usuario_empresas
  for select to authenticated
  using (
    exists (
      select 1 from public.cuenta_usuarios cu
      where cu.cuenta_id = cuenta_usuario_empresas.cuenta_id
        and cu.usuario_id = (select auth.uid())
        and cu.activo
    )
  );

-- Backfill: si hoy existiera un miembro NO titular (en prod hay cero), recibe
-- tick en todas las empresas activas de su cuenta — así nada que hoy ve deja
-- de verse al encender la regla.
insert into public.cuenta_usuario_empresas (cuenta_id, usuario_id, empresa_id)
select cu.cuenta_id, cu.usuario_id, ce.empresa_id
from public.cuenta_usuarios cu
join public.cuentas c on c.id = cu.cuenta_id
join public.cuenta_empresas ce on ce.cuenta_id = cu.cuenta_id and ce.activa
where cu.activo
  and cu.es_titular = false
  and c.owner_usuario_id is distinct from cu.usuario_id
on conflict do nothing;

-- 3 ─────────────────────────────────────────────────────────────────────────
-- Misma función, una condición más: además de ser miembro activo de la cuenta
-- donde vive la empresa, hay que ser titular O tener el tick de ESA empresa.
create or replace function public.empresa_autorizada()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select u.empresa_id
  from public.usuarios u
  where u.id = (select auth.uid())
    and u.vetado is not true
    and exists (
      select 1
      from public.cuenta_empresas ce
      join public.cuenta_usuarios cu on cu.cuenta_id = ce.cuenta_id
      join public.cuentas c on c.id = ce.cuenta_id
      where ce.empresa_id = u.empresa_id
        and ce.activa
        and cu.usuario_id = u.id
        and cu.activo
        and (
          c.owner_usuario_id = u.id
          or cu.es_titular
          or exists (
            select 1 from public.cuenta_usuario_empresas t
            where t.cuenta_id = ce.cuenta_id
              and t.usuario_id = u.id
              and t.empresa_id = u.empresa_id
          )
        )
    )
$$;

comment on function public.empresa_autorizada() is
  'La empresa que este usuario puede tocar: la que tiene activa, que vive en una cuenta donde es miembro activo, Y donde es titular o tiene el tick de esa empresa (cuenta_usuario_empresas). NULL si no corresponde ninguna (y `empresa_id = NULL` deniega). Es la regla del RLS: cambiarla acá cambia las 17 policies.';

-- 4 ─────────────────────────────────────────────────────────────────────────
alter table public.empresa_invitaciones
  add column if not exists empresas_permitidas uuid[];

comment on column public.empresa_invitaciones.empresas_permitidas is
  'Ticks que recibirá la persona al aceptar. NULL = todas las empresas activas de la cuenta al momento de aceptar. Se copian de esta fila, jamás del request.';

-- La invitación de antes no sabía de ticks: se reemplaza (misma lógica, un
-- parámetro más) y se elimina la firma vieja para que no queden dos.
drop function if exists public.crear_empresa_invitacion_titular(uuid, text, text, text, uuid, timestamptz);

create or replace function public.crear_empresa_invitacion_titular(
  p_empresa_id uuid,
  p_email text,
  p_rol text,
  p_token_hash text,
  p_invited_by uuid,
  p_expires_at timestamptz,
  p_empresas_permitidas uuid[] default null
)
returns table(ok boolean, invitacion_id uuid, cuenta_id uuid, error text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := lower(trim(coalesce(p_email, '')));
  v_cuenta_id uuid;
  v_plan_codigo text;
  v_plan_activo boolean := false;
  v_equipo boolean := false;
  v_personas_incluidas integer := 1;
  v_personas_extra integer := 0;
  v_limite integer := 1;
  v_personas_activas integer := 0;
  v_invitaciones_pendientes integer := 0;
  v_invitacion_id uuid;
  v_ticks uuid[];
begin
  if p_empresa_id is null then
    return query select false, null::uuid, null::uuid, 'EMPRESA_REQUERIDA';
    return;
  end if;

  if p_invited_by is null then
    return query select false, null::uuid, null::uuid, 'USUARIO_REQUERIDO';
    return;
  end if;

  if v_email = '' or position('@' in v_email) = 0 then
    return query select false, null::uuid, null::uuid, 'EMAIL_INVALIDO';
    return;
  end if;

  if p_rol not in ('admin', 'contador', 'viewer') then
    return query select false, null::uuid, null::uuid, 'ROL_INVALIDO';
    return;
  end if;

  if p_token_hash is null or length(trim(p_token_hash)) < 32 then
    return query select false, null::uuid, null::uuid, 'TOKEN_INVALIDO';
    return;
  end if;

  select ce.cuenta_id
    into v_cuenta_id
  from public.cuenta_empresas ce
  where ce.empresa_id = p_empresa_id
    and ce.activa = true
  limit 1;

  if v_cuenta_id is null then
    return query select false, null::uuid, null::uuid, 'CUENTA_NO_CONFIGURADA';
    return;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_cuenta_id::text, 0));

  if not exists (
    select 1
    from public.cuentas c
    left join public.cuenta_usuarios cu
      on cu.cuenta_id = c.id
     and cu.usuario_id = p_invited_by
     and cu.activo = true
    where c.id = v_cuenta_id
      and (
        c.owner_usuario_id = p_invited_by
        or cu.es_titular = true
      )
  ) then
    return query select false, null::uuid, v_cuenta_id, 'SOLO_TITULAR_CUENTA';
    return;
  end if;

  -- Ticks: sin duplicados, y TODOS de empresas activas de esta cuenta. Una
  -- lista vacía no es "ninguna empresa" (esa persona no vería nada): es error.
  if p_empresas_permitidas is not null then
    select array_agg(distinct e) into v_ticks from unnest(p_empresas_permitidas) as e where e is not null;
    if v_ticks is null or cardinality(v_ticks) = 0 then
      return query select false, null::uuid, v_cuenta_id, 'TICKS_VACIOS';
      return;
    end if;
    if exists (
      select 1 from unnest(v_ticks) as e
      where not exists (
        select 1 from public.cuenta_empresas ce
        where ce.cuenta_id = v_cuenta_id and ce.empresa_id = e and ce.activa
      )
    ) then
      return query select false, null::uuid, v_cuenta_id, 'TICK_FUERA_DE_CUENTA';
      return;
    end if;
  end if;

  select coalesce(s.plan_codigo, c.plan_codigo), coalesce(c.plan_activo, false) or (s.id is not null)
    into v_plan_codigo, v_plan_activo
  from public.cuentas c
  left join lateral (
    select s2.id, s2.plan_codigo
    from public.suscripciones s2
    where s2.cuenta_id = v_cuenta_id
      and s2.estado = 'activa'
    order by s2.created_at desc
    limit 1
  ) s on true
  where c.id = v_cuenta_id;

  if v_plan_codigo is null or v_plan_activo is not true then
    return query select false, null::uuid, v_cuenta_id, 'PLAN_INACTIVO';
    return;
  end if;

  select coalesce(pc.equipo, false), coalesce(pc.personas_incluidas, 1)
    into v_equipo, v_personas_incluidas
  from public.planes_config pc
  where pc.codigo = v_plan_codigo;

  if v_equipo is not true then
    return query select false, null::uuid, v_cuenta_id, 'EQUIPO_NO_DISPONIBLE';
    return;
  end if;

  update public.empresa_invitaciones ei
     set estado = 'expirada'
  from public.cuenta_empresas ce
  where ce.cuenta_id = v_cuenta_id
    and ce.activa = true
    and ei.empresa_id = ce.empresa_id
    and ei.estado = 'pendiente'
    and ei.expires_at <= now();

  select coalesce(sum(ca.cantidad), 0)::integer
    into v_personas_extra
  from public.cuenta_addons ca
  where ca.cuenta_id = v_cuenta_id
    and ca.tipo = 'persona_adicional'
    and ca.estado = 'activo';

  v_limite := greatest(1, v_personas_incluidas + v_personas_extra);

  select count(*)::integer
    into v_personas_activas
  from public.cuenta_usuarios cu
  where cu.cuenta_id = v_cuenta_id
    and cu.activo = true;

  select count(*)::integer
    into v_invitaciones_pendientes
  from public.empresa_invitaciones ei
  join public.cuenta_empresas ce on ce.empresa_id = ei.empresa_id
  where ce.cuenta_id = v_cuenta_id
    and ce.activa = true
    and ei.estado = 'pendiente'
    and ei.expires_at > now();

  if v_personas_activas + v_invitaciones_pendientes >= v_limite then
    return query select false, null::uuid, v_cuenta_id, 'CUPO_PERSONAS_AGOTADO';
    return;
  end if;

  if exists (
    select 1
    from public.usuarios u
    join public.cuenta_usuarios cu on cu.usuario_id = u.id
    where cu.cuenta_id = v_cuenta_id
      and cu.activo = true
      and lower(u.email) = v_email
  ) then
    return query select false, null::uuid, v_cuenta_id, 'EMAIL_YA_EN_CUENTA';
    return;
  end if;

  if exists (
    select 1
    from public.empresa_invitaciones ei
    join public.cuenta_empresas ce on ce.empresa_id = ei.empresa_id
    where ce.cuenta_id = v_cuenta_id
      and ce.activa = true
      and ei.estado = 'pendiente'
      and ei.expires_at > now()
      and lower(ei.email) = v_email
  ) then
    return query select false, null::uuid, v_cuenta_id, 'INVITACION_YA_EXISTE';
    return;
  end if;

  insert into public.empresa_invitaciones (
    empresa_id, email, rol, token_hash, invited_by, expires_at, empresas_permitidas
  ) values (
    p_empresa_id, v_email, p_rol, p_token_hash, p_invited_by, p_expires_at, v_ticks
  )
  returning id into v_invitacion_id;

  return query select true, v_invitacion_id, v_cuenta_id, null::text;
exception
  when unique_violation then
    return query select false, null::uuid, v_cuenta_id, 'INVITACION_YA_EXISTE';
end;
$$;

revoke all on function public.crear_empresa_invitacion_titular(uuid, text, text, text, uuid, timestamptz, uuid[]) from public, anon, authenticated;
grant execute on function public.crear_empresa_invitacion_titular(uuid, text, text, text, uuid, timestamptz, uuid[]) to service_role;

-- 5 ─────────────────────────────────────────────────────────────────────────
-- Quién manda sobre el team: el titular de la cuenta. Misma regla que la
-- invitación, en un solo lugar.
create or replace function public.team_es_titular(p_cuenta_id uuid, p_usuario_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.cuentas c
    left join public.cuenta_usuarios cu
      on cu.cuenta_id = c.id and cu.usuario_id = p_usuario_id and cu.activo
    where c.id = p_cuenta_id
      and (c.owner_usuario_id = p_usuario_id or cu.es_titular)
  )
$$;
revoke all on function public.team_es_titular(uuid, uuid) from public, anon, authenticated;
grant execute on function public.team_es_titular(uuid, uuid) to service_role;

-- Editar los ticks de un miembro. Si su empresa activa deja de estar marcada,
-- se lo mueve a la primera que sí — nunca queda parado en una que no ve.
create or replace function public.team_actualizar_ticks(
  p_cuenta_id uuid,
  p_usuario_id uuid,
  p_empresas uuid[],
  p_by uuid
)
returns table(ok boolean, error text, empresa_activa uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ticks uuid[];
  v_actual uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_cuenta_id::text, 0));

  if not public.team_es_titular(p_cuenta_id, p_by) then
    return query select false, 'SOLO_TITULAR_CUENTA', null::uuid; return;
  end if;
  if public.team_es_titular(p_cuenta_id, p_usuario_id) then
    return query select false, 'TITULAR_VE_TODO', null::uuid; return;
  end if;
  if not exists (
    select 1 from public.cuenta_usuarios cu
    where cu.cuenta_id = p_cuenta_id and cu.usuario_id = p_usuario_id and cu.activo
  ) then
    return query select false, 'NO_ES_MIEMBRO', null::uuid; return;
  end if;

  select array_agg(distinct e) into v_ticks from unnest(coalesce(p_empresas, '{}')) as e where e is not null;
  if v_ticks is null or cardinality(v_ticks) = 0 then
    return query select false, 'TICKS_VACIOS', null::uuid; return;
  end if;
  if exists (
    select 1 from unnest(v_ticks) as e
    where not exists (
      select 1 from public.cuenta_empresas ce
      where ce.cuenta_id = p_cuenta_id and ce.empresa_id = e and ce.activa
    )
  ) then
    return query select false, 'TICK_FUERA_DE_CUENTA', null::uuid; return;
  end if;

  delete from public.cuenta_usuario_empresas t
  where t.cuenta_id = p_cuenta_id and t.usuario_id = p_usuario_id
    and t.empresa_id <> all (v_ticks);

  insert into public.cuenta_usuario_empresas (cuenta_id, usuario_id, empresa_id)
  select p_cuenta_id, p_usuario_id, e from unnest(v_ticks) as e
  on conflict do nothing;

  select u.empresa_id into v_actual from public.usuarios u where u.id = p_usuario_id;
  if v_actual is null or v_actual <> all (v_ticks) then
    v_actual := v_ticks[1];
    update public.usuarios set empresa_id = v_actual where id = p_usuario_id;
  end if;

  return query select true, null::text, v_actual;
end;
$$;
revoke all on function public.team_actualizar_ticks(uuid, uuid, uuid[], uuid) from public, anon, authenticated;
grant execute on function public.team_actualizar_ticks(uuid, uuid, uuid[], uuid) to service_role;

-- Quitar a alguien del team: membresía inactiva (la base le cierra las 17
-- policies al instante), ticks fuera, y su conector MCP revocado — todo en la
-- misma transacción. `usuarios.empresa_id` es NOT NULL y se deja: sin
-- membresía activa, empresa_autorizada() devuelve NULL y no ve nada.
create or replace function public.team_quitar_miembro(
  p_cuenta_id uuid,
  p_usuario_id uuid,
  p_by uuid
)
returns table(ok boolean, error text, tokens_revocados integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tokens integer := 0;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_cuenta_id::text, 0));

  if not public.team_es_titular(p_cuenta_id, p_by) then
    return query select false, 'SOLO_TITULAR_CUENTA', 0; return;
  end if;
  if p_usuario_id = p_by or public.team_es_titular(p_cuenta_id, p_usuario_id) then
    return query select false, 'NO_SE_QUITA_AL_TITULAR', 0; return;
  end if;
  if not exists (
    select 1 from public.cuenta_usuarios cu
    where cu.cuenta_id = p_cuenta_id and cu.usuario_id = p_usuario_id and cu.activo
  ) then
    return query select false, 'NO_ES_MIEMBRO', 0; return;
  end if;

  delete from public.cuenta_usuario_empresas t
  where t.cuenta_id = p_cuenta_id and t.usuario_id = p_usuario_id;

  update public.cuenta_usuarios
     set activo = false
   where cuenta_id = p_cuenta_id and usuario_id = p_usuario_id;

  with r as (
    update public.mcp_tokens
       set revoked_at = now(), refresh_token_hash = null
     where usuario_id = p_usuario_id and revoked_at is null
    returning 1
  ) select count(*)::integer into v_tokens from r;

  return query select true, null::text, v_tokens;
end;
$$;
revoke all on function public.team_quitar_miembro(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.team_quitar_miembro(uuid, uuid, uuid) to service_role;

-- Revocar una invitación pendiente (libera el cupo que reservaba).
create or replace function public.team_revocar_invitacion(
  p_invitacion_id uuid,
  p_by uuid
)
returns table(ok boolean, error text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cuenta_id uuid;
begin
  select ce.cuenta_id into v_cuenta_id
  from public.empresa_invitaciones ei
  join public.cuenta_empresas ce on ce.empresa_id = ei.empresa_id and ce.activa
  where ei.id = p_invitacion_id;

  if v_cuenta_id is null then
    return query select false, 'INVITACION_NO_EXISTE'; return;
  end if;
  if not public.team_es_titular(v_cuenta_id, p_by) then
    return query select false, 'SOLO_TITULAR_CUENTA'; return;
  end if;

  update public.empresa_invitaciones
     set estado = 'revocada'
   where id = p_invitacion_id and estado = 'pendiente';

  if not found then
    return query select false, 'INVITACION_NO_PENDIENTE'; return;
  end if;
  return query select true, null::text;
end;
$$;
revoke all on function public.team_revocar_invitacion(uuid, uuid) from public, anon, authenticated;
grant execute on function public.team_revocar_invitacion(uuid, uuid) to service_role;
