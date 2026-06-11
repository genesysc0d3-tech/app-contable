-- BASES de multi-empresa (sin construir la herramienta del contador todavía).
-- Hoy: un usuario = una empresa (usuarios.empresa_id = empresa ACTIVA). Esto NO
-- cambia. Solo se agrega la capa de MEMBRESÍA (usuario ↔ empresas, muchos a
-- muchos) lista para el día que un contador, con un login, deba acceder a
-- varias empresas-cliente.
--
-- PARA ACTIVAR el multi-empresa en el futuro (la "herramienta"):
--   1. Insertar filas en usuario_empresas (el contador ↔ cada empresa-cliente).
--   2. Cambiar las políticas RLS de las tablas con empresa_id de
--      `empresa_id IN (SELECT empresa_id FROM usuarios WHERE id = auth.uid())`
--      a `empresa_id IN (SELECT public.empresas_del_usuario())`.
--   3. Agregar un selector de "empresa activa" en la UI (usuarios.empresa_id).
-- Mientras tanto, las bases quedan backfilleadas y seguras; nada cambia hoy.

create table if not exists public.usuario_empresas (
  usuario_id uuid not null references public.usuarios(id) on delete cascade,
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  rol text not null default 'titular',   -- titular | contador | colaborador
  created_at timestamptz not null default now(),
  primary key (usuario_id, empresa_id)
);

alter table public.usuario_empresas enable row level security;

-- Backfill: cada usuario con empresa → una membresía 'titular'.
insert into public.usuario_empresas (usuario_id, empresa_id, rol)
select id, empresa_id, 'titular' from public.usuarios where empresa_id is not null
on conflict (usuario_id, empresa_id) do nothing;

-- RLS: cada usuario ve solo sus propias membresías; la gestión es vía service-role.
drop policy if exists "usuario ve sus membresias" on public.usuario_empresas;
create policy "usuario ve sus membresias" on public.usuario_empresas
  for select using (usuario_id = auth.uid());

-- Helper para las futuras políticas multi-empresa (ver paso 2 arriba).
create or replace function public.empresas_del_usuario()
returns setof uuid language sql stable security definer set search_path = public as $func$
  select empresa_id from public.usuario_empresas where usuario_id = auth.uid()
$func$;
