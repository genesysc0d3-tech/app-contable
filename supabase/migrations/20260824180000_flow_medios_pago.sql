-- Medio de pago inscrito por cuenta (tarjeta en archivo).
--
-- Por qué una tabla aparte y no una columna en `suscripciones`:
-- Flow separa INSCRIBIR la tarjeta de COBRARLA. La tarjeta sobrevive a que el
-- cliente cancele y vuelva a contratar; si viviera en `suscripciones` se
-- perdería en cada cancelación y habría que pedirla de nuevo.
--
-- Nunca guarda el número de tarjeta: Flow devuelve solo marca y últimos 4, y eso
-- es todo lo que se persiste. El cargo se hace contra `proveedor_ref` (el
-- customerId de la pasarela), que sin nuestras llaves no sirve de nada.
create table if not exists public.medios_pago (
  id uuid primary key default gen_random_uuid(),
  cuenta_id uuid not null references public.cuentas(id) on delete cascade,
  proveedor text not null,                          -- flow | mercadopago | manual
  proveedor_ref text not null,                      -- customerId en la pasarela
  ambiente text not null default 'production',      -- sandbox | production
  estado text not null default 'pendiente',         -- pendiente|inscrito|fallido|eliminado
  marca text,                                       -- Visa, Mastercard, Redcompra…
  ultimos4 text,
  inscrito_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Una sola tarjeta viva por cuenta y proveedor. El ambiente entra en la clave
-- para que las pruebas en sandbox no choquen con la tarjeta real de producción.
create unique index if not exists idx_medios_pago_vivo
  on public.medios_pago(cuenta_id, proveedor, ambiente)
  where estado in ('pendiente', 'inscrito');

create index if not exists idx_medios_pago_ref on public.medios_pago(proveedor, proveedor_ref);

alter table public.medios_pago enable row level security;
-- Sin policies: deny-all para anon/authenticated. Solo service role, igual que
-- `suscripciones` y `pagos`.
