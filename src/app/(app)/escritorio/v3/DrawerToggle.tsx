"use client";

import { useState } from "react";
import { Gear, Buildings, Users, X } from "@phosphor-icons/react";
import CartolaMapperDragDrop from "@/components/mapping/CartolaMapperDragDrop";

export default function DrawerToggle({ empresaId }: { empresaId: string }) {
  const [drawer, setDrawer] = useState<"config" | "mapeo" | "clientes" | null>(null);

  return (
    <>
      <div className="flex items-center gap-1">
        <button onClick={() => setDrawer("config")}
          className="p-1.5 rounded-lg text-[var(--muted)] hover:text-[var(--foreground)] hover:bg-[var(--surface)] transition-colors"
          title="Empresa">
          <Buildings size={14} />
        </button>
        <button onClick={() => setDrawer("mapeo")}
          className="p-1.5 rounded-lg text-[var(--muted)] hover:text-[var(--foreground)] hover:bg-[var(--surface)] transition-colors"
          title="Mapear cartola">
          <Gear size={14} />
        </button>
      </div>

      {/* Drawer backdrop */}
      {drawer && (
        <div className="fixed inset-0 z-40 bg-black/30 backdrop-blur-sm animate-fade-in"
          onClick={() => setDrawer(null)} />
      )}

      {/* Drawer panel */}
      <div className={`fixed top-0 right-0 z-50 h-full w-full max-w-sm bg-white dark:bg-[#0a0a0a] border-l border-[var(--border)] shadow-2xl transition-transform duration-300 ${drawer ? "translate-x-0" : "translate-x-full"}`}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border)]">
          <h2 className="text-sm font-semibold">
            {drawer === "config" ? "Empresa" : drawer === "mapeo" ? "Mapear cartola" : "Clientes"}
          </h2>
          <button onClick={() => setDrawer(null)} className="p-1 text-[var(--muted)] hover:text-[var(--foreground)]">
            <X size={16} />
          </button>
        </div>
        <div className="overflow-y-auto h-[calc(100%-48px)] p-4">
          {drawer === "mapeo" && (
            <CartolaMapperDragDrop empresaId={empresaId} onClose={() => setDrawer(null)} onSaved={() => setDrawer(null)} />
          )}
          {drawer === "config" && (
            <div className="space-y-3 text-[11px] text-[var(--muted-light)]">
              <p>Configuración de empresa disponible en la sección Empresa.</p>
              <a href="/empresa" className="text-[#E8553E] hover:underline font-medium">Ir a Empresa →</a>
            </div>
          )}
          {drawer === "clientes" && (
            <div className="space-y-3 text-[11px] text-[var(--muted-light)]">
              <p>Gestión de clientes disponible en la sección Clientes.</p>
              <a href="/clientes" className="text-[#E8553E] hover:underline font-medium">Ir a Clientes →</a>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
