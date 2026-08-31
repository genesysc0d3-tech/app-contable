-- Tokens del conector MCP (copiloto de revisión, fase 1).
--
-- El token viaja como Bearer y acá vive SOLO su hash sha256: un dump de la
-- tabla no sirve para conectarse. Deny-all bajo RLS (sin policies): solo el
-- service role del servidor MCP la lee — mismo patrón que las tablas de jobs.
--
-- APLICAR A PROD con el ritual de siempre: respaldo del Mac mini ANTES.
-- Cambio aditivo: no toca ninguna fila existente.
--
-- _DOWN:
--   drop table if exists public.mcp_tokens;
--   (no destruye datos de negocio; solo revoca todos los conectores)

create table if not exists public.mcp_tokens (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null references public.usuarios(id) on delete cascade,
  token_hash text not null unique,
  nombre text not null default 'conector',
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);

alter table public.mcp_tokens enable row level security;

create index if not exists idx_mcp_tokens_usuario on public.mcp_tokens(usuario_id);
