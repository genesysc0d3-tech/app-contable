-- Bóveda SII v2 "llave partida" (envelope encryption).
--
-- La bóveda de credenciales SII de la extensión pasa de "passphrase manual por
-- emisión" a "desbloqueo automático con la sesión de la app". Para que el cifrado
-- en reposo siga siendo real, la llave se PARTE en dos mitades que nunca viven
-- juntas:
--   - En el equipo del usuario (chrome.storage.local): las credenciales SII
--     cifradas con una llave aleatoria VK, y VK envuelta bajo KEK=HKDF(WS).
--   - Aquí (servidor): WS, el "wrap secret" de 32 bytes por usuario+dispositivo.
-- Ninguna mitad sirve sola: el disco robado no tiene WS; el servidor no tiene el
-- ciphertext ni la Clave Tributaria (que JAMÁS sube). La sesión de la app es lo
-- único que autoriza pedir WS.
--
-- Esta tabla guarda SOLO WS (cifrado a su vez en reposo con un secreto de entorno,
-- defensa en profundidad: un dump de la DB no rinde llaves usables). Es SOLO
-- service-role: RLS habilitado SIN políticas de cliente ⇒ el JWT del usuario no
-- puede leerla vía PostgREST; solo el endpoint server-side (que autentica la
-- sesión) la toca. Ley 21.719 Art. 14 quinquies a) (cifrado) + Art. 14 quáter
-- (protección desde el diseño): la revocación por dispositivo (revoked_at / delete)
-- es la "medida de resguardo" del Art. 14 sexies para responder a una brecha.

create table if not exists public.extension_vault_keys (
  usuario_id uuid not null references public.usuarios(id) on delete cascade,
  device_id text not null,
  ws_cifrado text not null,            -- WS envuelto con el secreto de entorno (iv:tag:ct b64)
  version integer not null default 2,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz,
  primary key (usuario_id, device_id)
);

create index if not exists idx_extension_vault_keys_usuario
  on public.extension_vault_keys(usuario_id)
  where revoked_at is null;

-- SOLO service-role: RLS ON sin políticas de cliente = invisible al JWT del usuario.
-- (Mismo patrón que emision_locks: la escribe/lee únicamente el backend.)
alter table public.extension_vault_keys enable row level security;
