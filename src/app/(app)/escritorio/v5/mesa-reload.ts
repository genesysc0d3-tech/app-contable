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

// "Doc pendiente de abrir": cuando desde Emitir se aprieta una tx en Por
// revisar/Bloqueadas, se deja acá el id del documento; MesaController cambia a
// Check (y navega el mes si hace falta) y MesaTab lo selecciona al aparecer en
// la mesa. Singleton simple porque los tabs no comparten árbol React.
export const pendingOpenDoc: { id: string | null } = { id: null };
