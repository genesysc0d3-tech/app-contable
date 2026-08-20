-- Telemetría de flota de la extensión (aditiva, sin RLS nuevo: columnas de
-- empresas, mismas políticas existentes).
--
-- La versión de la extensión solo vivía en el PING/PONG dentro de la pestaña:
-- imposible saber qué versión corre cada cliente sin preguntarle. Desde la
-- 0.1.7 el app-bridge adjunta extension_version en cada POST de resultado y
-- el server la anota acá. Consulta típica:
--   select razon_social, ext_last_version, ext_last_seen_at from empresas
--   where ext_last_version is not null order by ext_last_seen_at desc;

alter table public.empresas
  add column if not exists ext_last_version text,
  add column if not exists ext_last_seen_at timestamptz;
