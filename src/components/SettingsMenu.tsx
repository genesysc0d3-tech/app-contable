"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { Gear, DeviceMobile, Monitor, Check, PaperPlaneTilt, ShieldCheck } from "@phosphor-icons/react";
import { useToast } from "@/components/Toast";

type Modo = "mobile" | "escritorio";

function currentModo(pathname: string): Modo {
  return pathname.startsWith("/escritorio") || pathname.startsWith("/massdte") ? "escritorio" : "mobile";
}

export default function SettingsMenu() {
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const modo = currentModo(pathname);
  const { toast } = useToast();
  const [tgLink, setTgLink] = useState<string | null>(null);
  const [tgLoading, setTgLoading] = useState(false);

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
    router.push(next === "escritorio" ? "/massdte" : "/subir");
  }

  async function conectarTelegram() {
    if (tgLoading) return;
    setTgLoading(true);
    try {
      const res = await fetch("/api/telegram/link", { method: "POST" });
      const data = await res.json().catch(() => null);
      if (res.ok && data?.ok && data.link) {
        setTgLink(data.link as string);
        toast("Abre Telegram y aprieta Iniciar");
      } else if (res.status === 503) {
        toast("Telegram próximamente", "error");
      } else {
        toast("No se pudo generar el link de Telegram", "error");
      }
    } catch {
      toast("No se pudo generar el link de Telegram", "error");
    } finally {
      setTgLoading(false);
    }
  }

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => {
          setOpen((v) => !v);
          setTgLink(null);
        }}
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
          <div className="px-3 pt-3 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-light)]">
            Conexiones
          </div>
          <button
            role="menuitem"
            onClick={conectarTelegram}
            disabled={tgLoading}
            className="w-full flex items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-[var(--surface)] text-[var(--foreground)] disabled:opacity-60"
          >
            <PaperPlaneTilt size={22} weight="regular" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold">Conectar Telegram</p>
              <p className="text-[11px] text-[var(--muted-light)]">
                {tgLoading ? "Generando link..." : "Manda fotos de comprobantes"}
              </p>
            </div>
          </button>
          {tgLink && (
            <a
              href={tgLink}
              target="_blank"
              rel="noreferrer"
              className="mx-3 mb-3 block rounded-xl bg-[var(--accent-light)] px-3 py-2 text-center text-[12px] font-semibold text-[#E8553E]"
            >
              Abrir Telegram →
            </a>
          )}
          <div className="px-3 pt-3 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-light)]">
            Cuenta
          </div>
          <button
            role="menuitem"
            onClick={() => {
              setOpen(false);
              router.push("/seguridad");
            }}
            className="w-full flex items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-[var(--surface)] text-[var(--foreground)]"
          >
            <ShieldCheck size={22} weight="regular" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold">Seguridad</p>
              <p className="text-[11px] text-[var(--muted-light)]">Autenticación en dos pasos</p>
            </div>
          </button>
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
