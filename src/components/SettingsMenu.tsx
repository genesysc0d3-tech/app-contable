"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { Gear, DeviceMobile, Monitor, Check } from "@phosphor-icons/react";

type Modo = "mobile" | "escritorio";

function currentModo(pathname: string): Modo {
  return pathname.startsWith("/escritorio") ? "escritorio" : "mobile";
}

export default function SettingsMenu() {
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const modo = currentModo(pathname);

  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onEsc(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onEsc);
    };
  }, [open]);

  function select(next: Modo) {
    localStorage.setItem("ui-modo", next);
    setOpen(false);
    if (next === modo) return;
    router.push(next === "escritorio" ? "/escritorio" : "/subir");
  }

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label="Configuración"
        aria-expanded={open}
        className="p-2 rounded-xl bg-white dark:bg-white/10 shadow-[0_1px_4px_rgba(0,0,0,0.06)] dark:shadow-none hover:scale-105 active:scale-95 transition-transform duration-150"
      >
        <Gear size={20} weight="bold" className={`text-[#888] transition-transform duration-300 ${open ? "rotate-45" : ""}`} />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 mt-2 w-56 origin-top-right rounded-2xl bg-white dark:bg-[#1c1c1e] border border-[var(--border)] shadow-[0_8px_24px_rgba(0,0,0,0.12)] dark:shadow-[0_8px_24px_rgba(0,0,0,0.4)] overflow-hidden animate-fade-in"
        >
          <div className="px-3 pt-3 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-light)]">
            Modo de vista
          </div>
          <ModoOption
            active={modo === "mobile"}
            label="Teléfono"
            hint="Una tab a la vez"
            Icon={DeviceMobile}
            onClick={() => select("mobile")}
          />
          <ModoOption
            active={modo === "escritorio"}
            label="Escritorio"
            hint="Todo en una página"
            Icon={Monitor}
            onClick={() => select("escritorio")}
          />
        </div>
      )}
    </div>
  );
}

function ModoOption({
  active,
  label,
  hint,
  Icon,
  onClick,
}: {
  active: boolean;
  label: string;
  hint: string;
  Icon: typeof DeviceMobile;
  onClick: () => void;
}) {
  return (
    <button
      role="menuitemradio"
      aria-checked={active}
      onClick={onClick}
      className={`w-full flex items-center gap-3 px-3 py-2.5 text-left transition-colors ${
        active
          ? "bg-[var(--accent-light)] text-[#E8553E]"
          : "hover:bg-[var(--surface)] text-[var(--foreground)]"
      }`}
    >
      <Icon size={22} weight={active ? "fill" : "regular"} />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold">{label}</p>
        <p className="text-[11px] text-[var(--muted-light)]">{hint}</p>
      </div>
      {active && <Check size={16} weight="bold" className="shrink-0" />}
    </button>
  );
}
