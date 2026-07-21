import { NextResponse } from "next/server";
import { ROLES_EMISION } from "@/lib/auth/roles";
import { createClient as createServiceClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { createClient } from "@/lib/supabase/server";
import { contextoCuentaPorEmpresa, validarAccesoCuenta } from "@/lib/entitlements";
import { getDevSupportMode } from "@/lib/dev/support-mode";

type Sb = SupabaseClient<Database>;


export type AccountGuardResult =
  | {
      ok: true;
      supabase: Sb;
      service: Sb;
      userId: string;
      empresaId: string;
      rol: string;
      cuentaId: string;
      plan: string | null;
    }
  | { ok: false; response: NextResponse };

export async function requireAccountApiAccess(options: {
  requirePlan?: boolean;
  requireEmissionRole?: boolean;
} = {}): Promise<AccountGuardResult> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, response: NextResponse.json({ ok: false, error: "NO_AUTH" }, { status: 401 }) };

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    return { ok: false, response: NextResponse.json({ ok: false, error: "BACKEND_CONFIG_MISSING" }, { status: 500 }) };
  }

  const service = createServiceClient<Database>(url, key);

  const support = await getDevSupportMode();
  if (support?.ok) {
    const cuenta = await contextoCuentaPorEmpresa(support.sb, support.empresaId);
    if (!cuenta) return { ok: false, response: NextResponse.json({ ok: false, error: "EMPRESA_SIN_CUENTA" }, { status: 403 }) };
    if (options.requirePlan && !cuenta.planActivo) {
      return { ok: false, response: NextResponse.json({ ok: false, error: "PLAN_INACTIVO" }, { status: 402 }) };
    }

    return {
      ok: true,
      supabase,
      service: support.sb,
      userId: support.operatorUserId,
      empresaId: support.empresaId,
      rol: "owner",
      cuentaId: cuenta.cuentaId,
      plan: cuenta.plan,
    };
  }

  const { data: usuario, error: usuarioError } = await service
    .from("usuarios")
    .select("id, empresa_id, rol, vetado")
    .eq("id", user.id)
    .maybeSingle();

  if (usuarioError) {
    return { ok: false, response: NextResponse.json({ ok: false, error: "USUARIO_QUERY_FAILED", detalle: usuarioError.message }, { status: 500 }) };
  }
  if (!usuario?.empresa_id) return { ok: false, response: NextResponse.json({ ok: false, error: "USUARIO_SIN_EMPRESA" }, { status: 403 }) };
  if (usuario.vetado) return { ok: false, response: NextResponse.json({ ok: false, error: "USUARIO_BLOQUEADO" }, { status: 403 }) };
  if (options.requireEmissionRole && !ROLES_EMISION.has(String(usuario.rol))) {
    return { ok: false, response: NextResponse.json({ ok: false, error: "ROL_SIN_PERMISO" }, { status: 403 }) };
  }

  const acceso = await validarAccesoCuenta(service, user.id, usuario.empresa_id);
  if (!acceso.ok) return { ok: false, response: NextResponse.json({ ok: false, error: acceso.codigo }, { status: 403 }) };
  if (options.requirePlan && !acceso.planActivo) {
    return { ok: false, response: NextResponse.json({ ok: false, error: "PLAN_INACTIVO" }, { status: 402 }) };
  }

  return {
    ok: true,
    supabase,
    service,
    userId: user.id,
    empresaId: usuario.empresa_id,
    rol: String(usuario.rol),
    cuentaId: acceso.cuentaId,
    plan: acceso.plan,
  };
}
