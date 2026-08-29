-- «Historial básico» vs «Historial completo» no existe. Nunca existió.
--
-- Start prometía "Historial básico" y Pro "Historial completo", como si pagar
-- el doble te diera ver más atrás. Se buscó en todo el código: no hay ni un
-- límite por fecha, ni un corte por plan, ni una consulta que filtre historial
-- según el tier. Start y Pro ven exactamente lo mismo.
--
-- Eso no es copy impreciso: es una función inventada en el único lugar donde no
-- se puede inventar, que es donde la persona decide pagar. Y la promesa venía
-- arrastrada desde el seed original (20260613120000), o sea llevaba meses.
--
-- Se saca de los dos planes en vez de construirla: nadie la pidió, y prometer
-- para después construir es cómo se llega acá.
update public.planes_config
set
  features = (
    select coalesce(jsonb_agg(f), '[]'::jsonb)
    from jsonb_array_elements(features) as f
    where f::text not ilike '%historial%'
  ),
  updated_at = now()
where codigo in ('start', 'pro', 'business')
  and features::text ilike '%historial%';
