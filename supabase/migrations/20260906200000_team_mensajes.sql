-- Team Business, fase 3 (2026-09-06): el chat del team.
--
-- Diseño del fundador: vive en el globito de avisos; satélites de color cuando
-- alguien te escribió; "apuntar objeto" = referencia viva a un documento que
-- al hacer click te lleva ahí. Mensajes asíncronos (le escribes a alguien
-- desconectado y lo ve al entrar) → persisten acá.
--
-- Reglas firmadas:
--  * El chat vive a nivel CUENTA (cruza empresas). RLS por membresía activa.
--  * Solo lee quien envió o quien recibe. Escribe solo el service role (la
--    acción del servidor valida el tick del RECEPTOR sobre la empresa del
--    objeto apuntado: sin tick, "No puedes compartir esto con esa persona").
--  * NO entra a la publicación realtime de la mesa (cada mensaje vaciaría la
--    caché de todos): se entrega por poll + foco de la pestaña.
--  * Ley 21.719: texto escrito por humanos = dato personal. Cae con la cuenta
--    (cascade); si un miembro se borra, sus mensajes quedan sin autor (set
--    null) para no perder el hilo del otro. Jamás alimenta IA sin tokenizar.

create table if not exists public.team_mensajes (
  id uuid primary key default gen_random_uuid(),
  cuenta_id uuid not null references public.cuentas(id) on delete cascade,
  de_usuario_id uuid references public.usuarios(id) on delete set null,
  para_usuario_id uuid references public.usuarios(id) on delete set null,
  texto text not null check (char_length(texto) between 1 and 1000),
  -- Objeto apuntado (opcional): hoy solo documentos de la mesa.
  objeto_tipo text check (objeto_tipo in ('documento')),
  objeto_id uuid,
  objeto_empresa_id uuid references public.empresas(id) on delete set null,
  objeto_label text check (objeto_label is null or char_length(objeto_label) <= 120),
  objeto_mes text check (objeto_mes is null or objeto_mes ~ '^[0-9]{4}-[0-9]{1,2}$'),
  leido_at timestamptz,
  created_at timestamptz not null default now(),
  constraint team_mensajes_objeto_completo check (
    (objeto_tipo is null and objeto_id is null and objeto_empresa_id is null)
    or (objeto_tipo is not null and objeto_id is not null and objeto_empresa_id is not null)
  )
);

comment on table public.team_mensajes is
  'Chat del team (Business), 1 a 1, a nivel cuenta. Escribe solo el service role: la acción valida el tick del receptor sobre la empresa del objeto apuntado. No va en la publicación realtime: se entrega por poll.';

create index if not exists idx_team_mensajes_para
  on public.team_mensajes(para_usuario_id, created_at desc);
create index if not exists idx_team_mensajes_cuenta
  on public.team_mensajes(cuenta_id, created_at desc);

alter table public.team_mensajes enable row level security;

drop policy if exists team_mensajes_select on public.team_mensajes;
create policy team_mensajes_select on public.team_mensajes
  for select to authenticated
  using (
    ((select auth.uid()) = de_usuario_id or (select auth.uid()) = para_usuario_id)
    and exists (
      select 1 from public.cuenta_usuarios cu
      where cu.cuenta_id = team_mensajes.cuenta_id
        and cu.usuario_id = (select auth.uid())
        and cu.activo
    )
  );
