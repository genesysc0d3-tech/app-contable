-- Invitaciones de equipo Business:
-- - Solo la cuenta pagadora/titular puede agregar personas.
-- - Cada invitacion pendiente reserva un cupo hasta aceptarse/expirar.
-- - Cada addon activo persona_adicional suma un cupo.
-- - Advisory lock por cuenta para evitar doble invitacion concurrente sobre el limite.

create index if not exists idx_empresa_invitaciones_empresa_pendiente_expira
  on public.empresa_invitaciones (empresa_id, expires_at)
  where estado = 'pendiente';

create unique index if not exists ux_cuenta_addons_persona_pendiente
  on public.cuenta_addons (cuenta_id)
  where tipo = 'persona_adicional'
    and estado = 'pendiente';

create unique index if not exists ux_cuenta_addons_proveedor_ref
  on public.cuenta_addons (origen, proveedor_ref)
  where proveedor_ref is not null;

create or replace function public.crear_empresa_invitacion_titular(
  p_empresa_id uuid,
  p_email text,
  p_rol text,
  p_token_hash text,
  p_invited_by uuid,
  p_expires_at timestamptz
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

  select coalesce(s.plan_codigo, c.plan_codigo), coalesce(c.plan_activo, false) or (s.id is not null)
    into v_plan_codigo, v_plan_activo
  from public.cuentas c
  left join lateral (
    select id, plan_codigo
    from public.suscripciones
    where cuenta_id = v_cuenta_id
      and estado = 'activa'
    order by created_at desc
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
    empresa_id,
    email,
    rol,
    token_hash,
    invited_by,
    expires_at
  ) values (
    p_empresa_id,
    v_email,
    p_rol,
    p_token_hash,
    p_invited_by,
    p_expires_at
  )
  returning id into v_invitacion_id;

  return query select true, v_invitacion_id, v_cuenta_id, null::text;
exception
  when unique_violation then
    return query select false, null::uuid, v_cuenta_id, 'INVITACION_YA_EXISTE';
end;
$$;

revoke all on function public.crear_empresa_invitacion_titular(uuid, text, text, text, uuid, timestamptz) from public;
revoke all on function public.crear_empresa_invitacion_titular(uuid, text, text, text, uuid, timestamptz) from anon;
revoke all on function public.crear_empresa_invitacion_titular(uuid, text, text, text, uuid, timestamptz) from authenticated;
grant execute on function public.crear_empresa_invitacion_titular(uuid, text, text, text, uuid, timestamptz) to service_role;
