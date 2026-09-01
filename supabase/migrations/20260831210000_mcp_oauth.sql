-- OAuth 2.1 del conector MCP (el "iniciar sesión con massDTE" que exigen
-- claude.ai y ChatGPT para conectores remotos — estándar de autorización MCP:
-- RFC 8414 metadata + RFC 7591 registro dinámico + PKCE S256 obligatorio).
--
-- Todo deny-all bajo RLS: solo el service role del servidor OAuth las toca.
-- Los secretos (código y refresh) viven HASHEADOS, igual que mcp_tokens.
--
-- APLICAR A PROD con el ritual: respaldo previo. Cambio ADITIVO.
--
-- _DOWN:
--   alter table public.mcp_tokens
--     drop column if exists client_id,
--     drop column if exists expires_at,
--     drop column if exists refresh_token_hash,
--     drop column if exists origen;
--   drop table if exists public.oauth_codes;
--   drop table if exists public.oauth_clients;
--   (solo desconecta conectores OAuth; ningún dato de negocio)

-- Clientes registrados dinámicamente (Claude, ChatGPT, etc. se registran solos).
create table if not exists public.oauth_clients (
  id uuid primary key default gen_random_uuid(),
  client_name text not null default 'cliente MCP',
  redirect_uris jsonb not null,
  created_at timestamptz not null default now()
);
alter table public.oauth_clients enable row level security;

-- Códigos de autorización: un solo uso, TTL corto, PKCE amarrado.
create table if not exists public.oauth_codes (
  code_hash text primary key,
  client_id uuid not null references public.oauth_clients(id) on delete cascade,
  usuario_id uuid not null references public.usuarios(id) on delete cascade,
  redirect_uri text not null,
  code_challenge text not null,
  scope text not null default 'revision',
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.oauth_codes enable row level security;
create index if not exists idx_oauth_codes_expira on public.oauth_codes(expires_at);

-- mcp_tokens crece para hospedar los tokens OAuth (los manuales del script
-- siguen igual: origen 'manual', sin expiración, sin client).
alter table public.mcp_tokens
  add column if not exists client_id uuid references public.oauth_clients(id) on delete cascade,
  add column if not exists expires_at timestamptz,
  add column if not exists refresh_token_hash text,
  add column if not exists origen text not null default 'manual';

create index if not exists idx_mcp_tokens_refresh on public.mcp_tokens(refresh_token_hash) where refresh_token_hash is not null;
