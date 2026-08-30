-- Índice parcial para el aviso de posible cambio del portal del SII.
--
-- collectOpsSnapshot lee, cada vez que se abre /dev/diagnostico, los eventos
-- `sii_local_posible_cambio_ancla` de las últimas 6 horas para agrupar por
-- ancla y contar empresas distintas. Sin este índice esa consulta barrería
-- todos los eventos de la fuente sii-local; con él queda acotada a los de
-- cambio en la ventana.
--
-- Parcial: solo indexa las filas de este evento (tabla de baja escritura, sin
-- bloqueo relevante), y no toca filas existentes.

create index if not exists idx_ops_events_cambio_sii
  on public.ops_events (created_at desc)
  where event_name = 'sii_local_posible_cambio_ancla';
