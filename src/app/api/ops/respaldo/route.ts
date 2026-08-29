/**
 * El respaldo nocturno avisa acá si anduvo.
 *
 * El volcado corre en una máquina de la casa, no en Vercel, así que la app no
 * tiene forma de saber si ocurrió: se entera solo si se lo cuentan. Esta ruta
 * es ese aviso, y lo único que hace es dejar un evento en `ops_events` para que
 * el panel pueda decir "anoche sí" o "van dos días sin respaldo".
 *
 * REGLA DE LO QUE NO ENTRA (a propósito, y por eso los campos están
 * enumerados uno por uno): acá NO se acepta ni se guarda dónde vive el
 * respaldo, en qué proveedor, bajo qué ruta, con qué credenciales ni desde qué
 * host. El panel es god-mode pero sigue siendo una página web, y una captura
 * de pantalla que se filtre no puede ser el mapa al tesoro. Saber que el
 * respaldo anda no exige saber dónde está.
 *
 * Lo que sí importa y sí viaja: si terminó bien, y si la copia se RESTAURÓ y se
 * verificó — un volcado que nunca se restauró es un archivo, no un respaldo.
 */
import { NextResponse } from "next/server";
import { recordOpsEvent } from "@/lib/ops/events";

export const dynamic = "force-dynamic";

function autorizado(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const auth = req.headers.get("authorization") ?? "";
  return auth === `Bearer ${secret}`;
}

export async function POST(req: Request) {
  if (!autorizado(req)) {
    return NextResponse.json({ ok: false, error: "NO_AUTORIZADO" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "JSON_INVALIDO" }, { status: 400 });
  }

  const b = (body ?? {}) as Record<string, unknown>;
  const ok = b.ok === true;
  const verificado = b.verificado === true;
  // El motivo del fallo lo escribe nuestro propio guión, pero igual se recorta:
  // nada de volcar la cola de un log entero en la base.
  const motivo = typeof b.motivo === "string" ? b.motivo.slice(0, 200) : null;
  const tablas = Number.isFinite(Number(b.tablas)) ? Math.trunc(Number(b.tablas)) : null;

  const severity = ok && verificado ? "info" : ok ? "warn" : "error";
  const summary = ok
    ? verificado
      ? `Respaldo local del día: hecho y verificado restaurándolo${tablas ? ` (${tablas} tablas cotejadas)` : ""}`
      : "Respaldo local del día: hecho, pero NO se verificó restaurándolo"
    : `Respaldo local del día: FALLÓ${motivo ? ` — ${motivo}` : ""}`;

  await recordOpsEvent({
    severity,
    source: "ops/cron",
    eventName: "respaldo_nocturno",
    summary,
    // Solo banderas y un conteo. Ninguna ruta, ningún proveedor, ningún host.
    metadata: { ok, verificado, tablas },
  });

  return NextResponse.json({ ok: true });
}
