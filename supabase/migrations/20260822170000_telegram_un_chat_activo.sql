-- ── Un solo Telegram activo por empresa (candado en la capa insaltable) ──
-- Hallazgo 2026-08-22: telegram_chats amarra por chat_id, así que cada link
-- canjeado sumaba OTRO Telegram vinculado a la misma empresa y el anterior
-- nunca se desactivaba (cualquiera que alguna vez recibió un link quedaba
-- emitiendo para siempre). Regla nueva: 1 empresa = 1 chat activo; vincular
-- un Telegram nuevo desactiva el anterior (takeover explícito, con aviso).
--
-- Primero dormir duplicados existentes (se conserva el vínculo más reciente),
-- después el índice único parcial que hace la regla insaltable.

with ranked as (
  select chat_id,
         row_number() over (partition by empresa_id order by vinculado_at desc) as rn
  from public.telegram_chats
  where activo
)
update public.telegram_chats tc
set activo = false
from ranked r
where r.chat_id = tc.chat_id and r.rn > 1;

create unique index if not exists uq_telegram_chats_empresa_activo
  on public.telegram_chats(empresa_id)
  where activo;
