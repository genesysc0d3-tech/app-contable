-- 20260630: Captura de consentimiento en el registro (bloque B — legal)
--
-- Burden of proof (Ley 19.628; Ley 21.719 Art. 12 cuando rija): la carga de PROBAR el
-- consentimiento es del responsable (nosotros). Hoy se capturaba 0 prueba. Esta tabla
-- guarda evidencia INMUTABLE (escrita por service-role) de que el usuario aceptó la
-- Política de Privacidad + los Términos al registrarse: versión del documento, IP, user
-- agent y fecha. Sirve también para atender solicitudes ARCO (el titular puede ver su
-- propio registro).

create table if not exists public.consentimientos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  email text,
  documento text not null default 'politica-privacidad+terminos',
  version text not null,
  ip text,
  user_agent text,
  aceptado_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists consentimientos_user_id_idx on public.consentimientos(user_id);

alter table public.consentimientos enable row level security;

-- El titular puede LEER su propio consentimiento (transparencia / ARCO). Nadie escribe
-- vía anon/authenticated: las inserciones van por service-role (bypassa RLS).
drop policy if exists "usuario lee su consentimiento" on public.consentimientos;
create policy "usuario lee su consentimiento" on public.consentimientos
  for select using (auth.uid() = user_id);
