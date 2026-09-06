-- "Colaboras en", regla nº1 (fundador 2026-09-06): al quitar a alguien del
-- team, si estaba PARADO en una empresa de esa cuenta se lo devuelve a la
-- empresa principal de su cuenta propia (donde es titular). Antes su
-- `empresa_id` quedaba apuntando a la empresa ajena: la base le cerraba todo
-- (bien), pero también dejaba de ver su propia cuenta hasta que alguien lo
-- reapuntara a mano.
--
-- Si no tiene cuenta propia, se queda como estaba (sin membresía activa la
-- app lo manda a /bloqueado, igual que hoy).

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
  v_empresa_actual uuid;
  v_casa uuid;
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

  -- Vuelve a casa si estaba parado acá.
  select u.empresa_id into v_empresa_actual from public.usuarios u where u.id = p_usuario_id;
  if exists (
    select 1 from public.cuenta_empresas ce
    where ce.cuenta_id = p_cuenta_id and ce.empresa_id = v_empresa_actual
  ) then
    select ce.empresa_id into v_casa
    from public.cuenta_usuarios cu
    join public.cuentas c on c.id = cu.cuenta_id
    join public.cuenta_empresas ce on ce.cuenta_id = cu.cuenta_id and ce.activa
    where cu.usuario_id = p_usuario_id
      and cu.activo
      and cu.cuenta_id <> p_cuenta_id
      and (cu.es_titular or c.owner_usuario_id = p_usuario_id)
    order by ce.es_principal desc, ce.created_at asc
    limit 1;
    if v_casa is not null then
      update public.usuarios set empresa_id = v_casa where id = p_usuario_id;
    end if;
  end if;

  return query select true, null::text, v_tokens;
end;
$$;
revoke all on function public.team_quitar_miembro(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.team_quitar_miembro(uuid, uuid, uuid) to service_role;
