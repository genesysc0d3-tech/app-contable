/**
 * Correo transaccional de la app vía Resend (no-reply@massdte.cl).
 *
 * Aparte del SMTP de Supabase a propósito: aquel es solo para los correos de
 * Auth (registro, clave); esto es para los que manda el PRODUCTO (plan
 * contratado, avisos internos).
 *
 * Fail-open SIEMPRE: un correo caído jamás puede romper el flujo que lo
 * origina — cobrar y no avisar es recuperable, no cobrar por culpa del aviso
 * no. Por eso ninguna función lanza: devuelven ok/false y el que llama decide
 * si lo registra.
 */

const REMITENTE = "MassDTE <no-reply@massdte.cl>";
/** Buzón interno de plata (alias → massdte.chile@gmail.com con su filtro). */
export const CORREO_COBROS = "cobros@massdte.cl";

function resendKey(): string | null {
  const k = process.env.RESEND_API_KEY?.trim();
  return k ? k : null;
}

export async function enviarCorreo(args: {
  para: string;
  asunto: string;
  html: string;
}): Promise<{ ok: boolean; detalle?: string }> {
  const key = resendKey();
  if (!key) return { ok: false, detalle: "RESEND_API_KEY no configurada" };
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: REMITENTE, to: [args.para], subject: args.asunto, html: args.html }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return { ok: false, detalle: `Resend HTTP ${res.status}` };
    return { ok: true };
  } catch (err) {
    return { ok: false, detalle: err instanceof Error ? err.message : "fetch failed" };
  }
}

const marco = (cuerpo: string) => `
<div style="font-family:-apple-system,system-ui,sans-serif;max-width:520px;margin:0 auto;padding:28px 20px;color:#1a1a1a">
  <div style="font-size:19px;font-weight:800;letter-spacing:-.02em;margin-bottom:18px">mass<span style="color:#E8553E">DTE</span></div>
  ${cuerpo}
  <p style="font-size:11px;color:#999;margin-top:26px;border-top:1px solid #eee;padding-top:12px">
    MassDTE · AlphaCode SpA · <a href="https://massdte.cl" style="color:#999">massdte.cl</a><br>
    ¿Dudas? Escríbenos a <a href="mailto:soporte@massdte.cl" style="color:#E8553E">soporte@massdte.cl</a>
  </p>
</div>`;

const clp = (n: number) => "$" + n.toLocaleString("es-CL");

/** Al cliente: qué contrató, cuánto se le cobró y cuándo viene el próximo. */
export function plantillaPlanContratado(args: {
  planNombre: string;
  montoClp: number;
  hastaFecha: string; // YYYY-MM-DD
}): { asunto: string; html: string } {
  return {
    asunto: `Tu plan ${args.planNombre} está activo`,
    html: marco(`
  <p style="font-size:15px;line-height:1.55">¡Listo! Tu plan <b>${args.planNombre}</b> quedó activo.</p>
  <table style="font-size:13.5px;line-height:1.9;margin:14px 0">
    <tr><td style="color:#777;padding-right:18px">Cobrado hoy</td><td><b>${clp(args.montoClp)}</b> (IVA incluido)</td></tr>
    <tr><td style="color:#777;padding-right:18px">Cubre hasta</td><td>${args.hastaFecha}</td></tr>
    <tr><td style="color:#777;padding-right:18px">Próximo cobro</td><td>automático, al valor de la UF de ese día</td></tr>
  </table>
  <p style="font-size:13px;color:#555;line-height:1.55">El cargo aparece en tu cartola como <b>PAGOS.FLOW.CL</b>.
  Puedes emitir al tiro desde tu escritorio.</p>
  <a href="https://app.massdte.cl/massdte" style="display:inline-block;margin-top:8px;background:#E8553E;color:#fff;text-decoration:none;font-size:13.5px;font-weight:700;padding:11px 22px;border-radius:10px">Ir a mi escritorio</a>`),
  };
}

/**
 * Al cliente: su tarjeta quedó guardada pero el PRIMER cobro rebotó — el plan
 * NO está activo. Sin este correo el cliente queda con señales cruzadas: Flow
 * le confirma la tarjeta por correo y nuestro rechazo vivía solo en un banner
 * (caso real Lc Services 2026-09-01: creyó que tenía el plan).
 */
export function plantillaCobroRechazado(args: {
  planNombre: string;
  montoClp: number;
}): { asunto: string; html: string } {
  return {
    asunto: `Tu pago fue rechazado — el plan ${args.planNombre} aún no está activo`,
    html: marco(`
  <p style="font-size:15px;line-height:1.55">Tu tarjeta quedó registrada correctamente, pero tu banco
  <b>rechazó el cobro</b> de ${clp(args.montoClp)} del plan <b>${args.planNombre}</b>.</p>
  <p style="font-size:14px;line-height:1.55"><b>No se te cobró nada</b> y el plan todavía no está activo.</p>
  <p style="font-size:13.5px;color:#555;line-height:1.6">Suele ser falta de cupo o que la tarjeta tiene
  bloqueadas las compras por internet (se activa en la app de tu banco). Cuando esté resuelto,
  entra a Planes y aprieta el botón de tu plan: el cobro sale al tiro con la tarjeta que ya guardaste.</p>
  <a href="https://app.massdte.cl/planes" style="display:inline-block;margin-top:8px;background:#E8553E;color:#fff;text-decoration:none;font-size:13.5px;font-weight:700;padding:11px 22px;border-radius:10px">Reintentar el pago</a>
  <p style="font-size:12.5px;color:#777;margin-top:14px">¿No era lo que esperabas? Escríbenos a soporte@massdte.cl y lo vemos contigo.</p>`),
  };
}

/** A nosotros: quién contrató qué. Va a cobros@ (es plata, no soporte). */
export function plantillaAvisoContratacion(args: {
  clienteNombre: string;
  clienteEmail: string;
  planNombre: string;
  montoClp: number;
}): { asunto: string; html: string } {
  return {
    asunto: `💰 ${args.clienteNombre} contrató ${args.planNombre} — ${clp(args.montoClp)}`,
    html: marco(`
  <p style="font-size:15px;line-height:1.55"><b>${args.clienteNombre}</b> (${args.clienteEmail})
  contrató el plan <b>${args.planNombre}</b>.</p>
  <p style="font-size:13.5px;color:#555">Cobrado: <b>${clp(args.montoClp)}</b> con IVA, vía Flow (cargo automático).</p>`),
  };
}
