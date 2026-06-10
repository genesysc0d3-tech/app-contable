import { NextResponse } from "next/server";
import type { ProveedorEmision } from "@/lib/intermediario/client";
import { siiLocalBackendBlocked, siiLocalBatchBlocked } from "./sii-local";

export function blockUnsupportedBackendProvider(proveedor: ProveedorEmision) {
  if (proveedor === "sii_local") {
    const blocked = siiLocalBackendBlocked();
    return NextResponse.json(
      { ok: false, error: blocked.error, detalle: blocked.detalle },
      { status: blocked.status },
    );
  }

  if (proveedor === "simpleapi") {
    return NextResponse.json(
      { ok: false, error: "SIMPLEAPI_PENDIENTE", detalle: "SimpleAPI esta configurado, pero este flujo aun no recibe PFX/CAF desde la boveda local." },
      { status: 501 },
    );
  }

  return null;
}

export function batchBlockedResult(proveedor: ProveedorEmision, propuestaId: string) {
  if (proveedor === "sii_local") {
    return siiLocalBatchBlocked(propuestaId);
  }

  if (proveedor === "simpleapi") {
    return {
      propuesta_id: propuestaId,
      ok: false,
      error_code: "SIMPLEAPI_PENDIENTE",
      error_message: "SimpleAPI esta configurado, pero este flujo aun no recibe PFX/CAF desde la boveda local.",
    };
  }

  return null;
}
