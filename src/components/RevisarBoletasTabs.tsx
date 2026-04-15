"use client";

import { useState } from "react";
import { CheckSquare, Receipt } from "@phosphor-icons/react";

interface RevisarBoletasTabsProps {
  revisarContent: React.ReactNode;
  boletasContent: React.ReactNode;
  revisarHint: string;
}

type Tab = "revisar" | "boletas";

export default function RevisarBoletasTabs({
  revisarContent,
  boletasContent,
  revisarHint,
}: RevisarBoletasTabsProps) {
  const [tab, setTab] = useState<Tab>("revisar");

  const tabs: { id: Tab; label: string; hint: string; Icon: typeof CheckSquare }[] = [
    { id: "revisar", label: "Revisar", hint: revisarHint, Icon: CheckSquare },
    { id: "boletas", label: "Boletas", hint: "Emitidas al SII", Icon: Receipt },
  ];
  const active = tabs.find((t) => t.id === tab)!;

  return (
    <section className="neo rounded-[28px] overflow-hidden relative panel-hover-glow is-spotlight flex flex-col">
      <header className="flex items-center gap-3 px-5 py-3.5 border-b border-black/5 dark:border-white/5 shrink-0">
        <div className="w-9 h-9 rounded-xl bg-[#E8553E] text-white flex items-center justify-center shadow-[0_6px_24px_-6px_rgba(232,85,62,0.6)] transition-all duration-300">
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

        {/* Tabs a la derecha — discretos como pills */}
        <div className="flex items-center gap-1 shrink-0">
          {tabs.map((t) => {
            const isActive = t.id === tab;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-[#E8553E]/40 ${
                  isActive
                    ? "bg-[#E8553E] text-white shadow-[0_1px_3px_rgba(232,85,62,0.3)]"
                    : "text-[var(--muted)] hover:text-[var(--foreground)] hover:bg-black/[0.03] dark:hover:bg-white/[0.04]"
                }`}
              >
                <t.Icon size={12} weight="bold" />
                <span className="hidden sm:inline">{t.label}</span>
              </button>
            );
          })}
        </div>
      </header>

      <div className="flex-1 min-h-0 pb-3">
        <div className={tab === "revisar" ? "block" : "hidden"}>{revisarContent}</div>
        <div className={tab === "boletas" ? "block" : "hidden"}>{boletasContent}</div>
      </div>
    </section>
  );
}
