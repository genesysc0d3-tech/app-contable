-- Retención / minimización (Ley 19.628 vigente; 21.719 dic-2026).
-- movimientos_raw.descripcion es la glosa CRUDA del banco: puede traer nombre y
-- RUT de un tercero no consentido. El Código Tributario obliga a conservar la
-- información contable 6 años; pasado ese plazo la política declara anonimizar.
-- El cron /api/audit/cron reemplaza la glosa por un marcador a los 6 años.
--
-- Índice para el barrido diario por created_at (hoy solo hay índices por
-- empresa_id y documento_id). No cambia datos: la app arrancó en 2026, así que
-- este barrido no toca ninguna fila hasta ~2032 — es una red de seguridad que
-- hace CIERTA la retención declarada, no un borrado inmediato.

CREATE INDEX IF NOT EXISTS idx_mov_created_at
  ON public.movimientos_raw (created_at);

COMMENT ON COLUMN public.movimientos_raw.descripcion IS
  'Glosa cruda del banco; puede contener nombre/RUT de terceros. Se anonimiza a los 6 años (Código Tributario / política de retención) vía cron /api/audit/cron.';
