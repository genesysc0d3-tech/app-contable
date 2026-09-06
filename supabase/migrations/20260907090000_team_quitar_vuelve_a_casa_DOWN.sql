-- DOWN de 20260907090000_team_quitar_vuelve_a_casa.sql: vuelve la RPC sin el 'vuelve a casa'
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
