"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { UploadSimple, CheckSquare, Buildings } from "@phosphor-icons/react";

const NAV_ITEMS = [
  { href: "/subir", label: "Subir", Icon: UploadSimple },
  { href: "/revisar", label: "Revisar", Icon: CheckSquare, badge: true },
  { href: "/empresa", label: "Empresa", Icon: Buildings },
] as const;

export default function BottomNav({ initialPendientes = 0 }: { initialPendientes?: number }) {
  const pathname = usePathname();
  const [pendientes, setPendientes] = useState(initialPendientes);
  const hidden = pathname.startsWith("/escritorio");

  useEffect(() => {
    async function fetchCount() {
      const { count } = await supabase
        .from("propuestas_ia")
        .select("id", { count: "exact", head: true })
        .eq("estado", "pendiente");
      setPendientes(count ?? 0);
    }

    const channel = supabase
      .channel("nav-propuestas")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "propuestas_ia" },
        () => fetchCount()
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  if (hidden) return null;

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 bg-white dark:bg-[#1c1c1e] shadow-[0_-1px_12px_rgba(0,0,0,0.06)] dark:shadow-none dark:border-t dark:border-white/10">
      <div className="flex justify-around items-center h-[72px] max-w-lg mx-auto px-4">
        {NAV_ITEMS.map((item) => {
          const isActive = pathname.startsWith(item.href);
          const showBadge = "badge" in item && item.badge && pendientes > 0;

          return (
            <Link
              key={item.href}
              href={item.href}
              className={`relative flex flex-col items-center gap-0.5 px-3 py-1 rounded-lg transition-colors ${
                isActive
                  ? "text-[#E8553E]"
                  : "text-[#AAAAAA] dark:text-white/40 hover:text-[#888] dark:hover:text-white/70"
              }`}
            >
              <item.Icon
                size={28}
                weight={isActive ? "fill" : "regular"}
                className={isActive ? "animate-bounce-icon" : ""}
              />
              <span className="text-[10px] font-medium">{item.label}</span>
              {showBadge && (
                <span className="absolute -top-0.5 right-0 min-w-[16px] h-4 flex items-center justify-center rounded-full bg-[#E8553E] text-[9px] font-bold text-white px-1 animate-fade-in">
                  {pendientes >= 100000
                    ? "99k+"
                    : pendientes >= 10000
                    ? `${Math.floor(pendientes / 1000)}k`
                    : pendientes >= 1000
                    ? `${(pendientes / 1000).toFixed(1).replace(/\.0$/, "")}k`
                    : pendientes}
                </span>
              )}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
