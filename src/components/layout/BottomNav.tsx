"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

const NAV_ITEMS = [
  { href: "/subir", label: "Subir", icon: "↑" },
  { href: "/revisar", label: "Revisar", icon: "✓", badge: true },
  { href: "/clientes", label: "Clientes", icon: "👤" },
  { href: "/resumen", label: "Resumen", icon: "📊" },
] as const;

export default function BottomNav() {
  const pathname = usePathname();
  const [pendientes, setPendientes] = useState(0);

  useEffect(() => {
    async function fetchCount() {
      const { count } = await supabase
        .from("propuestas_ia")
        .select("id", { count: "exact", head: true })
        .eq("estado", "pendiente");
      setPendientes(count ?? 0);
    }

    fetchCount();

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

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 bg-white shadow-[0_-1px_12px_rgba(0,0,0,0.06)]">
      <div className="flex justify-around items-center h-16 max-w-lg mx-auto px-4">
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
                  : "text-[#AAAAAA] hover:text-[#888888]"
              }`}
            >
              <span className="text-xl">{item.icon}</span>
              <span className="text-[10px] font-medium">{item.label}</span>
              {showBadge && (
                <span className="absolute -top-0.5 right-0 min-w-[16px] h-4 flex items-center justify-center rounded-full bg-[#E8553E] text-[9px] font-bold text-white px-1">
                  {pendientes > 99 ? "99+" : pendientes}
                </span>
              )}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
