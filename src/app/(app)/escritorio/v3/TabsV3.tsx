"use client";

import { useCallback, Children, isValidElement, type ReactElement, type ComponentType } from "react";
import { useRouter, useSearchParams } from "next/navigation";

interface TabDef {
  id: string;
  label: string;
  icon: ComponentType<any>;
  hint?: string;
  spotlight?: boolean;
  children: React.ReactNode;
}

export default function TabsV3({ activeTab, selectedDate, children }: {
  activeTab: string;
  selectedDate: string | null;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const tabs: TabDef[] = [];
  Children.forEach(children, (child) => {
    if (isValidElement(child) && child.type === Tab) {
      tabs.push(child.props as TabDef);
    }
  });

  const active = tabs.find((t) => t.id === activeTab) ?? tabs[0];

  const switchTab = useCallback((id: string) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("tab", id);
    router.push(`/escritorio/v3?${params.toString()}`, { scroll: false });
  }, [router, searchParams]);

  return (
    <div className="flex flex-col h-full">
      {/* Tab bar */}
      <div className="flex items-center gap-1 px-1 py-1 bg-white/60 dark:bg-white/[0.04] border border-[var(--border)] rounded-t-xl overflow-x-auto no-scrollbar">
        {tabs.map((t) => {
          const isActive = t.id === activeTab;
          const Icon = t.icon;
          return (
            <button key={t.id} onClick={() => switchTab(t.id)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-all whitespace-nowrap focus:outline-none focus-visible:ring-2 focus-visible:ring-[#E8553E]/40 ${
                isActive
                  ? "bg-[#E8553E] text-white shadow-sm"
                  : "text-[var(--muted)] hover:text-[var(--foreground)] hover:bg-black/[0.03] dark:hover:bg-white/[0.04]"
              }`}>
              <Icon size={13} weight={isActive ? "fill" : "bold"} />
              <span>{t.label}</span>
              {t.hint && !isActive && <span className="text-[8px] text-[var(--muted-light)] hidden sm:inline">· {t.hint}</span>}
            </button>
          );
        })}
      </div>

      {/* Content */}
      <div className="flex-1 min-h-0 bg-white dark:bg-black/20 border-x border-b border-[var(--border)] rounded-b-xl p-3">
        {tabs.map((t) => (
          <div key={t.id} className={`h-full ${t.id === activeTab ? "block" : "hidden"}`}>
            {t.children}
          </div>
        ))}
      </div>
    </div>
  );
}

export function Tab(_props: TabDef) {
  return null;
}
