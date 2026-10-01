// Versión de ESTA pestaña para los avisos "novedades de esta versión".
// OJO: process.env.NEXT_PUBLIC_* se lee LITERAL (Next lo inyecta en el build).
import { versionDelCliente } from "@/lib/actualizacion/version";
import type { VersionPestana } from "./reglas";

/** Fecha ISO del build (next.config → NEXT_PUBLIC_APP_BUILD_AT). Server y cliente. */
export function fechaDeBuild(): string | null {
  return process.env.NEXT_PUBLIC_APP_BUILD_AT || null;
}

export function versionPestana(): VersionPestana {
  return { version: versionDelCliente(), builtAt: fechaDeBuild() };
}
