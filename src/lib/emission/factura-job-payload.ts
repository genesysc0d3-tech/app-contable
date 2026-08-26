// Fuente ÚNICA del payload de la factura que la extensión emite en el
// Sistema de Facturación Gratuito del SII (carril sii_local, tipos 33/34).
//
// Espejo de boleta-job-payload.ts con las diferencias del portal de facturas
// (docs/facturas-portal-sii-flujo.md + tutorial con capturas de Matías):
// - El formulario es HTML clásico: receptor completo (RUT en dos cajas,
//   razón social, giro, dirección, comuna, ciudad), detalle con Nombre
//   Producto (~40 chars) + checkbox "Descrip." para glosa extendida,
//   Forma de Pago Contado/Crédito, y Firmar pide la CLAVE DEL CERTIFICADO.
// - En AFECTA (33) el campo Precio recibe el NETO y el portal calcula IVA y
//   total; en EXENTA (34) recibe el bruto. La matemática vive en
//   derivarMontosFactura (src/lib/facturas/plantilla.ts) — acá NO se duplica.
// - `totales` viaja SOLO como verificación cruzada: antes de Firmar el worker
//   compara el Total que muestra el portal (±$1 de redondeo) y aborta con
//   TOTAL_MISMATCH si difiere.
//
// Decisiones de la espec de Matías (docs/facturas-criterios-matias-2026-08-24.md):
// - forma_pago es OBLIGATORIA y sin default: el caller la trae elegida.
// - Receptor completo obligatorio (razón social, giro, dirección, comuna);
//   solo email/ciudad/contacto son opcionales.
// - Cero juicio tributario: este módulo arma el documento pedido, no opina.
//
// Puro y sin efectos; lanza Error con código legible ante input incompleto
// (fail-closed: un job de factura a medias jamás sale hacia la extensión).

import { derivarMontosFactura } from "../facturas/plantilla";

/**
 * URL de arranque del portal de facturas — VERIFICADA EN VIVO 2026-08-26
 * (docs/facturas-portal-page-map.md): mipeLaunchPage lleva el tipo DTE en
 * OPCION y redirige solo (selector de empresa si falta elegirla, formulario
 * mipeGenFacEx si ya está). Viaja EN EL JOB a propósito: un cambio de URL
 * del SII se corrige con deploy de la app, sin pasar por Chrome Web Store.
 */
export function facturaPortalStartUrl(tipoDte: 33 | 34): string {
  return `https://www1.sii.cl/cgi-bin/Portal001/mipeLaunchPage.cgi?OPCION=${tipoDte}&TIPO=4`;
}

/** Tope visible del campo "Nombre Producto" del portal (~40-50; usamos 40). */
export const FACTURA_NOMBRE_PRODUCTO_MAX = 40;

export interface FacturaReceptorInput {
  rut: string;
  razonSocial: string;
  giro?: string | null;
  direccion: string;
  comuna: string;
  ciudad?: string | null;
  email?: string | null;
  contacto?: string | null;
}

export interface FacturaJobInput {
  empresaId: string;
  /** RUT del emisor esperado — OBLIGATORIO siempre, también en learn (fail-closed). */
  emisorRut: string;
  tipoDte: 33 | 34;
  /** VALOR TOTAL del documento (criterio 4 de Matías). Neto/IVA se derivan. */
  totalClp: number;
  fechaEmision: string; // "YYYY-MM-DD"
  /** Obligatoria y sin default (criterio 7): el caller la trae ya elegida. */
  formaPago: "contado" | "credito";
  receptor: FacturaReceptorInput;
  /** Qué se factura. ≤40 va a Nombre Producto; si excede, entero a Descrip. */
  detalle: string;
  /** Única: true (cierra sesión + ventana). Lote: false (encadena facturas). */
  logoutAfter: boolean;
  /** Modo aprender: navega y mapea sin emitir. */
  learnOnly?: boolean;
  jobId?: string;
  expiresAt?: string;
}

export interface FacturaJob {
  kind: "factura";
  empresa_id: string;
  emisor_rut: string;
  tipo_dte: 33 | 34;
  fecha_emision: string;
  forma_pago: "contado" | "credito";
  receptor: {
    rut: string;
    razon_social: string;
    giro?: string;
    direccion: string;
    comuna: string;
    /** Siempre presente: dato del caller o fallback a la comuna (el portal la exige). */
    ciudad: string;
    email?: string;
    contacto?: string;
    tipo_compra: "del_giro";
  };
  detalles: {
    nombre: string;
    descripcion?: string;
    cantidad: number;
    /** 33: NETO unitario (el portal calcula IVA y total). 34: bruto. */
    precio: number;
  }[];
  /** Solo verificación cruzada contra el Total del portal antes de Firmar. */
  totales: { monto_total: number; monto_neto: number; iva: number; monto_exento: number };
  requires_cert_password: true;
  start_url: string;
  learn_only: boolean;
  auto_emit: boolean;
  allow_final_emit: boolean;
  logout_after: boolean;
  job_id?: string;
  expires_at?: string;
}

function clean(value: string | null | undefined): string | undefined {
  const t = (value ?? "").trim();
  return t.length > 0 ? t : undefined;
}

function required(value: string | null | undefined, codigo: string): string {
  const t = clean(value);
  if (!t) throw new Error(codigo);
  return t;
}

export function buildFacturaJob(input: FacturaJobInput): FacturaJob {
  // Fail-closed: nada de esto es negociable ni tiene default silencioso.
  const emisorRut = required(input.emisorRut, "FACTURA_SIN_EMISOR_RUT");
  if (input.tipoDte !== 33 && input.tipoDte !== 34) throw new Error("FACTURA_TIPO_DTE_INVALIDO");
  if (input.formaPago !== "contado" && input.formaPago !== "credito") {
    throw new Error("FACTURA_SIN_FORMA_PAGO");
  }
  const total = Math.round(input.totalClp);
  if (!Number.isFinite(total) || total <= 0) throw new Error("FACTURA_TOTAL_INVALIDO");
  const detalle = required(input.detalle, "FACTURA_SIN_DETALLE");

  const receptorRut = required(input.receptor.rut, "FACTURA_RECEPTOR_SIN_RUT");
  const razonSocial = required(input.receptor.razonSocial, "FACTURA_RECEPTOR_SIN_RAZON_SOCIAL");
  const direccion = required(input.receptor.direccion, "FACTURA_RECEPTOR_SIN_DIRECCION");
  const comuna = required(input.receptor.comuna, "FACTURA_RECEPTOR_SIN_COMUNA");
  // Ciudad: el portal la EXIGE y su autocomplete la deja vacía (verificado en
  // vivo — el "bug" de Matías). Si el dato no viene, la comuna es el fallback
  // estándar chileno; el job siempre viaja con ciudad para que el worker no
  // improvise.
  const ciudad = clean(input.receptor.ciudad) ?? comuna;

  // La matemática es UNA (plantilla.ts): 33 desarma el total en neto+IVA con
  // el mismo redondeo que vio el usuario en la revisión; 34 va entero exento.
  const montos = derivarMontosFactura(total, input.tipoDte === 34);
  if (montos.tipoDte !== input.tipoDte) throw new Error("FACTURA_TIPO_DTE_INCONSISTENTE");
  const precio = input.tipoDte === 33 ? montos.neto : total;
  const montoTotal = input.tipoDte === 33 ? montos.neto + montos.iva : total;

  // Nombre Producto acotado; el excedente viaja completo en Descrip.
  const nombre = detalle.slice(0, FACTURA_NOMBRE_PRODUCTO_MAX);
  const descripcion = detalle.length > FACTURA_NOMBRE_PRODUCTO_MAX ? detalle : undefined;

  const learnOnly = input.learnOnly === true;
  const job: FacturaJob = {
    kind: "factura",
    empresa_id: input.empresaId,
    emisor_rut: emisorRut,
    tipo_dte: input.tipoDte,
    fecha_emision: input.fechaEmision,
    forma_pago: input.formaPago,
    receptor: {
      rut: receptorRut,
      razon_social: razonSocial,
      giro: clean(input.receptor.giro),
      direccion,
      comuna,
      ciudad,
      email: clean(input.receptor.email),
      contacto: clean(input.receptor.contacto),
      tipo_compra: "del_giro",
    },
    detalles: [{ nombre, ...(descripcion ? { descripcion } : {}), cantidad: 1, precio }],
    totales: {
      monto_total: montoTotal,
      monto_neto: montos.neto,
      iva: montos.iva,
      monto_exento: montos.exento,
    },
    requires_cert_password: true,
    start_url: facturaPortalStartUrl(input.tipoDte),
    learn_only: learnOnly,
    auto_emit: !learnOnly,
    allow_final_emit: !learnOnly,
    logout_after: input.logoutAfter,
  };
  if (input.jobId) job.job_id = input.jobId;
  if (input.expiresAt) job.expires_at = input.expiresAt;
  return job;
}
