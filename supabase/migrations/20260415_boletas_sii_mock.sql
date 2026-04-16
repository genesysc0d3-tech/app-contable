-- Boletas electrónicas — emulador SII (modo prueba).
-- Replica las restricciones reales del SII para boletas tipo 39 (afecta) y 41 (exenta).
-- NOTA: este sistema es 100% mock. No hay conexión real al SII.

-- ============================================================
-- 1. boletas_caf_mock — rangos de folios (mock CAF)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.boletas_caf_mock (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  tipo_dte int NOT NULL CHECK (tipo_dte IN (39, 41, 61)),
  folio_desde int NOT NULL CHECK (folio_desde > 0),
  folio_hasta int NOT NULL CHECK (folio_hasta >= folio_desde),
  folio_actual int NOT NULL,
  estado text NOT NULL DEFAULT 'activo' CHECK (estado IN ('activo', 'agotado')),
  fecha_solicitud timestamptz NOT NULL DEFAULT now(),
  fecha_vence timestamptz NOT NULL DEFAULT (now() + interval '6 months'),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_caf_empresa_tipo_estado
  ON public.boletas_caf_mock (empresa_id, tipo_dte, estado);

ALTER TABLE public.boletas_caf_mock ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users see own empresa caf"
  ON public.boletas_caf_mock FOR SELECT
  USING (
    empresa_id IN (
      SELECT empresa_id FROM public.usuarios WHERE id = auth.uid()
    )
  );

-- ============================================================
-- 2. boletas_emitidas — boletas y NCs emitidas
-- ============================================================
CREATE TABLE IF NOT EXISTS public.boletas_emitidas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  tipo_dte int NOT NULL CHECK (tipo_dte IN (39, 41, 61)),
  folio int NOT NULL CHECK (folio > 0),
  caf_id uuid REFERENCES public.boletas_caf_mock(id),
  fecha_emision date NOT NULL DEFAULT CURRENT_DATE,

  -- Emisor (snapshot al momento de emitir)
  emisor_rut text NOT NULL,
  emisor_razon_social text NOT NULL,
  emisor_giro text,
  emisor_direccion text,
  emisor_comuna text,

  -- Receptor (opcional según monto — obligatorio si total > 180.000 CLP)
  receptor_rut text,
  receptor_razon_social text,
  receptor_direccion text,
  receptor_comuna text,

  -- Totales (en pesos enteros, sin decimales — como exige SII)
  monto_neto int NOT NULL DEFAULT 0,
  monto_exento int NOT NULL DEFAULT 0,
  iva int NOT NULL DEFAULT 0,
  monto_total int NOT NULL CHECK (monto_total > 0),

  -- Detalle líneas (JSONB array de { nro_lin, nombre, qty?, precio?, monto })
  detalles jsonb NOT NULL DEFAULT '[]'::jsonb,

  -- DTE generado (XML completo + TED)
  xml_dte text NOT NULL,
  ted text NOT NULL,
  track_id text NOT NULL,
  estado text NOT NULL DEFAULT 'aceptado'
    CHECK (estado IN ('aceptado', 'aceptado_reparos', 'rechazado', 'anulada')),

  -- Anulación (solo para boletas afectadas por una NC)
  anulada_por_id uuid REFERENCES public.boletas_emitidas(id),
  -- Para NCs (tipo 61): referencia a la boleta original
  referencia_id uuid REFERENCES public.boletas_emitidas(id),
  motivo_referencia text,

  created_at timestamptz NOT NULL DEFAULT now(),

  -- Folio único por empresa + tipo (no se reutilizan)
  UNIQUE (empresa_id, tipo_dte, folio)
);

CREATE INDEX IF NOT EXISTS idx_boletas_empresa_fecha
  ON public.boletas_emitidas (empresa_id, fecha_emision DESC);

CREATE INDEX IF NOT EXISTS idx_boletas_referencia
  ON public.boletas_emitidas (referencia_id) WHERE referencia_id IS NOT NULL;

ALTER TABLE public.boletas_emitidas ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users see own empresa boletas"
  ON public.boletas_emitidas FOR SELECT
  USING (
    empresa_id IN (
      SELECT empresa_id FROM public.usuarios WHERE id = auth.uid()
    )
  );

-- ============================================================
-- 3. Helper function: consume next folio atomically
-- Locks the CAF row, returns the next folio, marks CAF as 'agotado' if last
-- ============================================================
CREATE OR REPLACE FUNCTION public.consume_next_folio(
  p_empresa_id uuid,
  p_tipo_dte int
) RETURNS TABLE (folio int, caf_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_caf RECORD;
  v_folio int;
BEGIN
  -- Lock the oldest active CAF for this empresa+tipo
  SELECT * INTO v_caf
  FROM public.boletas_caf_mock
  WHERE empresa_id = p_empresa_id
    AND tipo_dte = p_tipo_dte
    AND estado = 'activo'
    AND fecha_vence > now()
  ORDER BY fecha_solicitud ASC
  LIMIT 1
  FOR UPDATE;

  IF v_caf IS NULL THEN
    RAISE EXCEPTION 'NO_FOLIOS_DISPONIBLES';
  END IF;

  v_folio := v_caf.folio_actual;

  -- Advance or mark exhausted
  IF v_caf.folio_actual >= v_caf.folio_hasta THEN
    UPDATE public.boletas_caf_mock
    SET folio_actual = v_caf.folio_actual + 1, estado = 'agotado'
    WHERE id = v_caf.id;
  ELSE
    UPDATE public.boletas_caf_mock
    SET folio_actual = v_caf.folio_actual + 1
    WHERE id = v_caf.id;
  END IF;

  RETURN QUERY SELECT v_folio, v_caf.id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.consume_next_folio(uuid, int) TO authenticated, service_role;
