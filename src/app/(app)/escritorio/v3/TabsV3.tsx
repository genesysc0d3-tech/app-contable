"use client";

import { useState, isValidElement, type ReactNode, type ReactElement } from "react";
import { UploadSimple, CheckSquare, Lightning, Receipt } from "@phosphor-icons/react";

const TABS = [
  { id: "subir", label: "Emitir", icon: UploadSimple },
  { id: "revisar", label: "Revisar", icon: CheckSquare },
  { id: "emitir", label: "Emitir", icon: Lightning },
  { id: "boletas", label: "Boletas", icon: Receipt },
];

interface TabProps { id: string; label: string; children: ReactNode; }

function isTabElement(child: ReactNode): child is ReactElement<TabProps> {
  return isValidElement(child) && (child.type as any)?.displayName === "V3Tab";
}

export default function TabsV3({ children }: { children: ReactNode }) {
  const [tab, setTab] = useState("revisar");

  const contentMap: Record<string, ReactNode> = {};
  const arr = Array.isArray(children) ? children : [children];
  for (const child of arr) {
    if (isTabElement(child)) {
      contentMap[child.props.id] = child.props.children;
    }
  }

  return (
    <div className="border border-[var(--border)] rounded-xl overflow-hidden bg-white dark:bg-black/20">
      <div className="flex items-center gap-1 px-2 py-2 bg-[var(--surface)] border-b border-[var(--border)] overflow-x-auto no-scrollbar">
        {TABS.map((t) => {
          const isActive = t.id === tab;
          const Icon = t.icon;
          return (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all whitespace-nowrap ${
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
      <div className="p-4 min-h-[300px]">
        {Object.entries(contentMap).map(([id, content]) => (
          <div key={id} className={id === tab ? "block" : "hidden"}>{content}</div>
        ))}
      </div>
    </div>
  );
}

export function Tab(_props: TabProps) { return null; }
Tab.displayName = "V3Tab";
