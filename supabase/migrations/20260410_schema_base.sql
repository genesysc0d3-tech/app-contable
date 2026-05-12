-- Schema base — tablas principales de app-contable
-- Creado a partir de database.types.ts + migrations existentes

-- ============================================================
-- 1. empresas
-- ============================================================
CREATE TABLE IF NOT EXISTS public.empresas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rut text NOT NULL,
  razon_social text NOT NULL,
  giro text,
  direccion text,
  comuna text,
  region text,
  email_sii text,
  clave_sii text,
  regimen_tributario text,
  plan text,
  plan_activo boolean NOT NULL DEFAULT false,
  plan_vence_at timestamptz,
  tiene_certificado_sii boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.empresas ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- 2. usuarios
-- ============================================================
CREATE TABLE IF NOT EXISTS public.usuarios (
  id uuid PRIMARY KEY,
  email text NOT NULL,
  nombre text NOT NULL,
  empresa_id uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  rol text NOT NULL DEFAULT 'admin',
  vetado boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_usuarios_empresa ON public.usuarios (empresa_id);
ALTER TABLE public.usuarios ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- 3. documentos_subidos
-- ============================================================
CREATE TABLE IF NOT EXISTS public.documentos_subidos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  nombre_archivo text NOT NULL,
  tipo text NOT NULL,
  storage_path text NOT NULL,
  estado text NOT NULL DEFAULT 'subido',
  movimientos_detectados int,
  tipo_operacion_hint text,
  progreso_ia jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_docs_empresa_estado ON public.documentos_subidos (empresa_id, estado);
ALTER TABLE public.documentos_subidos ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- 4. movimientos_raw
-- ============================================================
CREATE TABLE IF NOT EXISTS public.movimientos_raw (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  documento_id uuid NOT NULL REFERENCES public.documentos_subidos(id) ON DELETE CASCADE,
  fecha date NOT NULL,
  descripcion text NOT NULL,
  monto numeric NOT NULL,
  tipo_flujo text NOT NULL,
  n_documento text,
  origen text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_movimientos_documento ON public.movimientos_raw (documento_id);
CREATE INDEX IF NOT EXISTS idx_movimientos_empresa ON public.movimientos_raw (empresa_id);
ALTER TABLE public.movimientos_raw ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- 5. clientes
-- ============================================================
CREATE TABLE IF NOT EXISTS public.clientes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  nombre text NOT NULL,
  rut text,
  giro text,
  direccion text,
  email text,
  telefono text,
  notas text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_clientes_empresa ON public.clientes (empresa_id);
ALTER TABLE public.clientes ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- 6. proveedores
-- ============================================================
CREATE TABLE IF NOT EXISTS public.proveedores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  nombre text NOT NULL,
  rut text,
  giro text,
  email text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_proveedores_empresa ON public.proveedores (empresa_id);
ALTER TABLE public.proveedores ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- 7. clasificacion_reglas
-- ============================================================
CREATE TABLE IF NOT EXISTS public.clasificacion_reglas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid REFERENCES public.empresas(id) ON DELETE CASCADE,
  nombre text NOT NULL,
  patron text NOT NULL,
  patron_tipo text NOT NULL,
  tipo_propuesto text NOT NULL,
  tipo_flujo_match text,
  receptor_nombre_default text,
  receptor_rut_default text,
  confianza numeric NOT NULL DEFAULT 0.85,
  prioridad int NOT NULL DEFAULT 100,
  activa boolean NOT NULL DEFAULT true,
  veces_aplicada int NOT NULL DEFAULT 0,
  created_by uuid,
  last_used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.clasificacion_reglas ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- 8. propuestas_ia
-- ============================================================
CREATE TABLE IF NOT EXISTS public.propuestas_ia (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  movimiento_id uuid NOT NULL REFERENCES public.movimientos_raw(id) ON DELETE CASCADE,
  tipo_propuesto text NOT NULL,
  confianza numeric,
  monto_neto numeric,
  iva numeric,
  total numeric,
  receptor_nombre text,
  receptor_rut text,
  cliente_id uuid REFERENCES public.clientes(id) ON DELETE SET NULL,
  regla_id uuid REFERENCES public.clasificacion_reglas(id) ON DELETE SET NULL,
  moneda_origen text,
  monto_moneda_origen numeric,
  spread_compra numeric,
  spread_venta numeric,
  spread_ganancia numeric,
  notas text,
  fuente_clasificacion text,
  estado text NOT NULL DEFAULT 'pendiente',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_propuestas_empresa_estado ON public.propuestas_ia (empresa_id, estado);
CREATE INDEX IF NOT EXISTS idx_propuestas_movimiento ON public.propuestas_ia (movimiento_id);
ALTER TABLE public.propuestas_ia ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- 9. documentos_tributarios
-- ============================================================
CREATE TABLE IF NOT EXISTS public.documentos_tributarios (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  tipo_dte text NOT NULL,
  folio int,
  fecha_emision date NOT NULL,
  neto numeric NOT NULL,
  iva numeric NOT NULL,
  total numeric NOT NULL,
  cliente_id uuid REFERENCES public.clientes(id) ON DELETE SET NULL,
  propuesta_id uuid REFERENCES public.propuestas_ia(id) ON DELETE SET NULL,
  estado text NOT NULL DEFAULT 'pendiente',
  track_id text,
  xml_sii text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dt_empresa ON public.documentos_tributarios (empresa_id);
ALTER TABLE public.documentos_tributarios ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- 10. items_documento
-- ============================================================
CREATE TABLE IF NOT EXISTS public.items_documento (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  documento_id uuid NOT NULL REFERENCES public.documentos_tributarios(id) ON DELETE CASCADE,
  descripcion text NOT NULL,
  cantidad numeric NOT NULL DEFAULT 1,
  precio_unitario numeric NOT NULL,
  descuento numeric,
  subtotal numeric NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_items_documento ON public.items_documento (documento_id);
ALTER TABLE public.items_documento ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- 11. gastos
-- ============================================================
CREATE TABLE IF NOT EXISTS public.gastos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  fecha date NOT NULL,
  descripcion text,
  monto_neto numeric NOT NULL,
  iva numeric NOT NULL,
  total numeric NOT NULL,
  categoria text,
  proveedor_id uuid REFERENCES public.proveedores(id) ON DELETE SET NULL,
  propuesta_id uuid REFERENCES public.propuestas_ia(id) ON DELETE SET NULL,
  comprobante_url text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_gastos_empresa ON public.gastos (empresa_id);
ALTER TABLE public.gastos ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- 12. periodos_contables
-- ============================================================
CREATE TABLE IF NOT EXISTS public.periodos_contables (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  anio int NOT NULL,
  mes int NOT NULL,
  estado text NOT NULL DEFAULT 'abierto',
  total_ventas numeric,
  total_compras numeric,
  iva_debito numeric,
  iva_credito numeric,
  iva_a_pagar numeric,
  transferencias_mes numeric,
  spread_total_p2p numeric,
  cerrado_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (empresa_id, anio, mes)
);

ALTER TABLE public.periodos_contables ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- 13. parser_adapters
-- ============================================================
CREATE TABLE IF NOT EXISTS public.parser_adapters (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fingerprint text NOT NULL,
  nombre text,
  tipo_doc text,
  source text NOT NULL,
  config jsonb NOT NULL,
  confianza numeric NOT NULL DEFAULT 0.0,
  usage_count int NOT NULL DEFAULT 0,
  success_count int NOT NULL DEFAULT 0,
  failure_count int NOT NULL DEFAULT 0,
  disabled_until timestamptz,
  last_failure_reason text,
  last_used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_parser_fingerprint ON public.parser_adapters (fingerprint);
ALTER TABLE public.parser_adapters ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- 14. parser_logs
-- ============================================================
CREATE TABLE IF NOT EXISTS public.parser_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  documento_id uuid REFERENCES public.documentos_subidos(id) ON DELETE SET NULL,
  fingerprint text,
  capa_usada int NOT NULL,
  capa_exitosa int,
  adapter_id uuid REFERENCES public.parser_adapters(id) ON DELETE SET NULL,
  rows_extracted int,
  duration_ms int,
  validator_failed_checks text[],
  warnings text[],
  error text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.parser_logs ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- 15. ia_uso
-- ============================================================
CREATE TABLE IF NOT EXISTS public.ia_uso (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  documento_id uuid REFERENCES public.documentos_subidos(id) ON DELETE SET NULL,
  modelo text NOT NULL,
  tokens_input int NOT NULL DEFAULT 0,
  tokens_output int NOT NULL DEFAULT 0,
  costo_usd numeric NOT NULL DEFAULT 0,
  fecha date NOT NULL DEFAULT CURRENT_DATE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ia_uso_empresa ON public.ia_uso (empresa_id);
ALTER TABLE public.ia_uso ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- 16. audit_chunks
-- ============================================================
CREATE TABLE IF NOT EXISTS public.audit_chunks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  documento_id uuid REFERENCES public.documentos_subidos(id) ON DELETE SET NULL,
  run_number int,
  chunk_index int,
  chunk_input text,
  mistral_response text,
  movimientos_count int,
  propuestas_count int,
  tokens_output int,
  response_full_length int,
  finish_reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.audit_chunks ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- 17. creditos_uso
-- ============================================================
CREATE TABLE IF NOT EXISTS public.creditos_uso (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  anio int NOT NULL,
  mes int NOT NULL,
  docs_incluidos int NOT NULL DEFAULT 0,
  docs_usados int NOT NULL DEFAULT 0,
  docs_acumulados int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (empresa_id, anio, mes)
);

ALTER TABLE public.creditos_uso ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- RLS policies básicas
-- ============================================================

-- empresas: el usuario ve su propia empresa
DROP POLICY IF EXISTS "usuarios ven su empresa" ON public.empresas;
CREATE POLICY "usuarios ven su empresa" ON public.empresas
  FOR ALL USING (
    id IN (SELECT empresa_id FROM public.usuarios WHERE id = auth.uid())
  );

-- tablas con empresa_id: policy genérica via usuarios
DO $$
DECLARE
  tbl text;
BEGIN
  FOR tbl IN
    SELECT unnest(ARRAY[
      'documentos_subidos', 'movimientos_raw', 'clientes', 'proveedores',
      'clasificacion_reglas', 'propuestas_ia', 'documentos_tributarios',
      'gastos', 'periodos_contables', 'ia_uso', 'creditos_uso'
    ])
  LOOP
    EXECUTE format(
      'DROP POLICY IF EXISTS "row level via usuarios" ON public.%I', tbl
    );
    EXECUTE format(
      'CREATE POLICY "row level via usuarios" ON public.%I FOR ALL USING (
        empresa_id IN (SELECT empresa_id FROM public.usuarios WHERE id = auth.uid())
      )', tbl
    );
  END LOOP;
END $$;

-- Tablas sin empresa_id
DROP POLICY IF EXISTS "todos pueden leer parser_adapters" ON public.parser_adapters;
CREATE POLICY "todos pueden leer parser_adapters" ON public.parser_adapters
  FOR SELECT USING (true);

DROP POLICY IF EXISTS "todos pueden insert parser_logs" ON public.parser_logs;
CREATE POLICY "todos pueden insert parser_logs" ON public.parser_logs
  FOR INSERT WITH CHECK (true);
DROP POLICY IF EXISTS "todos pueden leer parser_logs" ON public.parser_logs;
CREATE POLICY "todos pueden leer parser_logs" ON public.parser_logs
  FOR SELECT USING (true);

DROP POLICY IF EXISTS "todos pueden leer audit_chunks" ON public.audit_chunks;
CREATE POLICY "todos pueden leer audit_chunks" ON public.audit_chunks
  FOR SELECT USING (true);
DROP POLICY IF EXISTS "todos pueden insert audit_chunks" ON public.audit_chunks;
CREATE POLICY "todos pueden insert audit_chunks" ON public.audit_chunks
  FOR INSERT WITH CHECK (true);
