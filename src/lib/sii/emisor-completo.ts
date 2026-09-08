/**
 * ¿El emisor está "bien configurado" para emitir? (fundador 2026-09-08)
 *
 * Mínimo: RUT, razón social y giro. El RUT es lo que la extensión verifica en
 * el portal (fail-closed); razón social y giro salen impresos en los
 * documentos. Dirección y comuna NO bloquean: el portal del SII ya trae el
 * emisor cargado y acá solo visten el documento personalizado.
 *
 * Con esto la pestaña Emitir no abre la confirmación: manda al wizard, paso
 * Emisor, en la empresa de la mesa. Rige para cuentas nuevas y para empresas
 * agregadas desde el logo o el wizard, boletas y facturas por igual.
 */
export type EmisorMinimo = {
  rut?: string | null;
  razon_social?: string | null;
  giro?: string | null;
};

export type CampoEmisor = "RUT" | "razón social" | "giro";

export function faltanDelEmisor(e: EmisorMinimo | null | undefined): CampoEmisor[] {
  const faltan: CampoEmisor[] = [];
  if (!(e?.rut ?? "").trim()) faltan.push("RUT");
  if (!(e?.razon_social ?? "").trim()) faltan.push("razón social");
  if (!(e?.giro ?? "").trim()) faltan.push("giro");
  return faltan;
}

export function emisorCompleto(e: EmisorMinimo | null | undefined): boolean {
  return faltanDelEmisor(e).length === 0;
}

/** Copy humano: "Falta el giro del emisor" / "Faltan el RUT y el giro del emisor". */
export function mensajeEmisorIncompleto(faltan: CampoEmisor[]): string {
  if (faltan.length === 0) return "";
  const lista = faltan.length === 1 ? faltan[0] : `${faltan.slice(0, -1).join(", ")} y ${faltan[faltan.length - 1]}`;
  return `${faltan.length === 1 ? "Falta" : "Faltan"} ${faltan.length === 1 ? "el" : "el"} ${lista} del emisor. Configúralo antes de emitir.`;
}
