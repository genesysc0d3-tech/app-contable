export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      audit_chunks: {
        Row: {
          chunk_index: number | null
          chunk_input: string | null
          created_at: string | null
          documento_id: string | null
          finish_reason: string | null
          id: string
          mistral_response: string | null
          movimientos_count: number | null
          propuestas_count: number | null
          response_full_length: number | null
          run_number: number | null
          tokens_output: number | null
        }
        Insert: {
          chunk_index?: number | null
          chunk_input?: string | null
          created_at?: string | null
          documento_id?: string | null
          finish_reason?: string | null
          id?: string
          mistral_response?: string | null
          movimientos_count?: number | null
          propuestas_count?: number | null
          response_full_length?: number | null
          run_number?: number | null
          tokens_output?: number | null
        }
        Update: {
          chunk_index?: number | null
          chunk_input?: string | null
          created_at?: string | null
          documento_id?: string | null
          finish_reason?: string | null
          id?: string
          mistral_response?: string | null
          movimientos_count?: number | null
          propuestas_count?: number | null
          response_full_length?: number | null
          run_number?: number | null
          tokens_output?: number | null
        }
        Relationships: []
      }
      boletas_caf_mock: {
        Row: {
          created_at: string
          empresa_id: string
          estado: string
          fecha_solicitud: string
          fecha_vence: string
          folio_actual: number
          folio_desde: number
          folio_hasta: number
          id: string
          tipo_dte: number
        }
        Insert: {
          created_at?: string
          empresa_id: string
          estado?: string
          fecha_solicitud?: string
          fecha_vence?: string
          folio_actual: number
          folio_desde: number
          folio_hasta: number
          id?: string
          tipo_dte: number
        }
        Update: {
          created_at?: string
          empresa_id?: string
          estado?: string
          fecha_solicitud?: string
          fecha_vence?: string
          folio_actual?: number
          folio_desde?: number
          folio_hasta?: number
          id?: string
          tipo_dte?: number
        }
        Relationships: [
          {
            foreignKeyName: "boletas_caf_mock_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
        ]
      }
      boletas_emitidas: {
        Row: {
          anulada_por_id: string | null
          caf_id: string | null
          created_at: string
          detalles: Json
          emision_proveedor: string
          emision_sandbox: boolean
          emisor_comuna: string | null
          emisor_direccion: string | null
          emisor_giro: string | null
          emisor_razon_social: string
          emisor_rut: string
          empresa_id: string
          estado: string
          fecha_emision: string
          folio: number
          id: string
          iva: number
          medio_pago: string | null
          monto_exento: number
          monto_neto: number
          monto_total: number
          motivo_referencia: string | null
          propuesta_id: string | null
          proveedor_respuesta: Json | null
          receptor_comuna: string | null
          receptor_direccion: string | null
          receptor_razon_social: string | null
          receptor_rut: string | null
          referencia_id: string | null
          ted: string
          tipo_dte: number
          track_id: string
          xml_dte: string
        }
        Insert: {
          anulada_por_id?: string | null
          caf_id?: string | null
          created_at?: string
          detalles?: Json
          emision_proveedor?: string
          emision_sandbox?: boolean
          emisor_comuna?: string | null
          emisor_direccion?: string | null
          emisor_giro?: string | null
          emisor_razon_social: string
          emisor_rut: string
          empresa_id: string
          estado?: string
          fecha_emision?: string
          folio: number
          id?: string
          iva?: number
          medio_pago?: string | null
          monto_exento?: number
          monto_neto?: number
          monto_total: number
          motivo_referencia?: string | null
          propuesta_id?: string | null
          proveedor_respuesta?: Json | null
          receptor_comuna?: string | null
          receptor_direccion?: string | null
          receptor_razon_social?: string | null
          receptor_rut?: string | null
          referencia_id?: string | null
          ted: string
          tipo_dte: number
          track_id: string
          xml_dte: string
        }
        Update: {
          anulada_por_id?: string | null
          caf_id?: string | null
          created_at?: string
          detalles?: Json
          emision_proveedor?: string
          emision_sandbox?: boolean
          emisor_comuna?: string | null
          emisor_direccion?: string | null
          emisor_giro?: string | null
          emisor_razon_social?: string
          emisor_rut?: string
          empresa_id?: string
          estado?: string
          fecha_emision?: string
          folio?: number
          id?: string
          iva?: number
          medio_pago?: string | null
          monto_exento?: number
          monto_neto?: number
          monto_total?: number
          motivo_referencia?: string | null
          propuesta_id?: string | null
          proveedor_respuesta?: Json | null
          receptor_comuna?: string | null
          receptor_direccion?: string | null
          receptor_razon_social?: string | null
          receptor_rut?: string | null
          referencia_id?: string | null
          ted?: string
          tipo_dte?: number
          track_id?: string
          xml_dte?: string
        }
        Relationships: [
          {
            foreignKeyName: "boletas_emitidas_anulada_por_id_fkey"
            columns: ["anulada_por_id"]
            isOneToOne: false
            referencedRelation: "boletas_emitidas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "boletas_emitidas_caf_id_fkey"
            columns: ["caf_id"]
            isOneToOne: false
            referencedRelation: "boletas_caf_mock"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "boletas_emitidas_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "boletas_emitidas_propuesta_id_fkey"
            columns: ["propuesta_id"]
            isOneToOne: false
            referencedRelation: "propuestas_ia"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "boletas_emitidas_referencia_id_fkey"
            columns: ["referencia_id"]
            isOneToOne: false
            referencedRelation: "boletas_emitidas"
            referencedColumns: ["id"]
          },
        ]
      }
      clasificacion_reglas: {
        Row: {
          activa: boolean
          confianza: number
          created_at: string
          created_by: string | null
          empresa_id: string | null
          id: string
          last_used_at: string | null
          nombre: string
          patron: string
          patron_tipo: string
          prioridad: number
          receptor_nombre_default: string | null
          receptor_rut_default: string | null
          tipo_flujo_match: string | null
          tipo_propuesto: string
          veces_aplicada: number
        }
        Insert: {
          activa?: boolean
          confianza?: number
          created_at?: string
          created_by?: string | null
          empresa_id?: string | null
          id?: string
          last_used_at?: string | null
          nombre: string
          patron: string
          patron_tipo: string
          prioridad?: number
          receptor_nombre_default?: string | null
          receptor_rut_default?: string | null
          tipo_flujo_match?: string | null
          tipo_propuesto: string
          veces_aplicada?: number
        }
        Update: {
          activa?: boolean
          confianza?: number
          created_at?: string
          created_by?: string | null
          empresa_id?: string | null
          id?: string
          last_used_at?: string | null
          nombre?: string
          patron?: string
          patron_tipo?: string
          prioridad?: number
          receptor_nombre_default?: string | null
          receptor_rut_default?: string | null
          tipo_flujo_match?: string | null
          tipo_propuesto?: string
          veces_aplicada?: number
        }
        Relationships: [
          {
            foreignKeyName: "clasificacion_reglas_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
        ]
      }
      clientes: {
        Row: {
          created_at: string
          direccion: string | null
          email: string | null
          empresa_id: string
          giro: string | null
          id: string
          nombre: string
          notas: string | null
          rut: string | null
          telefono: string | null
          tipo_contribuyente: string
        }
        Insert: {
          created_at?: string
          direccion?: string | null
          email?: string | null
          empresa_id: string
          giro?: string | null
          id?: string
          nombre: string
          notas?: string | null
          rut?: string | null
          telefono?: string | null
          tipo_contribuyente?: string
        }
        Update: {
          created_at?: string
          direccion?: string | null
          email?: string | null
          empresa_id?: string
          giro?: string | null
          id?: string
          nombre?: string
          notas?: string | null
          rut?: string | null
          telefono?: string | null
          tipo_contribuyente?: string
        }
        Relationships: [
          {
            foreignKeyName: "clientes_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
        ]
      }
      creditos_uso: {
        Row: {
          anio: number
          created_at: string
          docs_acumulados: number
          docs_incluidos: number
          docs_usados: number
          empresa_id: string
          id: string
          mes: number
        }
        Insert: {
          anio: number
          created_at?: string
          docs_acumulados?: number
          docs_incluidos?: number
          docs_usados?: number
          empresa_id: string
          id?: string
          mes: number
        }
        Update: {
          anio?: number
          created_at?: string
          docs_acumulados?: number
          docs_incluidos?: number
          docs_usados?: number
          empresa_id?: string
          id?: string
          mes?: number
        }
        Relationships: [
          {
            foreignKeyName: "creditos_uso_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
        ]
      }
      documentos_subidos: {
        Row: {
          created_at: string
          empresa_id: string
          estado: string
          glosa_activa: boolean
          glosa_comun: string | null
          id: string
          movimientos_detectados: number | null
          nombre_archivo: string
          progreso_ia: Json | null
          storage_path: string
          tipo: string
          tipo_operacion_hint: string | null
        }
        Insert: {
          created_at?: string
          empresa_id: string
          estado?: string
          glosa_activa?: boolean
          glosa_comun?: string | null
          id?: string
          movimientos_detectados?: number | null
          nombre_archivo: string
          progreso_ia?: Json | null
          storage_path: string
          tipo: string
          tipo_operacion_hint?: string | null
        }
        Update: {
          created_at?: string
          empresa_id?: string
          estado?: string
          glosa_activa?: boolean
          glosa_comun?: string | null
          id?: string
          movimientos_detectados?: number | null
          nombre_archivo?: string
          progreso_ia?: Json | null
          storage_path?: string
          tipo?: string
          tipo_operacion_hint?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "documentos_subidos_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
        ]
      }
      documentos_tributarios: {
        Row: {
          cliente_id: string | null
          created_at: string
          empresa_id: string
          estado: string
          fecha_emision: string
          folio: number | null
          id: string
          iva: number
          neto: number
          propuesta_id: string | null
          tipo_dte: string
          total: number
          track_id: string | null
          xml_sii: string | null
        }
        Insert: {
          cliente_id?: string | null
          created_at?: string
          empresa_id: string
          estado?: string
          fecha_emision: string
          folio?: number | null
          id?: string
          iva: number
          neto: number
          propuesta_id?: string | null
          tipo_dte: string
          total: number
          track_id?: string | null
          xml_sii?: string | null
        }
        Update: {
          cliente_id?: string | null
          created_at?: string
          empresa_id?: string
          estado?: string
          fecha_emision?: string
          folio?: number | null
          id?: string
          iva?: number
          neto?: number
          propuesta_id?: string | null
          tipo_dte?: string
          total?: number
          track_id?: string | null
          xml_sii?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "documentos_tributarios_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "clientes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documentos_tributarios_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documentos_tributarios_propuesta_id_fkey"
            columns: ["propuesta_id"]
            isOneToOne: false
            referencedRelation: "propuestas_ia"
            referencedColumns: ["id"]
          },
        ]
      }
      empresas: {
        Row: {
          clave_sii: string | null
          boletas_emision_proveedor: string
          comuna: string | null
          created_at: string
          direccion: string | null
          email_sii: string | null
          emision_baseapi_sandbox: boolean
          emision_proveedor: string
          facturas_emision_proveedor: string
          giro: string | null
          id: string
          logo_mime_type: string | null
          logo_storage_path: string | null
          plan: string | null
          plan_activo: boolean
          plan_vence_at: string | null
          razon_social: string
          regimen_tributario: string | null
          region: string | null
          rut: string
          tiene_certificado_sii: boolean
          tipo_contribuyente: string
        }
        Insert: {
          clave_sii?: string | null
          boletas_emision_proveedor?: string
          comuna?: string | null
          created_at?: string
          direccion?: string | null
          email_sii?: string | null
          emision_baseapi_sandbox?: boolean
          emision_proveedor?: string
          facturas_emision_proveedor?: string
          giro?: string | null
          id?: string
          logo_mime_type?: string | null
          logo_storage_path?: string | null
          plan?: string | null
          plan_activo?: boolean
          plan_vence_at?: string | null
          razon_social: string
          regimen_tributario?: string | null
          region?: string | null
          rut: string
          tiene_certificado_sii?: boolean
          tipo_contribuyente?: string
        }
        Update: {
          clave_sii?: string | null
          boletas_emision_proveedor?: string
          comuna?: string | null
          created_at?: string
          direccion?: string | null
          email_sii?: string | null
          emision_baseapi_sandbox?: boolean
          emision_proveedor?: string
          facturas_emision_proveedor?: string
          giro?: string | null
          id?: string
          logo_mime_type?: string | null
          logo_storage_path?: string | null
          plan?: string | null
          plan_activo?: boolean
          plan_vence_at?: string | null
          razon_social?: string
          regimen_tributario?: string | null
          region?: string | null
          rut?: string
          tiene_certificado_sii?: boolean
          tipo_contribuyente?: string
        }
        Relationships: []
      }
      gastos: {
        Row: {
          categoria: string | null
          comprobante_url: string | null
          created_at: string
          descripcion: string | null
          empresa_id: string
          fecha: string
          id: string
          iva: number
          monto_neto: number
          propuesta_id: string | null
          proveedor_id: string | null
          total: number
        }
        Insert: {
          categoria?: string | null
          comprobante_url?: string | null
          created_at?: string
          descripcion?: string | null
          empresa_id: string
          fecha: string
          id?: string
          iva: number
          monto_neto: number
          propuesta_id?: string | null
          proveedor_id?: string | null
          total: number
        }
        Update: {
          categoria?: string | null
          comprobante_url?: string | null
          created_at?: string
          descripcion?: string | null
          empresa_id?: string
          fecha?: string
          id?: string
          iva?: number
          monto_neto?: number
          propuesta_id?: string | null
          proveedor_id?: string | null
          total?: number
        }
        Relationships: [
          {
            foreignKeyName: "gastos_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gastos_propuesta_id_fkey"
            columns: ["propuesta_id"]
            isOneToOne: false
            referencedRelation: "propuestas_ia"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gastos_proveedor_id_fkey"
            columns: ["proveedor_id"]
            isOneToOne: false
            referencedRelation: "proveedores"
            referencedColumns: ["id"]
          },
        ]
      }
      ia_uso: {
        Row: {
          costo_usd: number
          created_at: string
          documento_id: string | null
          empresa_id: string
          fecha: string
          id: string
          modelo: string
          tokens_input: number
          tokens_output: number
        }
        Insert: {
          costo_usd?: number
          created_at?: string
          documento_id?: string | null
          empresa_id: string
          fecha?: string
          id?: string
          modelo: string
          tokens_input?: number
          tokens_output?: number
        }
        Update: {
          costo_usd?: number
          created_at?: string
          documento_id?: string | null
          empresa_id?: string
          fecha?: string
          id?: string
          modelo?: string
          tokens_input?: number
          tokens_output?: number
        }
        Relationships: [
          {
            foreignKeyName: "ia_uso_documento_id_fkey"
            columns: ["documento_id"]
            isOneToOne: false
            referencedRelation: "documentos_subidos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ia_uso_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
        ]
      }
      items_documento: {
        Row: {
          cantidad: number
          descripcion: string
          descuento: number | null
          documento_id: string
          id: string
          precio_unitario: number
          subtotal: number
        }
        Insert: {
          cantidad?: number
          descripcion: string
          descuento?: number | null
          documento_id: string
          id?: string
          precio_unitario: number
          subtotal: number
        }
        Update: {
          cantidad?: number
          descripcion?: string
          descuento?: number | null
          documento_id?: string
          id?: string
          precio_unitario?: number
          subtotal?: number
        }
        Relationships: [
          {
            foreignKeyName: "items_documento_documento_id_fkey"
            columns: ["documento_id"]
            isOneToOne: false
            referencedRelation: "documentos_tributarios"
            referencedColumns: ["id"]
          },
        ]
      }
      movimientos_raw: {
        Row: {
          created_at: string
          descripcion: string
          documento_id: string
          empresa_id: string
          fecha: string
          id: string
          monto: number
          n_documento: string | null
          origen: string | null
          tipo_flujo: string
        }
        Insert: {
          created_at?: string
          descripcion: string
          documento_id: string
          empresa_id: string
          fecha: string
          id?: string
          monto: number
          n_documento?: string | null
          origen?: string | null
          tipo_flujo: string
        }
        Update: {
          created_at?: string
          descripcion?: string
          documento_id?: string
          empresa_id?: string
          fecha?: string
          id?: string
          monto?: number
          n_documento?: string | null
          origen?: string | null
          tipo_flujo?: string
        }
        Relationships: [
          {
            foreignKeyName: "movimientos_raw_documento_id_fkey"
            columns: ["documento_id"]
            isOneToOne: false
            referencedRelation: "documentos_subidos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "movimientos_raw_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
        ]
      }
      parser_adapters: {
        Row: {
          confianza: number
          config: Json
          created_at: string
          disabled_until: string | null
          failure_count: number
          fingerprint: string
          id: string
          last_failure_reason: string | null
          last_used_at: string | null
          nombre: string | null
          source: string
          success_count: number
          tipo_doc: string | null
          usage_count: number
        }
        Insert: {
          confianza?: number
          config: Json
          created_at?: string
          disabled_until?: string | null
          failure_count?: number
          fingerprint: string
          id?: string
          last_failure_reason?: string | null
          last_used_at?: string | null
          nombre?: string | null
          source: string
          success_count?: number
          tipo_doc?: string | null
          usage_count?: number
        }
        Update: {
          confianza?: number
          config?: Json
          created_at?: string
          disabled_until?: string | null
          failure_count?: number
          fingerprint?: string
          id?: string
          last_failure_reason?: string | null
          last_used_at?: string | null
          nombre?: string | null
          source?: string
          success_count?: number
          tipo_doc?: string | null
          usage_count?: number
        }
        Relationships: []
      }
      parser_logs: {
        Row: {
          adapter_id: string | null
          capa_exitosa: number | null
          capa_usada: number
          created_at: string
          documento_id: string | null
          duration_ms: number | null
          error: string | null
          fingerprint: string | null
          id: string
          rows_extracted: number | null
          validator_failed_checks: string[] | null
          warnings: string[] | null
        }
        Insert: {
          adapter_id?: string | null
          capa_exitosa?: number | null
          capa_usada: number
          created_at?: string
          documento_id?: string | null
          duration_ms?: number | null
          error?: string | null
          fingerprint?: string | null
          id?: string
          rows_extracted?: number | null
          validator_failed_checks?: string[] | null
          warnings?: string[] | null
        }
        Update: {
          adapter_id?: string | null
          capa_exitosa?: number | null
          capa_usada?: number
          created_at?: string
          documento_id?: string | null
          duration_ms?: number | null
          error?: string | null
          fingerprint?: string | null
          id?: string
          rows_extracted?: number | null
          validator_failed_checks?: string[] | null
          warnings?: string[] | null
        }
        Relationships: [
          {
            foreignKeyName: "parser_logs_adapter_id_fkey"
            columns: ["adapter_id"]
            isOneToOne: false
            referencedRelation: "parser_adapters"
            referencedColumns: ["id"]
          },
        ]
      }
      periodos_contables: {
        Row: {
          anio: number
          cerrado_at: string | null
          empresa_id: string
          estado: string
          id: string
          iva_a_pagar: number | null
          iva_credito: number | null
          iva_debito: number | null
          mes: number
          spread_total_p2p: number | null
          total_compras: number | null
          total_ventas: number | null
          transferencias_mes: number | null
        }
        Insert: {
          anio: number
          cerrado_at?: string | null
          empresa_id: string
          estado?: string
          id?: string
          iva_a_pagar?: number | null
          iva_credito?: number | null
          iva_debito?: number | null
          mes: number
          spread_total_p2p?: number | null
          total_compras?: number | null
          total_ventas?: number | null
          transferencias_mes?: number | null
        }
        Update: {
          anio?: number
          cerrado_at?: string | null
          empresa_id?: string
          estado?: string
          id?: string
          iva_a_pagar?: number | null
          iva_credito?: number | null
          iva_debito?: number | null
          mes?: number
          spread_total_p2p?: number | null
          total_compras?: number | null
          total_ventas?: number | null
          transferencias_mes?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "periodos_contables_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
        ]
      }
      propuestas_ia: {
        Row: {
          cliente_id: string | null
          confianza: number | null
          created_at: string
          empresa_id: string
          estado: string
          fuente_clasificacion: string | null
          id: string
          iva: number | null
          moneda_origen: string | null
          monto_moneda_origen: number | null
          monto_neto: number | null
          movimiento_id: string
          notas: string | null
          receptor_nombre: string | null
          receptor_rut: string | null
          regla_id: string | null
          spread_compra: number | null
          spread_ganancia: number | null
          spread_venta: number | null
          tipo_propuesto: string
          total: number | null
        }
        Insert: {
          cliente_id?: string | null
          confianza?: number | null
          created_at?: string
          empresa_id: string
          estado?: string
          fuente_clasificacion?: string | null
          id?: string
          iva?: number | null
          moneda_origen?: string | null
          monto_moneda_origen?: number | null
          monto_neto?: number | null
          movimiento_id: string
          notas?: string | null
          receptor_nombre?: string | null
          receptor_rut?: string | null
          regla_id?: string | null
          spread_compra?: number | null
          spread_ganancia?: number | null
          spread_venta?: number | null
          tipo_propuesto: string
          total?: number | null
        }
        Update: {
          cliente_id?: string | null
          confianza?: number | null
          created_at?: string
          empresa_id?: string
          estado?: string
          fuente_clasificacion?: string | null
          id?: string
          iva?: number | null
          moneda_origen?: string | null
          monto_moneda_origen?: number | null
          monto_neto?: number | null
          movimiento_id?: string
          notas?: string | null
          receptor_nombre?: string | null
          receptor_rut?: string | null
          regla_id?: string | null
          spread_compra?: number | null
          spread_ganancia?: number | null
          spread_venta?: number | null
          tipo_propuesto?: string
          total?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "propuestas_ia_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "clientes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "propuestas_ia_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "propuestas_ia_movimiento_id_fkey"
            columns: ["movimiento_id"]
            isOneToOne: false
            referencedRelation: "movimientos_raw"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "propuestas_ia_regla_id_fkey"
            columns: ["regla_id"]
            isOneToOne: false
            referencedRelation: "clasificacion_reglas"
            referencedColumns: ["id"]
          },
        ]
      }
      proveedores: {
        Row: {
          created_at: string
          email: string | null
          empresa_id: string
          giro: string | null
          id: string
          nombre: string
          rut: string | null
        }
        Insert: {
          created_at?: string
          email?: string | null
          empresa_id: string
          giro?: string | null
          id?: string
          nombre: string
          rut?: string | null
        }
        Update: {
          created_at?: string
          email?: string | null
          empresa_id?: string
          giro?: string | null
          id?: string
          nombre?: string
          rut?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "proveedores_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
        ]
      }
      usuario_empresas: {
        Row: {
          created_at: string
          empresa_id: string
          rol: string
          usuario_id: string
        }
        Insert: {
          created_at?: string
          empresa_id: string
          rol?: string
          usuario_id: string
        }
        Update: {
          created_at?: string
          empresa_id?: string
          rol?: string
          usuario_id?: string
        }
        Relationships: []
      }
      usuarios: {
        Row: {
          created_at: string
          dev_mode: boolean
          email: string
          empresa_id: string
          id: string
          nombre: string
          rol: string
          vetado: boolean
        }
        Insert: {
          created_at?: string
          dev_mode?: boolean
          email: string
          empresa_id: string
          id: string
          nombre: string
          rol?: string
          vetado?: boolean
        }
        Update: {
          created_at?: string
          dev_mode?: boolean
          email?: string
          empresa_id?: string
          id?: string
          nombre?: string
          rol?: string
          vetado?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "usuarios_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
        ]
      }
      empresa_invitaciones: {
        Row: {
          accepted_at: string | null
          accepted_by: string | null
          created_at: string
          email: string
          empresa_id: string
          estado: string
          expires_at: string
          id: string
          invited_by: string | null
          rol: string
          token_hash: string
        }
        Insert: {
          accepted_at?: string | null
          accepted_by?: string | null
          created_at?: string
          email: string
          empresa_id: string
          estado?: string
          expires_at?: string
          id?: string
          invited_by?: string | null
          rol?: string
          token_hash: string
        }
        Update: {
          accepted_at?: string | null
          accepted_by?: string | null
          created_at?: string
          email?: string
          empresa_id?: string
          estado?: string
          expires_at?: string
          id?: string
          invited_by?: string | null
          rol?: string
          token_hash?: string
        }
        Relationships: [
          {
            foreignKeyName: "empresa_invitaciones_accepted_by_fkey"
            columns: ["accepted_by"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "empresa_invitaciones_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "empresa_invitaciones_invited_by_fkey"
            columns: ["invited_by"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
        ]
      }
      app_config: {
        Row: {
          name: string
          value: string
          updated_at: string
        }
        Insert: {
          name: string
          value: string
          updated_at?: string
        }
        Update: {
          name?: string
          value?: string
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      consume_next_folio: {
        Args: { p_empresa_id: string; p_tipo_dte: number }
        Returns: {
          caf_id: string
          folio: number
        }[]
      }
      empresas_del_usuario: {
        Args: Record<string, never>
        Returns: string[]
      }
      documento_pipeline_counts: {
        Args: { p_empresa: string; p_desde: string; p_hasta: string }
        Returns: {
          documento_id: string
          total: number
          emitida: number
          lista: number
          por_revisar: number
          no_aplica: number
        }[]
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
