"use client";

import { useState } from "react";
import { UploadSimple, Receipt } from "@phosphor-icons/react";

interface CapturarBoletasTabsProps {
  children: React.ReactNode; // SubirClient content (RSC passed as child)
  boletasContent: React.ReactNode;
}

type Tab = "capturar" | "boletas";

export default function CapturarBoletasTabs({ children, boletasContent }: CapturarBoletasTabsProps) {
  const [tab, setTab] = useState<Tab>("capturar");

  const tabs: { id: Tab; label: string; hint: string; Icon: typeof UploadSimple }[] = [
    { id: "capturar", label: "Capturar", hint: "Arrastrá una cartola", Icon: UploadSimple },
    { id: "boletas", label: "Boletas", hint: "Emitidas al SII", Icon: Receipt },
  ];
  const active = tabs.find((t) => t.id === tab)!;

  return (
    <section className="neo rounded-[28px] overflow-hidden panel-hover-glow flex flex-col">
      <header className="flex items-center gap-3 px-5 py-3.5 border-b border-black/5 dark:border-white/5 shrink-0">
        <div className="w-9 h-9 rounded-xl neo-inset flex items-center justify-center text-[var(--muted)] transition-all duration-300">
          <active.Icon size={16} weight="bold" />
        </div>
        <div className="flex-1 min-w-0">
          <h2 className="text-[16px] font-medium tracking-tight text-[var(--foreground)] leading-none">
            {active.label}
          </h2>
          <p className="text-[11px] text-[var(--muted-light)] mt-1 leading-none tracking-wide">
            {active.hint}
          </p>
        </div>
      </header>

      {/* Tab strip */}
      <div className="flex gap-1 px-3 pt-3">
        {tabs.map((t) => {
          const isActive = t.id === tab;
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-lg text-[11px] font-semibold transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-[#E8553E]/40 ${
                isActive
                  ? "bg-[#E8553E] text-white shadow-[0_1px_3px_rgba(232,85,62,0.3)]"
                  : "bg-transparent text-[var(--muted)] hover:text-[var(--foreground)] hover:bg-black/[0.03] dark:hover:bg-white/[0.04]"
              }`}
            >
              <t.Icon size={12} weight="bold" />
              {t.label}
            </button>
          );
        })}
      </div>

      {/* Content */}
      <div className="flex-1 min-h-0">
        <div className={tab === "capturar" ? "block" : "hidden"}>
          {children}
        </div>
        <div className={tab === "boletas" ? "block" : "hidden"}>
          {boletasContent}
        </div>
      </div>
    </section>
  );
}
