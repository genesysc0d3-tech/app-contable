-- El giro del receptor es parte de la individualización que la factura exige
-- (decisión del fundador: receptor COMPLETO). La tabla de emitidas ya tenía
-- razón social/dirección/comuna del receptor; el giro faltaba porque las
-- boletas no lo usan.
alter table public.boletas_emitidas add column if not exists receptor_giro text;
