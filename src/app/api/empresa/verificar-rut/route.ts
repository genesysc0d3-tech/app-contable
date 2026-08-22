import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { downloadFromR2, isR2Configured } from "@/lib/r2";
import { validarRut } from "@/lib/rut";
import { enforceRateLimit, rateLimitKey } from "@/lib/security/rate-limit";

/**
 * Verifica un RUT de EMPRESA contra la nómina pública de personas jurídicas
 * del SII (RUT, razón social, término de giro), servida como shards JSON en R2
 * (sii-nomina/v1/{3 primeros dígitos}.json — 3,37M empresas, agosto 2026).
 *
 * Por qué: el RUT se vuelve inmutable tras la primera emisión (trigger
 * empresas_rut_inmutable) — este lookup convierte el momento de escribirlo en
 * una confirmación visual ("¿Es esta tu empresa? RAZÓN SOCIAL") en vez de un
 * campo a ciegas. Un typo con DV válido muestra la razón social de OTRA
 * empresa y se delata solo.
 *
 * "No encontrado" NO bloquea: la nómina tiene rezago de publicación y las
 * empresas recién constituidas no aparecen (AlphaCode SpA, nacida 14-08-2026,
 * no está en la edición de agosto). Solo personas JURÍDICAS: los RUT de
 * persona natural (< ~50M) no están y no deben buscarse en fuentes públicas
 * (Ley 21.719).
 */

export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: "NO_AUTH" }, { status: 401 });

  const limited = enforceRateLimit({
    key: rateLimitKey("verificar-rut", user.id),
    limit: 30,
    windowMs: 60_000,
  });
  if (limited) return limited;

  const url = new URL(request.url);
  const rutRaw = (url.searchParams.get("rut") ?? "").trim();
  const limpio = rutRaw.replace(/[^0-9kK]/g, "").toUpperCase();
  if (limpio.length < 7 || limpio.length > 9) {
    return NextResponse.json({ ok: false, error: "RUT_INVALIDO" }, { status: 400 });
  }
  const cuerpo = limpio.slice(0, -1);
  const dv = limpio.slice(-1);
  if (!validarRut(rutRaw)) {
    return NextResponse.json({ ok: true, dv_valido: false, encontrado: false });
  }

  if (!isR2Configured()) {
    // Sin R2 (dev sin envs): el wizard sigue con solo la validación de DV.
    return NextResponse.json({ ok: true, dv_valido: true, encontrado: false, nomina_disponible: false });
  }

  try {
    const shard = await downloadFromR2(`sii-nomina/v1/${cuerpo.slice(0, 3)}.json`);
    const data = JSON.parse(shard.toString("utf-8")) as Record<string, [string, string, string?]>;
    const hit = data[cuerpo];
    if (!hit) {
      return NextResponse.json({ ok: true, dv_valido: true, encontrado: false, nomina_disponible: true });
    }
    const [dvNomina, razonSocial, terminoGiro] = hit;
    return NextResponse.json({
      ok: true,
      dv_valido: true,
      encontrado: true,
      // DV según el SII (si difiere del ingresado, el RUT tipeado no es esa empresa)
      dv_coincide: dvNomina.toUpperCase() === dv,
      razon_social: razonSocial,
      termino_giro: terminoGiro ?? null,
    });
  } catch {
    // Shard inexistente para ese prefijo (rango sin empresas) o R2 caído: la
    // verificación es un asistente, nunca un bloqueo — degradar con gracia.
    return NextResponse.json({ ok: true, dv_valido: true, encontrado: false, nomina_disponible: false });
  }
}

export const dynamic = "force-dynamic";
