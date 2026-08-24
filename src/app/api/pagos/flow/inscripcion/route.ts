import { NextResponse } from "next/server";
import { activarSuscripcionFlow, confirmarInscripcion } from "@/lib/pagos/flow";
import { recordOpsError } from "@/lib/ops/events";

/**
 * Vuelta del pagador después de inscribir su tarjeta en Flow.
 *
 * Flow manda un POST con un `token` y NADA más — el token no dice si la
 * inscripción resultó. El veredicto se le pregunta a Flow server-to-server
 * (customer/getRegisterStatus), igual que con los webhooks de la pasarela
 * anterior: lo que llega solo aporta el identificador, jamás el resultado.
 *
 * Esta ruta es pública a propósito (la llama Flow, no un usuario con sesión),
 * y por eso no confía en nada de lo que recibe: un token inventado simplemente
 * no existe en Flow y no cambia ninguna fila.
 *
 * Siempre redirige a la app en vez de responder JSON: al otro lado hay una
 * persona mirando el navegador, no un programa.
 */
const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://app.massdte.cl";

async function procesar(token: string | null) {
  if (!token) return NextResponse.redirect(`${APP_URL}/planes?tarjeta=error`, { status: 303 });

  const res = await confirmarInscripcion(token);
  if (!res.ok) {
    if (res.error !== "INSCRIPCION_RECHAZADA") {
      await recordOpsError({
        source: "pagos/flow",
        eventName: "flow_inscripcion_error",
        summary: "No se pudo confirmar la inscripción de tarjeta en Flow",
        error: res.detalle ?? res.error,
      });
    }
    return NextResponse.redirect(`${APP_URL}/planes?tarjeta=rechazada`, { status: 303 });
  }
  // Tarjeta inscrita ≠ plan contratado: el primer cobro se hace acá, y el plan
  // se enciende SOLO si Flow lo aprueba. Si la tarjeta rebota el cliente vuelve
  // con la tarjeta guardada pero sin plan, que es lo correcto: nunca se activa
  // contra una promesa de pago.
  const activacion = await activarSuscripcionFlow(res.cuentaId ?? "");
  if (!activacion.ok) {
    if (activacion.error === "SIN_SUSCRIPCION_PENDIENTE") {
      // Inscribió la tarjeta sin haber elegido plan (o ya se activó antes, si
      // recargó la pestaña). No es un error: la tarjeta quedó guardada.
      return NextResponse.redirect(`${APP_URL}/planes?tarjeta=ok`, { status: 303 });
    }
    await recordOpsError({
      source: "pagos/flow",
      eventName: "flow_primer_cobro_fallido",
      summary: "La tarjeta se inscribió pero el primer cobro no pasó",
      cuentaId: res.cuentaId ?? undefined,
      error: activacion.detalle ?? activacion.error,
    });
    return NextResponse.redirect(`${APP_URL}/planes?cobro=rechazado`, { status: 303 });
  }

  return NextResponse.redirect(`${APP_URL}/massdte?plan=activo`, { status: 303 });
}

export async function POST(request: Request) {
  const form = await request.formData().catch(() => null);
  const token = form ? String(form.get("token") ?? "") || null : null;
  // Flow documenta POST, pero manda el token por query en algunos flujos.
  const enQuery = new URL(request.url).searchParams.get("token");
  return procesar(token ?? enQuery);
}

/** Si el pagador llega por GET (recarga la pestaña, vuelve atrás), no se rompe. */
export async function GET(request: Request) {
  return procesar(new URL(request.url).searchParams.get("token"));
}
