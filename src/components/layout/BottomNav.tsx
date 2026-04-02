"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV_ITEMS = [
  { href: "/subir", label: "Subir", icon: "↑" },
  { href: "/revisar", label: "Revisar", icon: "✓" },
  { href: "/clientes", label: "Clientes", icon: "👤" },
  { href: "/resumen", label: "Resumen", icon: "📊" },
] as const;

export default function BottomNav() {
  const pathname = usePathname();

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 bg-black/60 backdrop-blur-xl border-t border-white/10">
      <div className="flex justify-around items-center h-16 max-w-lg mx-auto px-4">
        {NAV_ITEMS.map((item) => {
          const isActive = pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex flex-col items-center gap-0.5 px-3 py-1 rounded-lg transition-colors ${
                isActive
                  ? "text-blue-400"
                  : "text-white/40 hover:text-white/70"
              }`}
            >
              <span className="text-xl">{item.icon}</span>
              <span className="text-[10px] font-medium">{item.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
