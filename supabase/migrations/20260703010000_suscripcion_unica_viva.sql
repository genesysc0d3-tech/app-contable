-- Defensa en profundidad (auditoría #5): a lo más UNA suscripción viva por cuenta.
-- crearSuscripcion() ya cancela en MP la preapproval anterior antes de crear la
-- nueva; este índice es el candado a nivel DB por si algún camino lo evade.
-- Primero deduplica filas vivas existentes (conserva la más reciente por cuenta),
-- si no, el CREATE INDEX fallaría.

with vivas as (
  select id,
         row_number() over (partition by cuenta_id order by created_at desc) as rn
  from public.suscripciones
  where estado in ('activa', 'pendiente', 'pausada', 'morosa')
    and cuenta_id is not null
)
update public.suscripciones s
set estado = 'cancelada', updated_at = now()
from vivas
where s.id = vivas.id and vivas.rn > 1;

create unique index if not exists ux_suscripciones_cuenta_viva
  on public.suscripciones (cuenta_id)
  where estado in ('activa', 'pendiente', 'pausada', 'morosa') and cuenta_id is not null;
