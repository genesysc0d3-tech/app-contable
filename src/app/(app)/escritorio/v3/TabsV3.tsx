"use client";

import { useState } from "react";
import { UploadSimple, CheckSquare, Lightning, Receipt, Building } from "@phosphor-icons/react";

const TABS = [
  { id: "subir", label: "Emitir", icon: UploadSimple },
  { id: "revisar", label: "Revisar", icon: CheckSquare },
  { id: "emitir", label: "Emitir", icon: Lightning },
  { id: "boletas", label: "Boletas", icon: Receipt },
  { id: "empresa", label: "Empresa", icon: Building },
];

export default function TabsV3({
  subirContent, revisarContent, emitirContent, boletasContent, empresaContent,
}: {
  subirContent: React.ReactNode;
  revisarContent: React.ReactNode;
  emitirContent: React.ReactNode;
  boletasContent: React.ReactNode;
  empresaContent: React.ReactNode;
}) {
  const [tab, setTab] = useState("revisar");

  return (
    <div className="border border-[var(--border)] rounded-xl overflow-hidden bg-white dark:bg-black/20">
      <div className="flex items-center gap-1 px-2 py-2 bg-[var(--surface)] border-b border-[var(--border)] overflow-x-auto no-scrollbar">
        {TABS.map((t) => {
          const isActive = t.id === tab;
          const Icon = t.icon;
          return (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all whitespace-nowrap cursor-pointer ${
                isActive
                  ? "bg-[#E8553E] text-white shadow-sm"
                  : "text-[var(--muted)] hover:text-[var(--foreground)] hover:bg-black/[0.04] dark:hover:bg-white/[0.06]"
              }`}>
              <Icon size={14} weight={isActive ? "fill" : "bold"} />
              <span>{t.label}</span>
            </button>
          );
        })}
      </div>
      <div className="p-3 min-h-[300px]">
        <div className={tab === "subir" ? "block animate-fade-in" : "hidden"}>{subirContent}</div>
        <div className={tab === "revisar" ? "block animate-fade-in" : "hidden"}>{revisarContent}</div>
        <div className={tab === "emitir" ? "block animate-fade-in" : "hidden"}>{emitirContent}</div>
        <div className={tab === "boletas" ? "block animate-fade-in" : "hidden"}>{boletasContent}</div>
        <div className={tab === "empresa" ? "block animate-fade-in" : "hidden"}>{empresaContent}</div>
      </div>
    </div>
  );
}
