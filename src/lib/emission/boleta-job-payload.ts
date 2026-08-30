// Fuente ÚNICA del payload de la boleta que la extensión emite en e-Boleta.
//
// Boleta única y el motor masivo arman EXACTAMENTE el mismo job — la única
// diferencia es de dónde salen los datos (formulario en vivo vs propuesta ya
// aprobada) y `logout_after` (única cierra la sesión SII; el lote la deja abierta
// para encadenar). Antes esto vivía inline en EmitirDirectaView.sendLocalSiiJob;
// extraerlo evita que boleta única y el lote se separen con el tiempo.
//
// Puro y sin efectos: recibe datos limpios, devuelve el objeto `job`. Fácil de
// testear y de mantener sincronizado con el contrato de la extensión.

import { BOLETA_LIBRETO, type BoletaLibreto } from "./sii-libreto";

export interface ReceptorInput {
  rut?: string | null;
  razonSocial?: string | null;
  direccion?: string | null;
  comuna?: string | null;
  email?: string | null;
  telefono?: string | null;
}

export interface BoletaJobInput {
  empresaId: string;
  /** RUT del emisor esperado: el worker verifica que el portal lo tenga seleccionado. */
  emisorRut?: string | null;
  tipoDte: 39 | 41;
  /** Monto TOTAL (bruto). El neto/IVA/exento se derivan del tipo. */
  monto: number;
  fechaEmision: string; // "YYYY-MM-DD"
  receptor: ReceptorInput;
  /**
   * Texto que va al detalle de la boleta (máx 80). El caller es responsable de
   * que sea SEGURO: nunca datos de terceros (ver política de glosa, PR #56).
   */
  detalle: string;
  medioPago?: string | null;
  /** Única: true (cierra sesión + ventana). Lote: false (encadena boletas). */
  logoutAfter: boolean;
  jobId?: string;
  expiresAt?: string;
}

export interface BoletaJob {
  empresa_id: string;
  emisor_rut?: string;
  tipo_dte: 39 | 41;
  fecha_emision: string;
  receptor: {
    rut?: string; razon_social?: string; direccion?: string;
    comuna?: string; email?: string; telefono?: string;
  };
  detalles: { nombre: string; cantidad: number; monto_total: number }[];
  totales: { monto_total: number; monto_neto: number; iva: number; monto_exento: number };
  glosa: string;
  /**
   * DOM del portal e-Boleta (selectores Vuetify, textos, esperas) como DATO —
   * un cambio del SII se arregla con deploy, sin Chrome Web Store. El worker lo
   * consume con fallback al hardcode (byte-idéntico). La flota vieja lo ignora.
   * Ver sii-libreto.ts.
   */
  libreto: BoletaLibreto;
  learn_only: false;
  auto_emit: true;
  allow_final_emit: true;
  payment_method?: string;
  confirmation_required: false;
  logout_after: boolean;
  job_id?: string;
  expires_at?: string;
}

function clean(value: string | null | undefined): string | undefined {
  const t = (value ?? "").trim();
  return t.length > 0 ? t : undefined;
}

export function buildBoletaJob(input: BoletaJobInput): BoletaJob {
  const total = Math.round(input.monto);
  // Afecta (39): el total viene con IVA incluido → se desarma. Exenta (41): todo exento.
  const neto = input.tipoDte === 39 ? Math.round(total / 1.19) : 0;
  const iva = input.tipoDte === 39 ? total - neto : 0;
  const exento = input.tipoDte === 41 ? total : 0;
  const glosa = (input.detalle ?? "").trim().slice(0, 80);

  const job: BoletaJob = {
    empresa_id: input.empresaId,
    emisor_rut: clean(input.emisorRut),
    tipo_dte: input.tipoDte,
    fecha_emision: input.fechaEmision,
    receptor: {
      rut: clean(input.receptor.rut),
      razon_social: clean(input.receptor.razonSocial),
      direccion: clean(input.receptor.direccion),
      comuna: clean(input.receptor.comuna),
      email: clean(input.receptor.email),
      telefono: clean(input.receptor.telefono),
    },
    detalles: [{ nombre: glosa, cantidad: 1, monto_total: total }],
    totales: { monto_total: total, monto_neto: neto, iva, monto_exento: exento },
    glosa,
    libreto: BOLETA_LIBRETO,
    learn_only: false,
    auto_emit: true,
    allow_final_emit: true,
    payment_method: clean(input.medioPago),
    confirmation_required: false,
    logout_after: input.logoutAfter,
  };
  if (input.jobId) job.job_id = input.jobId;
  if (input.expiresAt) job.expires_at = input.expiresAt;
  return job;
}
