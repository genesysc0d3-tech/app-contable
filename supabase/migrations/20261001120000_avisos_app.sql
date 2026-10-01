-- AVISOS Y NOVEDADES dentro de la app (2026-10-01).
--
-- El operador escribe desde /dev → Avisos (server action con el guard del
-- operador + ops_events). La app los entrega en pedidos que YA hace (render del
-- layout y /api/mesa), con UNA consulta indexada por vigencia y caché corta: cero
-- sondeo. Cada persona ve cada aviso UNA vez en cualquier computador
-- (avisos_vistos, PK compuesta), y lo marca directo contra Supabase con su token:
-- este RLS es la última línea.
--
--   tipo     'novedad' | 'mantencion' | 'urgente'
--   formato  'toast' | 'tarjeta' | 'popup'   (popup SOLO urgente)
--   desde/hasta  vive en [desde, hasta)
--   empresa_ids  null = todas; si no, solo esas empresas (la ACTIVA del usuario)
--   mesa         null = en cualquier parte; 'boletas'|'facturas' = mirando esa mesa
--                (el RLS no sabe qué mesa se mira: eso lo filtra la pantalla)
--   version_min  "novedades de esta versión": fecha ISO de build (la pestaña igual
--                o más nueva) o commit (solo esa versión). Lo filtra la pantalla.

create table if not exists public.avisos_app (
  id uuid primary key default gen_random_uuid(),
  tipo text not null check (tipo in ('novedad', 'mantencion', 'urgente')),
  titulo text not null check (char_length(btrim(titulo)) between 1 and 120),
  cuerpo text not null default '' check (char_length(cuerpo) <= 600),
  formato text not null check (formato in ('toast', 'tarjeta', 'popup')),
  desde timestamptz not null default now(),
  hasta timestamptz not null,
  empresa_ids uuid[],
  mesa text check (mesa in ('boletas', 'facturas')),
  version_min text check (version_min is null or char_length(version_min) between 1 and 64),
  activo boolean not null default true,
  creado_por text,
  created_at timestamptz not null default now(),
  updated_at timestamptz,
  constraint avisos_app_rango check (hasta > desde),
  constraint avisos_app_popup_solo_urgente check (formato <> 'popup' or tipo = 'urgente'),
  constraint avisos_app_empresas_no_vacia check (empresa_ids is null or cardinality(empresa_ids) > 0)
);

comment on table public.avisos_app is
  'Avisos/novedades que ve la clienta dentro de la app. Escribe SOLO el service role (/dev con guard del operador). Lectura por RLS: activos, vigentes y de su empresa activa.';

-- La única consulta de la app: activo and desde <= now() and hasta > now().
-- Parcial por activo: los desactivados no pesan nunca.
create index if not exists idx_avisos_app_vigentes
  on public.avisos_app (hasta, desde)
  where activo;

create table if not exists public.avisos_vistos (
  aviso_id uuid not null references public.avisos_app(id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  visto_en timestamptz not null default now(),
  primary key (aviso_id, user_id)
);

comment on table public.avisos_vistos is
  'Quién cerró cada aviso (visto UNA vez por persona, en cualquier computador). La clienta inserta lo suyo directo por PostgREST; RLS: solo propios y solo avisos que puede ver.';

-- Borrar un usuario (derechos 21.719) arrastra sus vistos por la FK; este índice
-- evita el seq scan del cascade.
create index if not exists idx_avisos_vistos_user
  on public.avisos_vistos (user_id);

-- ── RLS ──────────────────────────────────────────────────────────────────────
alter table public.avisos_app enable row level security;
alter table public.avisos_vistos enable row level security;

create policy avisos_app_lectura_vigentes on public.avisos_app
  for select
  to authenticated
  using (
    activo
    and desde <= now()
    and hasta > now()
    and (empresa_ids is null or (select public.empresa_autorizada()) = any(empresa_ids))
  );

create policy avisos_vistos_lectura_propios on public.avisos_vistos
  for select
  to authenticated
  using (user_id = (select auth.uid()));

-- El EXISTS corre con el RLS de quien inserta: solo puede marcar avisos que hoy
-- puede ver (vigentes y de su audiencia). Sin update ni delete: visto es para siempre.
create policy avisos_vistos_marcar_propios on public.avisos_vistos
  for insert
  to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (select 1 from public.avisos_app a where a.id = aviso_id)
  );

-- Cinturón: aunque alguien agregue una policy por error, los roles del cliente
-- no tienen el privilegio de escribir avisos ni de editar/borrar vistos.
revoke all on public.avisos_app from anon;
revoke all on public.avisos_vistos from anon;
revoke insert, update, delete, truncate on public.avisos_app from anon, authenticated;
revoke update, delete, truncate on public.avisos_vistos from anon, authenticated;
grant select on public.avisos_app to authenticated;
grant select, insert on public.avisos_vistos to authenticated;

-- DOWN: archivo hermano 20261001120000_avisos_app_DOWN.sql
