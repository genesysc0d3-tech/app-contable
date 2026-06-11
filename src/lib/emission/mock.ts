import type { SupabaseClient } from "@supabase/supabase-js";
import { generarDTE, generarTED } from "@/lib/sii/dte-xml";
import { asegurarFoliosDisponibles, enviarDTE } from "@/lib/intermediario/client";
import type { BoletaInput } from "@/lib/sii/validation";
import type { Database } from "@/lib/database.types";

type TotalesBoleta = { neto: number; exento: number; iva: number; total: number };

export interface MockEmpresaFiscal {
  rut: string;
  razon_social: string;
  giro: string | null;
  direccion: string | null;
  comuna: string | null;
}

export interface MockIssueInput {
  sb: SupabaseClient<Database>;
  empresaId: string;
  empresa: MockEmpresaFiscal;
  body: Pick<BoletaInput, "tipo_dte" | "receptor_rut" | "receptor_razon_social" | "receptor_direccion" | "receptor_comuna" | "detalles">;
  totales: TotalesBoleta;
  fechaEmision: string;
}

export interface MockIssueSuccess {
  ok: true;
  folio: number;
  cafId: string;
  xmlDte: string;
  ted: string;
  trackId: string;
  estadoPersistencia: "aceptado" | "aceptado_reparos" | "rechazado";
}

export interface MockIssueFailure {
  ok: false;
  error: string;
  status: number;
  codigo_rechazo?: string;
  detalle?: string;
}

export type MockIssueResult = MockIssueSuccess | MockIssueFailure;

export async function issueMockBoleta(input: MockIssueInput): Promise<MockIssueResult> {
  await asegurarFoliosDisponibles(input.empresaId, input.body.tipo_dte);
  const { data: folioRes, error: folioErr } = await input.sb.rpc("consume_next_folio", {
    p_empresa_id: input.empresaId,
    p_tipo_dte: input.body.tipo_dte,
  });

  if (folioErr || !folioRes || folioRes.length === 0) {
    return {
      ok: false,
      error: "SIN_FOLIOS_DISPONIBLES",
      detalle: "El modo de prueba no pudo obtener folios mock disponibles",
      status: 502,
    };
  }

  const folioData = folioRes[0] as { folio: number; caf_id: string };
  const dteArgs = {
    tipo_dte: input.body.tipo_dte,
    folio: folioData.folio,
    fecha_emision: input.fechaEmision,
    emisor: input.empresa,
    receptor: input.body.receptor_rut
      ? {
          rut: input.body.receptor_rut,
          razon_social: input.body.receptor_razon_social,
          direccion: input.body.receptor_direccion,
          comuna: input.body.receptor_comuna,
        }
      : undefined,
    totales: input.totales,
    detalles: input.body.detalles,
  };

  const xmlDte = generarDTE(dteArgs);
  const ted = generarTED(dteArgs);
  const envio = await enviarDTE(xmlDte);
  if (!envio.ok || !envio.track_id || !envio.estado_persistencia) {
    return {
      ok: false,
      error: "SII_MOCK_RECHAZO",
      status: 422,
      codigo_rechazo: envio.codigo_rechazo,
      detalle: envio.detalle ?? envio.mensaje,
    };
  }

  return {
    ok: true,
    folio: folioData.folio,
    cafId: folioData.caf_id,
    xmlDte,
    ted,
    trackId: envio.track_id,
    estadoPersistencia: envio.estado_persistencia,
  };
}
