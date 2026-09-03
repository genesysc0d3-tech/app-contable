import { NextRequest, NextResponse } from "next/server";
import { cargarMesa } from "@/app/(app)/escritorio/v5/actions";

// Carga de mesa por HTTP en vez de server action. Motivo (bug "mesa gris
// tildada" 2026-09-02): Next ejecuta las server actions de un mismo cliente EN
// FILA — el precalentador de vistas y los refresh realtime, al viajar como
// actions, dejaban Aprobar/Rechazar esperando detrás de cargas pesadas y la
// mesa quedaba atenuada varios segundos. Los route handlers corren en paralelo
// y no tocan esa fila. La autorización es la misma: cargarMesa resuelve la
// empresa desde la sesión (no se puede pedir otra).
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const res = await cargarMesa({
    date: sp.get("date") ?? undefined,
    month: sp.get("month") ?? undefined,
    view: sp.get("view") ?? undefined,
    mesa: sp.get("mesa") ?? undefined,
  });
  return NextResponse.json(res, {
    status: res.ok ? 200 : res.error === "NO_AUTH" ? 401 : 400,
    headers: { "cache-control": "no-store" },
  });
}
