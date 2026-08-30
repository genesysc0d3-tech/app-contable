-- VUELTA ATRÁS de la tumba de usuario_empresas. NO APLICAR salvo emergencia.
-- Restaura esquema, policy, función Y las 10 filas que existían al momento del
-- drop (volcadas de producción el 2026-08-31, antes de correr la de ida).
-- Ojo: los inserts llevan on conflict/violación de FK tolerada — si algún
-- usuario o empresa fue borrado después de la tumba, esa fila se pierde y es
-- correcto que se pierda.

create table if not exists public.usuario_empresas (
  usuario_id uuid not null references public.usuarios(id) on delete cascade,
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  rol text not null default 'titular',
  created_at timestamptz not null default now(),
  primary key (usuario_id, empresa_id)
);

alter table public.usuario_empresas enable row level security;

drop policy if exists "usuario ve sus membresias" on public.usuario_empresas;
create policy "usuario ve sus membresias" on public.usuario_empresas
  for select using (usuario_id = auth.uid());

create or replace function public.empresas_del_usuario()
returns setof uuid language sql stable security definer set search_path = public as $func$
  select empresa_id from public.usuario_empresas where usuario_id = auth.uid()
$func$;

-- Las 10 filas, tal como estaban. Se insertan una a una tolerando FKs muertas.
do $$
declare
  fila record;
begin
  for fila in
    select * from (values
      ('08512bc5-5d8c-4970-9de5-683c0911f9d5'::uuid, '5fe96a36-9f7e-408c-b315-2b55d534e1d1'::uuid, 'titular',       '2026-06-11 00:07:14.979829+00'::timestamptz),
      ('08512bc5-5d8c-4970-9de5-683c0911f9d5'::uuid, '00000000-0000-4000-8000-0000000000a1'::uuid, 'fixture_audit', '2026-06-21 05:01:07.150529+00'::timestamptz),
      ('08512bc5-5d8c-4970-9de5-683c0911f9d5'::uuid, '00000000-0000-4000-8000-0000000000b1'::uuid, 'fixture_audit', '2026-06-21 05:01:07.150529+00'::timestamptz),
      ('fc3fd46f-d015-4c4b-a834-8fdafcc77c27'::uuid, '750ae9cd-efbc-4cb7-9131-0670a28604e9'::uuid, 'titular',       '2026-06-30 02:51:31.027293+00'::timestamptz),
      ('4653276f-6868-437e-8366-941277d8ed0c'::uuid, 'bdcbd5d9-cb2e-4237-a1d3-0a9d1664718f'::uuid, 'titular',       '2026-07-27 01:11:39.27726+00'::timestamptz),
      ('5ac1db71-936b-483e-acb7-89da764d6df3'::uuid, '96d4e20e-c70f-490c-aca5-46561253feb9'::uuid, 'titular',       '2026-08-11 20:16:44.570715+00'::timestamptz),
      ('04c4f3ff-a6a0-4463-b3db-6d94cf4b55eb'::uuid, '76a468d2-4926-4e89-b24b-5e2a55420321'::uuid, 'titular',       '2026-08-11 23:53:58.748707+00'::timestamptz),
      ('942748b0-827b-4929-b443-8858c0d26ab2'::uuid, '607ec0d9-f05b-49d3-a701-bec01dbf84b5'::uuid, 'titular',       '2026-08-19 05:37:41.49314+00'::timestamptz),
      ('fc1ca54b-6457-4350-bc78-2bc9a1bfdb49'::uuid, 'b1c8d908-744b-44cb-863d-b75dd6f1cf18'::uuid, 'titular',       '2026-08-21 05:48:44.474427+00'::timestamptz),
      ('04c4f3ff-a6a0-4463-b3db-6d94cf4b55eb'::uuid, '3b5ee4d8-0b4c-4bdd-b4ef-11580a4155b4'::uuid, 'titular',       '2026-08-22 07:31:06.050843+00'::timestamptz)
    ) as t(usuario_id, empresa_id, rol, created_at)
  loop
    begin
      insert into public.usuario_empresas (usuario_id, empresa_id, rol, created_at)
      values (fila.usuario_id, fila.empresa_id, fila.rol, fila.created_at)
      on conflict (usuario_id, empresa_id) do nothing;
    exception when foreign_key_violation then
      raise notice 'Fila saltada (FK muerta): % / %', fila.usuario_id, fila.empresa_id;
    end;
  end loop;
end $$;
