"use client";

import { createContext, useContext, type ReactNode } from "react";
import { EXTENSION_VERSION_MINIMA } from "@/lib/extension";

/**
 * La versión de la extensión DISPONIBLE (viva en la tienda), derivada de la
 * telemetría en el server y repartida al árbol client. Reemplaza a la constante
 * hardcodeada `EXTENSION_VERSION_ACTUAL` como fuente del aviso "hay versión nueva"
 * (esa constante puede estar en revisión). Ver [[project_extension_version_disponible]].
 *
 * Default = PISO: si un componente se monta fuera del provider, sub-anuncia
 * (seguro) en vez de mostrar un nag falso.
 */
const VersionDisponibleContext = createContext<string>(EXTENSION_VERSION_MINIMA);

export function VersionDisponibleProvider({
  value,
  children,
}: {
  value: string;
  children: ReactNode;
}) {
  return (
    <VersionDisponibleContext.Provider value={value}>
      {children}
    </VersionDisponibleContext.Provider>
  );
}

export function useVersionDisponible(): string {
  return useContext(VersionDisponibleContext);
}
