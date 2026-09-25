-- Vuelta atrás de 20260925160000_empresas_sociedad_profesionales.
-- Lo que destruye: la marca "sociedad de profesionales 2ª categoría" de cada
-- empresa que la haya activado (exportar antes si importa:
-- select id, razon_social from empresas where sociedad_profesionales).
alter table public.empresas drop column if exists sociedad_profesionales;
