import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { listarEmpresasSelector } from "@/app/(app)/escritorio/v5/actions";

/**
 * PUERTA DE LA FAMILIA mass: "¿quién es esta sesión y qué empresas tiene?"
 *
 * massCrypto (repo y Supabase propios, servido en app.massdte.cl/masscrypto) NO
 * tiene usuarios ni empresas: le PREGUNTA a massDTE con la misma cookie de sesión
 * (mismo dominio) y cuelga su libro de la empresa massDTE (mismo id). Una cuenta
 * massDTE = su propio massCrypto. Si acá no hay empresa configurada, massCrypto
 * no abre y manda a configurarla en massDTE.
 *
 * Solo lectura, sin cache, misma autorización que el selector de empresas (la
 * sesión decide; no se puede pedir otra cuenta). Fuera del middleware de sesión
 * (ver proxy.ts) para responder 401 en JSON en vez de un redirect a login.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return respuesta({ ok: false, error: "NO_AUTH" }, 401);

  const r = await listarEmpresasSelector();
  if (!r.ok) return respuesta({ ok: false, error: r.error }, r.error === "NO_AUTH" ? 401 : 403);

  const activa = r.empresas.find((e) => e.activaActual) ?? r.empresas[0] ?? null;
  // Id de la cuenta (para que massCrypto espeje la MISMA cuenta, no una por empresa).
  let cuentaId: string | null = null, plan: string | null = null;
  if (activa) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (url && key) {
      const sb = createServiceClient(url, key);
      const { data: ce } = await sb.from("cuenta_empresas").select("cuenta_id").eq("empresa_id", activa.id).maybeSingle();
      cuentaId = ce?.cuenta_id ?? null;
      if (cuentaId) { const { data: c } = await sb.from("cuentas").select("plan_codigo").eq("id", cuentaId).maybeSingle(); plan = c?.plan_codigo ?? null; }
    }
  }
  return respuesta({
    ok: true,
    usuario: { id: user.id, email: user.email ?? null },
    cuenta: { id: cuentaId, nombre: r.cuentaActualNombre, plan, multiempresa: r.multiempresa, enCuentaAjena: r.enCuentaAjena },
    empresaActiva: activa?.id ?? null,
    // Configurada = hay una empresa con RUT (el emisor de massDTE está hecho).
    configurada: !!activa?.rut,
    empresas: r.empresas.map(({ id, nombre, rut, activaActual, esPrincipal }) => ({ id, nombre, rut, activaActual, esPrincipal })),
  });
}

function respuesta(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "cache-control": "no-store" } });
}
