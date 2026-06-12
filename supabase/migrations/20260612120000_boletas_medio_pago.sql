-- Res. Ex. SII N°44/2025: en operaciones sobre 135 UF debe registrarse el
-- medio de pago junto con la identificación del comprador. En el carril
-- masivo se autollena "Transferencia Electrónica" (origen cartola).
alter table public.boletas_emitidas
  add column if not exists medio_pago text;

comment on column public.boletas_emitidas.medio_pago is
  'Medio de pago informado (obligatorio sobre 135 UF — Res. Ex. SII 44/2025)';
