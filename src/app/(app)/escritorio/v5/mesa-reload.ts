"use client";

import { createContext, useContext } from "react";

// Permite que las acciones profundas (aprobar/rechazar/mapear) refresquen la
// mesa SIN navegar: el MesaController provee `reloadMesa` (re-pide solo los
// datos date-dependientes y hace setMesa). Fuera de la mesa (p.ej. la ruta
// /revisar) el contexto es null y los componentes caen a router.refresh().
export const MesaReloadContext = createContext<(() => void) | null>(null);

export function useMesaReload(): (() => void) | null {
  return useContext(MesaReloadContext);
}
