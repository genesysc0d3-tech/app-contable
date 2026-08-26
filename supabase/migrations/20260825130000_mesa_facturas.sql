-- Motor de facturas, fase 1: la MESA como dimensión de los datos.
--
-- El escritorio v5 tendrá dos mesas (boletas | facturas) conmutadas en el
-- logo de la empresa (cuadro con empresas si Business, solo el RUT si
-- Start/Pro, + botón boleta/factura; título "Mesa boleta"/"Mesa factura").
-- Las mesas son INDEPENDIENTES — solo se cruzan en historial y búsqueda —
-- y ese aislamiento se ancla acá, en los datos, no en filtros de pantalla:
-- la mesa viaja con el DOCUMENTO al subirse y con cada PROPUESTA que nace
-- de él. El default 'boleta' deja todo lo existente exactamente donde estaba.
--
-- boletas_emitidas NO necesita mesa: ya es genérica de DTE (tipo_dte 33/34/39/41).
alter table public.documentos_subidos
  add column if not exists mesa text not null default 'boleta'
  check (mesa in ('boleta', 'factura'));

alter table public.propuestas_ia
  add column if not exists mesa text not null default 'boleta'
  check (mesa in ('boleta', 'factura'));

-- La factura identifica al receptor con giro (la boleta no lo usa), y el
-- detalle de la operación es campo del documento (Nombre Producto/Descripción
-- en el portal del SII).
alter table public.propuestas_ia add column if not exists receptor_giro text;
alter table public.propuestas_ia add column if not exists detalle text;

create index if not exists idx_propuestas_mesa on public.propuestas_ia(empresa_id, mesa);
