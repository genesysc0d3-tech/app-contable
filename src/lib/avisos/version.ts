// Versión de ESTA pestaña para los avisos "novedades de esta versión".
// OJO: process.env.NEXT_PUBLIC_* se lee LITERAL (Next lo inyecta en el build).
import { versionDelCliente } from "@/lib/actualizacion/version";
import type { VersionPestana } from "./reglas";

/** Fecha ISO del commit de este build (next.config → NEXT_PUBLIC_APP_COMMIT_AT). Server y cliente. */
export function fechaDeCommit(): string | null {
  return process.env.NEXT_PUBLIC_APP_COMMIT_AT || null;
}

export function versionPestana(): VersionPestana {
  return { version: versionDelCliente(), fechaCommit: fechaDeCommit() };
}
