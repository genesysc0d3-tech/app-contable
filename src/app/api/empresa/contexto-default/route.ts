/**
 * Guarda el contexto que el dueño quiere reusar en sus próximas cartolas
 * ("usar esto también en mis próximas cartolas").
 *
 * Es una preferencia, no un dato crítico: si falla, la subida sigue igual — el
 * contexto de ESTA cartola ya viajó con el archivo.
 */

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { cuentaIdDeEmpresa, esTitularDeCuenta } from "@/lib/entitlements";
import { MAX_CONTEXTO_CHARS } from "@/lib/upload/process-upload-validation";

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth?.user) return NextResponse.json({ error: "NO_AUTORIZADO" }, { status: 401 });

  const { data: usuario } = await supabase
    .from("usuarios")
    .select("empresa_id")
    .eq("id", auth.user.id)
    .maybeSingle();
  if (!usuario?.empresa_id) return NextResponse.json({ error: "SIN_EMPRESA" }, { status: 400 });
  // Solo el titular de la cuenta configura la empresa (fundador 2026-09-08). Fail closed.
  {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) return NextResponse.json({ error: "BACKEND_MAL_CONFIGURADO" }, { status: 500 });
    const svc = createServiceClient(url, key);
    const cuentaId = await cuentaIdDeEmpresa(svc, usuario.empresa_id);
    if (!cuentaId || !(await esTitularDeCuenta(svc, cuentaId, auth.user.id))) {
      return NextResponse.json({ error: "SOLO_TITULAR" }, { status: 403 });
    }
  }

  let body: { contexto?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON_INVALIDO" }, { status: 400 });
  }

  // Se recorta en vez de rechazar: es una preferencia opcional, no vale la pena
  // devolver un error por un texto largo. Vacío = quitar el default.
  const crudo = typeof body.contexto === "string" ? body.contexto : "";
  const contexto = crudo.replace(/\s+/g, " ").trim().slice(0, MAX_CONTEXTO_CHARS) || null;

  const { error } = await supabase
    .from("empresas")
    .update({ contexto_usuario_default: contexto })
    .eq("id", usuario.empresa_id);
  if (error) return NextResponse.json({ error: "NO_SE_PUDO_GUARDAR" }, { status: 500 });

  return NextResponse.json({ ok: true });
}
