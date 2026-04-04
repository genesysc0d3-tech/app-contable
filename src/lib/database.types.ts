export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
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
          id: string
          movimientos_detectados: number | null
          nombre_archivo: string
          progreso_ia: Json | null
          storage_path: string
          tipo: string
        }
        Insert: {
          created_at?: string
          empresa_id: string
          estado?: string
          id?: string
          movimientos_detectados?: number | null
          nombre_archivo: string
          progreso_ia?: Json | null
          storage_path: string
          tipo: string
        }
        Update: {
          created_at?: string
          empresa_id?: string
          estado?: string
          id?: string
          movimientos_detectados?: number | null
          nombre_archivo?: string
          progreso_ia?: Json | null
          storage_path?: string
          tipo?: string
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
          comuna: string | null
          created_at: string
          direccion: string | null
          email_sii: string | null
          giro: string | null
          id: string
          plan: string | null
          plan_activo: boolean
          plan_vence_at: string | null
          razon_social: string
          regimen_tributario: string | null
          region: string | null
          rut: string
        }
        Insert: {
          clave_sii?: string | null
          comuna?: string | null
          created_at?: string
          direccion?: string | null
          email_sii?: string | null
          giro?: string | null
          id?: string
          plan?: string | null
          plan_activo?: boolean
          plan_vence_at?: string | null
          razon_social: string
          regimen_tributario?: string | null
          region?: string | null
          rut: string
        }
        Update: {
          clave_sii?: string | null
          comuna?: string | null
          created_at?: string
          direccion?: string | null
          email_sii?: string | null
          giro?: string | null
          id?: string
          plan?: string | null
          plan_activo?: boolean
          plan_vence_at?: string | null
          razon_social?: string
          regimen_tributario?: string | null
          region?: string | null
          rut?: string
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
          id: string
          iva: number | null
          moneda_origen: string | null
          monto_moneda_origen: number | null
          monto_neto: number | null
          movimiento_id: string
          notas: string | null
          receptor_nombre: string | null
          receptor_rut: string | null
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
          id?: string
          iva?: number | null
          moneda_origen?: string | null
          monto_moneda_origen?: number | null
          monto_neto?: number | null
          movimiento_id: string
          notas?: string | null
          receptor_nombre?: string | null
          receptor_rut?: string | null
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
          id?: string
          iva?: number | null
          moneda_origen?: string | null
          monto_moneda_origen?: number | null
          monto_neto?: number | null
          movimiento_id?: string
          notas?: string | null
          receptor_nombre?: string | null
          receptor_rut?: string | null
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
      usuarios: {
        Row: {
          created_at: string
          email: string
          empresa_id: string
          id: string
          nombre: string
          rol: string
          vetado: boolean
        }
        Insert: {
          created_at?: string
          email: string
          empresa_id: string
          id: string
          nombre: string
          rol?: string
          vetado?: boolean
        }
        Update: {
          created_at?: string
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
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
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
