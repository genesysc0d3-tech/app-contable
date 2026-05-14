"use client";

import { useCallback, Children, isValidElement } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { UploadSimple, CheckSquare, Lightning, Receipt, Building } from "@phosphor-icons/react";

const TAB_ICONS: Record<string, typeof UploadSimple> = {
  subir: UploadSimple, revisar: CheckSquare, emitir: Lightning,
  boletas: Receipt, empresa: Building,
};

export default function TabsV3({ activeTab, children }: {
  activeTab: string; children: React.ReactNode;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const tabs: { id: string; label: string; hint?: string; children: React.ReactNode }[] = [];
  Children.forEach(children, (child) => {
    if (isValidElement(child) && child.type === Tab) {
      tabs.push(child.props as any);
    }
  });

  const switchTab = useCallback((id: string) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("tab", id);
    router.push(`/escritorio/v3?${params.toString()}`, { scroll: false });
  }, [router, searchParams]);

  return (
    <div className="border border-[var(--border)] rounded-xl overflow-hidden bg-white dark:bg-black/20">
      {/* Tab bar */}
      <div className="flex items-center gap-1 px-2 py-2 bg-[var(--surface)] border-b border-[var(--border)] overflow-x-auto no-scrollbar">
        {tabs.map((t) => {
          const isActive = t.id === activeTab;
          const Icon = TAB_ICONS[t.id] || UploadSimple;
          return (
            <button key={t.id} onClick={() => switchTab(t.id)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all whitespace-nowrap ${
                isActive
                  ? "bg-[#E8553E] text-white shadow-sm"
                  : "text-[var(--muted)] hover:text-[var(--foreground)] hover:bg-black/[0.04] dark:hover:bg-white/[0.06]"
              }`}>
              <Icon size={14} weight={isActive ? "fill" : "bold"} />
              <span>{t.label}</span>
              {t.hint && <span className="text-[10px] opacity-60 ml-0.5">· {t.hint}</span>}
            </button>
          );
        })}
      </div>
      {/* Content */}
      <div className="p-4 min-h-[300px]">
        {tabs.map((t) => (
          <div key={t.id} className={t.id === activeTab ? "block" : "hidden"}>
            {t.children}
          </div>
        ))}
      </div>
    </div>
  );
}

export function Tab(_props: { id: string; label: string; hint?: string; children: React.ReactNode }) { return null; }
