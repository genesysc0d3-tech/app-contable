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
      app_config: {
        Row: {
          name: string
          updated_at: string
          value: string
        }
        Insert: {
          name: string
          updated_at?: string
          value: string
        }
        Update: {
          name?: string
          updated_at?: string
          value?: string
        }
        Relationships: []
      }
      audit_chunks: {
        Row: {
          chunk_index: number | null
          chunk_input: string | null
          created_at: string
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
          created_at?: string
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
          created_at?: string
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
        Relationships: [
          {
            foreignKeyName: "audit_chunks_documento_id_fkey"
            columns: ["documento_id"]
            isOneToOne: false
            referencedRelation: "documentos_subidos"
            referencedColumns: ["id"]
          },
        ]
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
          receptor_email: string | null
          receptor_giro: string | null
          receptor_razon_social: string | null
          receptor_rut: string | null
          receptor_telefono: string | null
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
          receptor_email?: string | null
          receptor_giro?: string | null
          receptor_razon_social?: string | null
          receptor_rut?: string | null
          receptor_telefono?: string | null
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
          receptor_email?: string | null
          receptor_giro?: string | null
          receptor_razon_social?: string | null
          receptor_rut?: string | null
          receptor_telefono?: string | null
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
          tipo_dte: number | null
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
          tipo_dte?: number | null
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
          tipo_dte?: number | null
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
      config_global: {
        Row: {
          clave: string
          updated_at: string
          valor: Json
        }
        Insert: {
          clave: string
          updated_at?: string
          valor: Json
        }
        Update: {
          clave?: string
          updated_at?: string
          valor?: Json
        }
        Relationships: []
      }
      consentimientos: {
        Row: {
          aceptado_at: string
          created_at: string
          documento: string
          email: string | null
          id: string
          ip: string | null
          user_agent: string | null
          user_id: string
          version: string
        }
        Insert: {
          aceptado_at?: string
          created_at?: string
          documento?: string
          email?: string | null
          id?: string
          ip?: string | null
          user_agent?: string | null
          user_id: string
          version: string
        }
        Update: {
          aceptado_at?: string
          created_at?: string
          documento?: string
          email?: string | null
          id?: string
          ip?: string | null
          user_agent?: string | null
          user_id?: string
          version?: string
        }
        Relationships: []
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
      cuenta_addons: {
        Row: {
          cantidad: number
          created_at: string
          cuenta_id: string
          estado: string
          id: string
          origen: string
          periodo: string | null
          proveedor_ref: string | null
          tipo: string
        }
        Insert: {
          cantidad?: number
          created_at?: string
          cuenta_id: string
          estado?: string
          id?: string
          origen?: string
          periodo?: string | null
          proveedor_ref?: string | null
          tipo: string
        }
        Update: {
          cantidad?: number
          created_at?: string
          cuenta_id?: string
          estado?: string
          id?: string
          origen?: string
          periodo?: string | null
          proveedor_ref?: string | null
          tipo?: string
        }
        Relationships: [
          {
            foreignKeyName: "cuenta_addons_cuenta_id_fkey"
            columns: ["cuenta_id"]
            isOneToOne: false
            referencedRelation: "cuentas"
            referencedColumns: ["id"]
          },
        ]
      }
      cuenta_audit_events: {
        Row: {
          accion: string
          created_at: string
          cuenta_id: string
          empresa_id: string | null
          id: string
          metadata: Json
          recurso_id: string | null
          recurso_tipo: string | null
          resumen: string
          usuario_id: string | null
        }
        Insert: {
          accion: string
          created_at?: string
          cuenta_id: string
          empresa_id?: string | null
          id?: string
          metadata?: Json
          recurso_id?: string | null
          recurso_tipo?: string | null
          resumen: string
          usuario_id?: string | null
        }
        Update: {
          accion?: string
          created_at?: string
          cuenta_id?: string
          empresa_id?: string | null
          id?: string
          metadata?: Json
          recurso_id?: string | null
          recurso_tipo?: string | null
          resumen?: string
          usuario_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "cuenta_audit_events_cuenta_id_fkey"
            columns: ["cuenta_id"]
            isOneToOne: false
            referencedRelation: "cuentas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cuenta_audit_events_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cuenta_audit_events_usuario_id_fkey"
            columns: ["usuario_id"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
        ]
      }
      cuenta_empresas: {
        Row: {
          activa: boolean
          created_at: string
          cuenta_id: string
          desactivada_motivo: string | null
          empresa_id: string
          es_principal: boolean
        }
        Insert: {
          activa?: boolean
          created_at?: string
          cuenta_id: string
          desactivada_motivo?: string | null
          empresa_id: string
          es_principal?: boolean
        }
        Update: {
          activa?: boolean
          created_at?: string
          cuenta_id?: string
          desactivada_motivo?: string | null
          empresa_id?: string
          es_principal?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "cuenta_empresas_cuenta_id_fkey"
            columns: ["cuenta_id"]
            isOneToOne: false
            referencedRelation: "cuentas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cuenta_empresas_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: true
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
        ]
      }
      cuenta_usuarios: {
        Row: {
          activo: boolean
          created_at: string
          cuenta_id: string
          es_titular: boolean
          usuario_id: string
        }
        Insert: {
          activo?: boolean
          created_at?: string
          cuenta_id: string
          es_titular?: boolean
          usuario_id: string
        }
        Update: {
          activo?: boolean
          created_at?: string
          cuenta_id?: string
          es_titular?: boolean
          usuario_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "cuenta_usuarios_cuenta_id_fkey"
            columns: ["cuenta_id"]
            isOneToOne: false
            referencedRelation: "cuentas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cuenta_usuarios_usuario_id_fkey"
            columns: ["usuario_id"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
        ]
      }
      cuentas: {
        Row: {
          created_at: string
          empresa_operativa_elegida_at: string | null
          id: string
          nombre: string
          owner_usuario_id: string | null
          plan_activo: boolean
          plan_codigo: string | null
          trial_cortesia: boolean
          updated_at: string
        }
        Insert: {
          created_at?: string
          empresa_operativa_elegida_at?: string | null
          id?: string
          nombre: string
          owner_usuario_id?: string | null
          plan_activo?: boolean
          plan_codigo?: string | null
          trial_cortesia?: boolean
          updated_at?: string
        }
        Update: {
          created_at?: string
          empresa_operativa_elegida_at?: string | null
          id?: string
          nombre?: string
          owner_usuario_id?: string | null
          plan_activo?: boolean
          plan_codigo?: string | null
          trial_cortesia?: boolean
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "cuentas_owner_usuario_id_fkey"
            columns: ["owner_usuario_id"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cuentas_plan_codigo_fkey"
            columns: ["plan_codigo"]
            isOneToOne: false
            referencedRelation: "planes_config"
            referencedColumns: ["codigo"]
          },
        ]
      }
      document_processing_jobs: {
        Row: {
          attempts: number
          checkpoint: Json | null
          completed_at: string | null
          created_at: string
          documento_id: string
          empresa_id: string
          id: string
          idempotency_key: string
          last_error: string | null
          locked_at: string | null
          locked_by: string | null
          max_attempts: number
          metadata: Json
          next_run_at: string
          pipeline_version: string
          started_at: string | null
          status: string
          storage_path: string
          tipo: string
          updated_at: string
          usuario_id: string | null
        }
        Insert: {
          attempts?: number
          checkpoint?: Json | null
          completed_at?: string | null
          created_at?: string
          documento_id: string
          empresa_id: string
          id?: string
          idempotency_key: string
          last_error?: string | null
          locked_at?: string | null
          locked_by?: string | null
          max_attempts?: number
          metadata?: Json
          next_run_at?: string
          pipeline_version?: string
          started_at?: string | null
          status?: string
          storage_path: string
          tipo: string
          updated_at?: string
          usuario_id?: string | null
        }
        Update: {
          attempts?: number
          checkpoint?: Json | null
          completed_at?: string | null
          created_at?: string
          documento_id?: string
          empresa_id?: string
          id?: string
          idempotency_key?: string
          last_error?: string | null
          locked_at?: string | null
          locked_by?: string | null
          max_attempts?: number
          metadata?: Json
          next_run_at?: string
          pipeline_version?: string
          started_at?: string | null
          status?: string
          storage_path?: string
          tipo?: string
          updated_at?: string
          usuario_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "document_processing_jobs_documento_id_fkey"
            columns: ["documento_id"]
            isOneToOne: false
            referencedRelation: "documentos_subidos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_processing_jobs_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_processing_jobs_usuario_id_fkey"
            columns: ["usuario_id"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
        ]
      }
      documentos_subidos: {
        Row: {
          album_imagenes: Json | null
          archivo_hash: string | null
          contexto_usuario: string | null
          created_at: string
          empresa_id: string
          estado: string
          fuente_datos: string | null
          glosa_activa: boolean
          glosa_comun: string | null
          id: string
          media_group_id: string | null
          medio_pago_comun: string | null
          mesa: string
          movimientos_detectados: number | null
          nombre_archivo: string
          progreso_ia: Json | null
          storage_path: string
          storage_provider: string
          tipo: string
          tipo_operacion_hint: string | null
        }
        Insert: {
          album_imagenes?: Json | null
          archivo_hash?: string | null
          contexto_usuario?: string | null
          created_at?: string
          empresa_id: string
          estado?: string
          fuente_datos?: string | null
          glosa_activa?: boolean
          glosa_comun?: string | null
          id?: string
          media_group_id?: string | null
          medio_pago_comun?: string | null
          mesa?: string
          movimientos_detectados?: number | null
          nombre_archivo: string
          progreso_ia?: Json | null
          storage_path: string
          storage_provider?: string
          tipo: string
          tipo_operacion_hint?: string | null
        }
        Update: {
          album_imagenes?: Json | null
          archivo_hash?: string | null
          contexto_usuario?: string | null
          created_at?: string
          empresa_id?: string
          estado?: string
          fuente_datos?: string | null
          glosa_activa?: boolean
          glosa_comun?: string | null
          id?: string
          media_group_id?: string | null
          medio_pago_comun?: string | null
          mesa?: string
          movimientos_detectados?: number | null
          nombre_archivo?: string
          progreso_ia?: Json | null
          storage_path?: string
          storage_provider?: string
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
      emision_jobs: {
        Row: {
          created_at: string
          cuenta_id: string
          empresa_id: string
          estado: string
          estado_visible: string
          expected_emisor_rut: string | null
          expires_at: string
          heartbeat_at: string
          id: string
          job_id: string
          locked_until: string | null
          origin: string
          propuesta_id: string | null
          provider: string
          status_message: string | null
          updated_at: string
          usuario_id: string
        }
        Insert: {
          created_at?: string
          cuenta_id: string
          empresa_id: string
          estado?: string
          estado_visible?: string
          expected_emisor_rut?: string | null
          expires_at: string
          heartbeat_at?: string
          id?: string
          job_id: string
          locked_until?: string | null
          origin?: string
          propuesta_id?: string | null
          provider: string
          status_message?: string | null
          updated_at?: string
          usuario_id: string
        }
        Update: {
          created_at?: string
          cuenta_id?: string
          empresa_id?: string
          estado?: string
          estado_visible?: string
          expected_emisor_rut?: string | null
          expires_at?: string
          heartbeat_at?: string
          id?: string
          job_id?: string
          locked_until?: string | null
          origin?: string
          propuesta_id?: string | null
          provider?: string
          status_message?: string | null
          updated_at?: string
          usuario_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "emision_jobs_cuenta_id_fkey"
            columns: ["cuenta_id"]
            isOneToOne: false
            referencedRelation: "cuentas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "emision_jobs_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "emision_jobs_propuesta_id_fkey"
            columns: ["propuesta_id"]
            isOneToOne: false
            referencedRelation: "propuestas_ia"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "emision_jobs_usuario_id_fkey"
            columns: ["usuario_id"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
        ]
      }
      emision_locks: {
        Row: {
          created_at: string
          cuenta_id: string
          estado_visible: string
          heartbeat_at: string
          job_id: string
          locked_until: string
          provider: string
          usuario_id: string
        }
        Insert: {
          created_at?: string
          cuenta_id: string
          estado_visible?: string
          heartbeat_at?: string
          job_id: string
          locked_until: string
          provider: string
          usuario_id: string
        }
        Update: {
          created_at?: string
          cuenta_id?: string
          estado_visible?: string
          heartbeat_at?: string
          job_id?: string
          locked_until?: string
          provider?: string
          usuario_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "emision_locks_cuenta_id_fkey"
            columns: ["cuenta_id"]
            isOneToOne: true
            referencedRelation: "cuentas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "emision_locks_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "emision_jobs"
            referencedColumns: ["job_id"]
          },
          {
            foreignKeyName: "emision_locks_usuario_id_fkey"
            columns: ["usuario_id"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
        ]
      }
      emission_authorizations: {
        Row: {
          accepted_at: string
          created_at: string
          cuenta_id: string
          empresa_id: string
          expires_at: string | null
          id: string
          legal_version: string
          metadata: Json
          provider: string
          revoked_at: string | null
          source: string
          updated_at: string
          usuario_id: string
        }
        Insert: {
          accepted_at?: string
          created_at?: string
          cuenta_id: string
          empresa_id: string
          expires_at?: string | null
          id?: string
          legal_version: string
          metadata?: Json
          provider: string
          revoked_at?: string | null
          source?: string
          updated_at?: string
          usuario_id: string
        }
        Update: {
          accepted_at?: string
          created_at?: string
          cuenta_id?: string
          empresa_id?: string
          expires_at?: string | null
          id?: string
          legal_version?: string
          metadata?: Json
          provider?: string
          revoked_at?: string | null
          source?: string
          updated_at?: string
          usuario_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "emission_authorizations_cuenta_id_fkey"
            columns: ["cuenta_id"]
            isOneToOne: false
            referencedRelation: "cuentas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "emission_authorizations_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "emission_authorizations_usuario_id_fkey"
            columns: ["usuario_id"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
        ]
      }
      empresa_identidades: {
        Row: {
          created_at: string
          empresa_id: string
          fuente: string
          id: string
          tipo: string
          valor: string
        }
        Insert: {
          created_at?: string
          empresa_id: string
          fuente?: string
          id?: string
          tipo?: string
          valor: string
        }
        Update: {
          created_at?: string
          empresa_id?: string
          fuente?: string
          id?: string
          tipo?: string
          valor?: string
        }
        Relationships: [
          {
            foreignKeyName: "empresa_identidades_empresa_id_fkey"
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
      empresas: {
        Row: {
          boletas_emision_proveedor: string
          clave_sii: string | null
          comuna: string | null
          contexto_usuario_default: string | null
          created_at: string
          direccion: string | null
          email_sii: string | null
          emision_baseapi_sandbox: boolean
          emision_proveedor: string
          ext_last_seen_at: string | null
          ext_last_version: string | null
          facturas_emision_proveedor: string
          giro: string | null
          id: string
          logo_mime_type: string | null
          logo_storage_path: string | null
          operacion_hint_default: string | null
          plan: string | null
          plan_activo: boolean
          plan_vence_at: string | null
          razon_social: string
          regimen_tributario: string | null
          region: string | null
          rut: string
          tiene_certificado_sii: boolean
          tipo_contribuyente: string
          trial_inicio: string | null
        }
        Insert: {
          boletas_emision_proveedor?: string
          clave_sii?: string | null
          comuna?: string | null
          contexto_usuario_default?: string | null
          created_at?: string
          direccion?: string | null
          email_sii?: string | null
          emision_baseapi_sandbox?: boolean
          emision_proveedor?: string
          ext_last_seen_at?: string | null
          ext_last_version?: string | null
          facturas_emision_proveedor?: string
          giro?: string | null
          id?: string
          logo_mime_type?: string | null
          logo_storage_path?: string | null
          operacion_hint_default?: string | null
          plan?: string | null
          plan_activo?: boolean
          plan_vence_at?: string | null
          razon_social: string
          regimen_tributario?: string | null
          region?: string | null
          rut: string
          tiene_certificado_sii?: boolean
          tipo_contribuyente?: string
          trial_inicio?: string | null
        }
        Update: {
          boletas_emision_proveedor?: string
          clave_sii?: string | null
          comuna?: string | null
          contexto_usuario_default?: string | null
          created_at?: string
          direccion?: string | null
          email_sii?: string | null
          emision_baseapi_sandbox?: boolean
          emision_proveedor?: string
          ext_last_seen_at?: string | null
          ext_last_version?: string | null
          facturas_emision_proveedor?: string
          giro?: string | null
          id?: string
          logo_mime_type?: string | null
          logo_storage_path?: string | null
          operacion_hint_default?: string | null
          plan?: string | null
          plan_activo?: boolean
          plan_vence_at?: string | null
          razon_social?: string
          regimen_tributario?: string | null
          region?: string | null
          rut?: string
          tiene_certificado_sii?: boolean
          tipo_contribuyente?: string
          trial_inicio?: string | null
        }
        Relationships: []
      }
      extension_vault_keys: {
        Row: {
          created_at: string
          device_id: string
          last_used_at: string | null
          revoked_at: string | null
          usuario_id: string
          version: number
          ws_cifrado: string
        }
        Insert: {
          created_at?: string
          device_id: string
          last_used_at?: string | null
          revoked_at?: string | null
          usuario_id: string
          version?: number
          ws_cifrado: string
        }
        Update: {
          created_at?: string
          device_id?: string
          last_used_at?: string | null
          revoked_at?: string | null
          usuario_id?: string
          version?: number
          ws_cifrado?: string
        }
        Relationships: [
          {
            foreignKeyName: "extension_vault_keys_usuario_id_fkey"
            columns: ["usuario_id"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
        ]
      }
      folio_reservas: {
        Row: {
          created_at: string
          empresa_id: string
          estado: string
          expires_at: string
          folio: number
          id: string
          job_id: string
          tipo_dte: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          empresa_id: string
          estado?: string
          expires_at: string
          folio: number
          id?: string
          job_id: string
          tipo_dte: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          empresa_id?: string
          estado?: string
          expires_at?: string
          folio?: number
          id?: string
          job_id?: string
          tipo_dte?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "folio_reservas_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "folio_reservas_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: true
            referencedRelation: "emision_jobs"
            referencedColumns: ["job_id"]
          },
        ]
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
      mcp_tokens: {
        Row: {
          client_id: string | null
          created_at: string
          expires_at: string | null
          id: string
          last_used_at: string | null
          nombre: string
          origen: string
          refresh_token_hash: string | null
          revoked_at: string | null
          token_hash: string
          usuario_id: string
        }
        Insert: {
          client_id?: string | null
          created_at?: string
          expires_at?: string | null
          id?: string
          last_used_at?: string | null
          nombre?: string
          origen?: string
          refresh_token_hash?: string | null
          revoked_at?: string | null
          token_hash: string
          usuario_id: string
        }
        Update: {
          client_id?: string | null
          created_at?: string
          expires_at?: string | null
          id?: string
          last_used_at?: string | null
          nombre?: string
          origen?: string
          refresh_token_hash?: string | null
          revoked_at?: string | null
          token_hash?: string
          usuario_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "mcp_tokens_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "oauth_clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mcp_tokens_usuario_id_fkey"
            columns: ["usuario_id"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
        ]
      }
      medios_pago: {
        Row: {
          ambiente: string
          created_at: string
          cuenta_id: string
          estado: string
          id: string
          inscrito_at: string | null
          marca: string | null
          proveedor: string
          proveedor_ref: string
          ultimos4: string | null
          updated_at: string
        }
        Insert: {
          ambiente?: string
          created_at?: string
          cuenta_id: string
          estado?: string
          id?: string
          inscrito_at?: string | null
          marca?: string | null
          proveedor: string
          proveedor_ref: string
          ultimos4?: string | null
          updated_at?: string
        }
        Update: {
          ambiente?: string
          created_at?: string
          cuenta_id?: string
          estado?: string
          id?: string
          inscrito_at?: string | null
          marca?: string | null
          proveedor?: string
          proveedor_ref?: string
          ultimos4?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "medios_pago_cuenta_id_fkey"
            columns: ["cuenta_id"]
            isOneToOne: false
            referencedRelation: "cuentas"
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
          transaccion_id: string | null
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
          transaccion_id?: string | null
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
          transaccion_id?: string | null
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
          {
            foreignKeyName: "movimientos_raw_transaccion_id_fkey"
            columns: ["transaccion_id"]
            isOneToOne: false
            referencedRelation: "transacciones"
            referencedColumns: ["id"]
          },
        ]
      }
      oauth_clients: {
        Row: {
          client_name: string
          created_at: string
          id: string
          redirect_uris: Json
        }
        Insert: {
          client_name?: string
          created_at?: string
          id?: string
          redirect_uris: Json
        }
        Update: {
          client_name?: string
          created_at?: string
          id?: string
          redirect_uris?: Json
        }
        Relationships: []
      }
      oauth_codes: {
        Row: {
          client_id: string
          code_challenge: string
          code_hash: string
          created_at: string
          expires_at: string
          redirect_uri: string
          scope: string
          used_at: string | null
          usuario_id: string
        }
        Insert: {
          client_id: string
          code_challenge: string
          code_hash: string
          created_at?: string
          expires_at: string
          redirect_uri: string
          scope?: string
          used_at?: string | null
          usuario_id: string
        }
        Update: {
          client_id?: string
          code_challenge?: string
          code_hash?: string
          created_at?: string
          expires_at?: string
          redirect_uri?: string
          scope?: string
          used_at?: string | null
          usuario_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "oauth_codes_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "oauth_clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "oauth_codes_usuario_id_fkey"
            columns: ["usuario_id"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
        ]
      }
      ocr_jobs: {
        Row: {
          created_at: string
          documento_id: string | null
          empresa_id: string | null
          estado: string
          id: string
          intentos: number
          last_error: string | null
          locked_at: string | null
          locked_by: string | null
          max_intentos: number
          metadata: Json
          resultado: Json | null
          storage_path: string
          storage_provider: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          documento_id?: string | null
          empresa_id?: string | null
          estado?: string
          id?: string
          intentos?: number
          last_error?: string | null
          locked_at?: string | null
          locked_by?: string | null
          max_intentos?: number
          metadata?: Json
          resultado?: Json | null
          storage_path: string
          storage_provider?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          documento_id?: string | null
          empresa_id?: string | null
          estado?: string
          id?: string
          intentos?: number
          last_error?: string | null
          locked_at?: string | null
          locked_by?: string | null
          max_intentos?: number
          metadata?: Json
          resultado?: Json | null
          storage_path?: string
          storage_provider?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ocr_jobs_documento_id_fkey"
            columns: ["documento_id"]
            isOneToOne: false
            referencedRelation: "documentos_subidos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ocr_jobs_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
        ]
      }
      ops_events: {
        Row: {
          created_at: string
          cuenta_id: string | null
          empresa_id: string | null
          event_name: string
          id: string
          metadata: Json
          resource_id: string | null
          resource_type: string | null
          severity: string
          source: string
          summary: string
          usuario_id: string | null
        }
        Insert: {
          created_at?: string
          cuenta_id?: string | null
          empresa_id?: string | null
          event_name: string
          id?: string
          metadata?: Json
          resource_id?: string | null
          resource_type?: string | null
          severity: string
          source: string
          summary: string
          usuario_id?: string | null
        }
        Update: {
          created_at?: string
          cuenta_id?: string | null
          empresa_id?: string | null
          event_name?: string
          id?: string
          metadata?: Json
          resource_id?: string | null
          resource_type?: string | null
          severity?: string
          source?: string
          summary?: string
          usuario_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ops_events_cuenta_id_fkey"
            columns: ["cuenta_id"]
            isOneToOne: false
            referencedRelation: "cuentas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ops_events_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ops_events_usuario_id_fkey"
            columns: ["usuario_id"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
        ]
      }
      pagos: {
        Row: {
          created_at: string
          cuenta_id: string | null
          empresa_id: string | null
          estado: string
          id: string
          monto_clp: number | null
          proveedor: string
          proveedor_ref: string | null
          raw: Json | null
          tipo: string
        }
        Insert: {
          created_at?: string
          cuenta_id?: string | null
          empresa_id?: string | null
          estado: string
          id?: string
          monto_clp?: number | null
          proveedor: string
          proveedor_ref?: string | null
          raw?: Json | null
          tipo: string
        }
        Update: {
          created_at?: string
          cuenta_id?: string | null
          empresa_id?: string | null
          estado?: string
          id?: string
          monto_clp?: number | null
          proveedor?: string
          proveedor_ref?: string | null
          raw?: Json | null
          tipo?: string
        }
        Relationships: [
          {
            foreignKeyName: "pagos_cuenta_id_fkey"
            columns: ["cuenta_id"]
            isOneToOne: false
            referencedRelation: "cuentas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pagos_empresa_id_fkey"
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
          creado_por_empresa_id: string | null
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
          creado_por_empresa_id?: string | null
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
          creado_por_empresa_id?: string | null
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
        Relationships: [
          {
            foreignKeyName: "parser_adapters_creado_por_empresa_id_fkey"
            columns: ["creado_por_empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
        ]
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
          {
            foreignKeyName: "parser_logs_documento_id_fkey"
            columns: ["documento_id"]
            isOneToOne: false
            referencedRelation: "documentos_subidos"
            referencedColumns: ["id"]
          },
        ]
      }
      periodos_contables: {
        Row: {
          anio: number
          cerrado_at: string | null
          created_at: string
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
          created_at?: string
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
          created_at?: string
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
      planes_config: {
        Row: {
          activo: boolean
          codigo: string
          cuota_masivas: number
          empresas_incluidas: number
          equipo: boolean
          features: Json
          multiempresa: boolean
          nombre: string
          personas_incluidas: number
          refill_boletas: number
          refill_clp_neto: number
          ruts_incluidos: number
          telegram_comprobantes: number
          trial_boletas: number
          trial_dias: number
          uf_mensual: number
          uf_rut_adicional: number
          updated_at: string
        }
        Insert: {
          activo?: boolean
          codigo: string
          cuota_masivas: number
          empresas_incluidas?: number
          equipo?: boolean
          features?: Json
          multiempresa?: boolean
          nombre: string
          personas_incluidas?: number
          refill_boletas?: number
          refill_clp_neto?: number
          ruts_incluidos?: number
          telegram_comprobantes?: number
          trial_boletas?: number
          trial_dias?: number
          uf_mensual: number
          uf_rut_adicional?: number
          updated_at?: string
        }
        Update: {
          activo?: boolean
          codigo?: string
          cuota_masivas?: number
          empresas_incluidas?: number
          equipo?: boolean
          features?: Json
          multiempresa?: boolean
          nombre?: string
          personas_incluidas?: number
          refill_boletas?: number
          refill_clp_neto?: number
          ruts_incluidos?: number
          telegram_comprobantes?: number
          trial_boletas?: number
          trial_dias?: number
          uf_mensual?: number
          uf_rut_adicional?: number
          updated_at?: string
        }
        Relationships: []
      }
      propuestas_ia: {
        Row: {
          cliente_id: string | null
          confianza: number | null
          created_at: string
          detalle: string | null
          empresa_id: string
          estado: string
          fuente_clasificacion: string | null
          id: string
          iva: number | null
          medio_pago: string | null
          mesa: string
          moneda_origen: string | null
          monto_moneda_origen: number | null
          monto_neto: number | null
          movimiento_id: string
          notas: string | null
          receptor_comuna: string | null
          receptor_direccion: string | null
          receptor_email: string | null
          receptor_giro: string | null
          receptor_nombre: string | null
          receptor_rut: string | null
          receptor_telefono: string | null
          regla_id: string | null
          spread_compra: number | null
          spread_ganancia: number | null
          spread_venta: number | null
          tipo_dte: number | null
          tipo_propuesto: string
          total: number | null
          transaccion_id: string | null
        }
        Insert: {
          cliente_id?: string | null
          confianza?: number | null
          created_at?: string
          detalle?: string | null
          empresa_id: string
          estado?: string
          fuente_clasificacion?: string | null
          id?: string
          iva?: number | null
          medio_pago?: string | null
          mesa?: string
          moneda_origen?: string | null
          monto_moneda_origen?: number | null
          monto_neto?: number | null
          movimiento_id: string
          notas?: string | null
          receptor_comuna?: string | null
          receptor_direccion?: string | null
          receptor_email?: string | null
          receptor_giro?: string | null
          receptor_nombre?: string | null
          receptor_rut?: string | null
          receptor_telefono?: string | null
          regla_id?: string | null
          spread_compra?: number | null
          spread_ganancia?: number | null
          spread_venta?: number | null
          tipo_dte?: number | null
          tipo_propuesto: string
          total?: number | null
          transaccion_id?: string | null
        }
        Update: {
          cliente_id?: string | null
          confianza?: number | null
          created_at?: string
          detalle?: string | null
          empresa_id?: string
          estado?: string
          fuente_clasificacion?: string | null
          id?: string
          iva?: number | null
          medio_pago?: string | null
          mesa?: string
          moneda_origen?: string | null
          monto_moneda_origen?: number | null
          monto_neto?: number | null
          movimiento_id?: string
          notas?: string | null
          receptor_comuna?: string | null
          receptor_direccion?: string | null
          receptor_email?: string | null
          receptor_giro?: string | null
          receptor_nombre?: string | null
          receptor_rut?: string | null
          receptor_telefono?: string | null
          regla_id?: string | null
          spread_compra?: number | null
          spread_ganancia?: number | null
          spread_venta?: number | null
          tipo_dte?: number | null
          tipo_propuesto?: string
          total?: number | null
          transaccion_id?: string | null
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
          {
            foreignKeyName: "propuestas_ia_transaccion_id_fkey"
            columns: ["transaccion_id"]
            isOneToOne: false
            referencedRelation: "transacciones"
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
      rate_limit_buckets: {
        Row: {
          count: number
          key: string
          reset_at: string
        }
        Insert: {
          count: number
          key: string
          reset_at: string
        }
        Update: {
          count?: number
          key?: string
          reset_at?: string
        }
        Relationships: []
      }
      refills: {
        Row: {
          boletas: number
          created_at: string
          cuenta_id: string | null
          empresa_id: string
          id: string
          origen: string
          periodo: string
          proveedor_ref: string | null
        }
        Insert: {
          boletas: number
          created_at?: string
          cuenta_id?: string | null
          empresa_id: string
          id?: string
          origen?: string
          periodo: string
          proveedor_ref?: string | null
        }
        Update: {
          boletas?: number
          created_at?: string
          cuenta_id?: string | null
          empresa_id?: string
          id?: string
          origen?: string
          periodo?: string
          proveedor_ref?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "refills_cuenta_id_fkey"
            columns: ["cuenta_id"]
            isOneToOne: false
            referencedRelation: "cuentas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "refills_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
        ]
      }
      sii_local_resultados: {
        Row: {
          error: string | null
          folio: number | null
          id: string
          job_id: string | null
          received_at: string
          result: Json | null
          status: string
          user_id: string
        }
        Insert: {
          error?: string | null
          folio?: number | null
          id?: string
          job_id?: string | null
          received_at?: string
          result?: Json | null
          status: string
          user_id: string
        }
        Update: {
          error?: string | null
          folio?: number | null
          id?: string
          job_id?: string | null
          received_at?: string
          result?: Json | null
          status?: string
          user_id?: string
        }
        Relationships: []
      }
      soporte_intervenciones: {
        Row: {
          canal: string
          canjeable_hasta: string
          canjeada_at: string | null
          codigo: string
          creada_at: string
          empresa_id: string
          expira_at: string | null
          id: string
          motivo: string | null
          operador_email: string
          revocada_at: string | null
        }
        Insert: {
          canal?: string
          canjeable_hasta: string
          canjeada_at?: string | null
          codigo: string
          creada_at?: string
          empresa_id: string
          expira_at?: string | null
          id?: string
          motivo?: string | null
          operador_email: string
          revocada_at?: string | null
        }
        Update: {
          canal?: string
          canjeable_hasta?: string
          canjeada_at?: string | null
          codigo?: string
          creada_at?: string
          empresa_id?: string
          expira_at?: string | null
          id?: string
          motivo?: string | null
          operador_email?: string
          revocada_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "soporte_intervenciones_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
        ]
      }
      suscripciones: {
        Row: {
          cancela_al_terminar: boolean
          clp_ultimo_cobro: number | null
          created_at: string
          cuenta_id: string | null
          empresa_id: string
          estado: string
          id: string
          periodo_hasta: string | null
          plan_codigo: string
          plan_siguiente: string | null
          proveedor: string
          proveedor_ref: string | null
          updated_at: string
        }
        Insert: {
          cancela_al_terminar?: boolean
          clp_ultimo_cobro?: number | null
          created_at?: string
          cuenta_id?: string | null
          empresa_id: string
          estado?: string
          id?: string
          periodo_hasta?: string | null
          plan_codigo: string
          plan_siguiente?: string | null
          proveedor?: string
          proveedor_ref?: string | null
          updated_at?: string
        }
        Update: {
          cancela_al_terminar?: boolean
          clp_ultimo_cobro?: number | null
          created_at?: string
          cuenta_id?: string | null
          empresa_id?: string
          estado?: string
          id?: string
          periodo_hasta?: string | null
          plan_codigo?: string
          plan_siguiente?: string | null
          proveedor?: string
          proveedor_ref?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "suscripciones_cuenta_id_fkey"
            columns: ["cuenta_id"]
            isOneToOne: false
            referencedRelation: "cuentas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "suscripciones_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "suscripciones_plan_codigo_fkey"
            columns: ["plan_codigo"]
            isOneToOne: false
            referencedRelation: "planes_config"
            referencedColumns: ["codigo"]
          },
          {
            foreignKeyName: "suscripciones_plan_siguiente_fkey"
            columns: ["plan_siguiente"]
            isOneToOne: false
            referencedRelation: "planes_config"
            referencedColumns: ["codigo"]
          },
        ]
      }
      telegram_album_buffer: {
        Row: {
          created_at: string
          empresa_id: string
          id: string
          image: Json
          media_group_id: string
        }
        Insert: {
          created_at?: string
          empresa_id: string
          id?: string
          image: Json
          media_group_id: string
        }
        Update: {
          created_at?: string
          empresa_id?: string
          id?: string
          image?: Json
          media_group_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "telegram_album_buffer_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
        ]
      }
      telegram_audit_events: {
        Row: {
          action: string
          chat_id: number | null
          created_at: string
          documento_id: string | null
          empresa_id: string
          id: string
          metadata: Json
          propuesta_id: string | null
        }
        Insert: {
          action: string
          chat_id?: number | null
          created_at?: string
          documento_id?: string | null
          empresa_id: string
          id?: string
          metadata?: Json
          propuesta_id?: string | null
        }
        Update: {
          action?: string
          chat_id?: number | null
          created_at?: string
          documento_id?: string | null
          empresa_id?: string
          id?: string
          metadata?: Json
          propuesta_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "telegram_audit_events_documento_id_fkey"
            columns: ["documento_id"]
            isOneToOne: false
            referencedRelation: "documentos_subidos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "telegram_audit_events_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "telegram_audit_events_propuesta_id_fkey"
            columns: ["propuesta_id"]
            isOneToOne: false
            referencedRelation: "propuestas_ia"
            referencedColumns: ["id"]
          },
        ]
      }
      telegram_chats: {
        Row: {
          activo: boolean
          chat_id: number
          empresa_id: string
          usuario_id: string | null
          vinculado_at: string
        }
        Insert: {
          activo?: boolean
          chat_id: number
          empresa_id: string
          usuario_id?: string | null
          vinculado_at?: string
        }
        Update: {
          activo?: boolean
          chat_id?: number
          empresa_id?: string
          usuario_id?: string | null
          vinculado_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "telegram_chats_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "telegram_chats_usuario_id_fkey"
            columns: ["usuario_id"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
        ]
      }
      telegram_comprobante_pendientes: {
        Row: {
          chat_id: number
          created_at: string
          cuenta_id: string
          empresa_origen_id: string
          estado: string
          expires_at: string
          file_id: string
          file_size: number | null
          message_id: number | null
          opciones: Json
          received_at: number | null
          selected_empresa_id: string | null
          token: string
          updated_at: string
        }
        Insert: {
          chat_id: number
          created_at?: string
          cuenta_id: string
          empresa_origen_id: string
          estado?: string
          expires_at: string
          file_id: string
          file_size?: number | null
          message_id?: number | null
          opciones?: Json
          received_at?: number | null
          selected_empresa_id?: string | null
          token: string
          updated_at?: string
        }
        Update: {
          chat_id?: number
          created_at?: string
          cuenta_id?: string
          empresa_origen_id?: string
          estado?: string
          expires_at?: string
          file_id?: string
          file_size?: number | null
          message_id?: number | null
          opciones?: Json
          received_at?: number | null
          selected_empresa_id?: string | null
          token?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "telegram_comprobante_pendientes_chat_id_fkey"
            columns: ["chat_id"]
            isOneToOne: false
            referencedRelation: "telegram_chats"
            referencedColumns: ["chat_id"]
          },
          {
            foreignKeyName: "telegram_comprobante_pendientes_cuenta_id_fkey"
            columns: ["cuenta_id"]
            isOneToOne: false
            referencedRelation: "cuentas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "telegram_comprobante_pendientes_empresa_origen_id_fkey"
            columns: ["empresa_origen_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "telegram_comprobante_pendientes_selected_empresa_id_fkey"
            columns: ["selected_empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
        ]
      }
      telegram_duplicate_actions: {
        Row: {
          created_at: string
          detalle: Json
          documento_id: string
          empresa_id: string
          estado: string
          fingerprint: string
          id: string
          message_id: number | null
          movimiento_id: string | null
          propuesta_id: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          detalle: Json
          documento_id: string
          empresa_id: string
          estado?: string
          fingerprint: string
          id?: string
          message_id?: number | null
          movimiento_id?: string | null
          propuesta_id?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          detalle?: Json
          documento_id?: string
          empresa_id?: string
          estado?: string
          fingerprint?: string
          id?: string
          message_id?: number | null
          movimiento_id?: string | null
          propuesta_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "telegram_duplicate_actions_documento_id_fkey"
            columns: ["documento_id"]
            isOneToOne: false
            referencedRelation: "documentos_subidos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "telegram_duplicate_actions_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "telegram_duplicate_actions_movimiento_id_fkey"
            columns: ["movimiento_id"]
            isOneToOne: false
            referencedRelation: "movimientos_raw"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "telegram_duplicate_actions_propuesta_id_fkey"
            columns: ["propuesta_id"]
            isOneToOne: false
            referencedRelation: "propuestas_ia"
            referencedColumns: ["id"]
          },
        ]
      }
      telegram_link_tokens: {
        Row: {
          empresa_id: string
          expires_at: string
          token: string
          used_at: string | null
          usuario_id: string
        }
        Insert: {
          empresa_id: string
          expires_at: string
          token: string
          used_at?: string | null
          usuario_id: string
        }
        Update: {
          empresa_id?: string
          expires_at?: string
          token?: string
          used_at?: string | null
          usuario_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "telegram_link_tokens_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
        ]
      }
      telegram_pending_edits: {
        Row: {
          campo: string
          chat_id: number
          created_at: string
          message_id: number | null
          propuesta_id: string
        }
        Insert: {
          campo: string
          chat_id: number
          created_at?: string
          message_id?: number | null
          propuesta_id: string
        }
        Update: {
          campo?: string
          chat_id?: number
          created_at?: string
          message_id?: number | null
          propuesta_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "telegram_pending_edits_propuesta_id_fkey"
            columns: ["propuesta_id"]
            isOneToOne: false
            referencedRelation: "propuestas_ia"
            referencedColumns: ["id"]
          },
        ]
      }
      telegram_propuesta_messages: {
        Row: {
          chat_id: number
          created_at: string
          documento_id: string | null
          empresa_id: string
          estado: string
          id: string
          kind: string
          message_id: number
          propuesta_id: string | null
          updated_at: string
        }
        Insert: {
          chat_id: number
          created_at?: string
          documento_id?: string | null
          empresa_id: string
          estado?: string
          id?: string
          kind?: string
          message_id: number
          propuesta_id?: string | null
          updated_at?: string
        }
        Update: {
          chat_id?: number
          created_at?: string
          documento_id?: string | null
          empresa_id?: string
          estado?: string
          id?: string
          kind?: string
          message_id?: number
          propuesta_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "telegram_propuesta_messages_chat_id_fkey"
            columns: ["chat_id"]
            isOneToOne: false
            referencedRelation: "telegram_chats"
            referencedColumns: ["chat_id"]
          },
          {
            foreignKeyName: "telegram_propuesta_messages_documento_id_fkey"
            columns: ["documento_id"]
            isOneToOne: false
            referencedRelation: "documentos_subidos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "telegram_propuesta_messages_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "telegram_propuesta_messages_propuesta_id_fkey"
            columns: ["propuesta_id"]
            isOneToOne: false
            referencedRelation: "propuestas_ia"
            referencedColumns: ["id"]
          },
        ]
      }
      telegram_sesiones: {
        Row: {
          chat_id: number
          created_at: string
          documento_id: string | null
          empresa_id: string | null
          estado: string
          expires_at: string
          mesa: string | null
          message_id: number | null
          opciones: Json
          token: string
          updated_at: string
        }
        Insert: {
          chat_id: number
          created_at?: string
          documento_id?: string | null
          empresa_id?: string | null
          estado?: string
          expires_at: string
          mesa?: string | null
          message_id?: number | null
          opciones?: Json
          token: string
          updated_at?: string
        }
        Update: {
          chat_id?: number
          created_at?: string
          documento_id?: string | null
          empresa_id?: string | null
          estado?: string
          expires_at?: string
          mesa?: string | null
          message_id?: number | null
          opciones?: Json
          token?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "telegram_sesiones_chat_id_fkey"
            columns: ["chat_id"]
            isOneToOne: true
            referencedRelation: "telegram_chats"
            referencedColumns: ["chat_id"]
          },
          {
            foreignKeyName: "telegram_sesiones_documento_id_fkey"
            columns: ["documento_id"]
            isOneToOne: false
            referencedRelation: "documentos_subidos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "telegram_sesiones_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
        ]
      }
      transacciones: {
        Row: {
          contraparte: string | null
          correlacionada_at: string | null
          created_at: string
          empresa_id: string
          estado: string
          fecha: string
          hora: string | null
          id: string
          monto_clp: number
          movimiento_ancla_id: string | null
        }
        Insert: {
          contraparte?: string | null
          correlacionada_at?: string | null
          created_at?: string
          empresa_id: string
          estado?: string
          fecha: string
          hora?: string | null
          id?: string
          monto_clp: number
          movimiento_ancla_id?: string | null
        }
        Update: {
          contraparte?: string | null
          correlacionada_at?: string | null
          created_at?: string
          empresa_id?: string
          estado?: string
          fecha?: string
          hora?: string | null
          id?: string
          monto_clp?: number
          movimiento_ancla_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "transacciones_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
        ]
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
          ultimo_acceso: string | null
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
          ultimo_acceso?: string | null
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
          ultimo_acceso?: string | null
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
      crear_empresa_invitacion_titular: {
        Args: {
          p_email: string
          p_empresa_id: string
          p_expires_at: string
          p_invited_by: string
          p_rol: string
          p_token_hash: string
        }
        Returns: {
          cuenta_id: string
          error: string
          invitacion_id: string
          ok: boolean
        }[]
      }
      cuenta_de_empresa: { Args: { p_empresa_id: string }; Returns: string }
      cuentas_del_usuario: { Args: never; Returns: string[] }
      documento_pipeline_counts: {
        Args: { p_desde: string; p_empresa: string; p_hasta: string }
        Returns: {
          documento_id: string
          emitida: number
          lista: number
          no_aplica: number
          por_revisar: number
          total: number
        }[]
      }
      empresa_autorizada: { Args: never; Returns: string }
      rate_limit_hit: {
        Args: { p_key: string; p_limit: number; p_window_ms: number }
        Returns: {
          allowed: boolean
          retry_after_seconds: number
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
