"use client";

import { Sun, Moon } from "@phosphor-icons/react";

// El tema inicial lo aplica el script inline de app/layout.tsx antes de
// hidratar; aquí solo se alterna la clase y se persiste la preferencia.
// Los iconos se muestran/ocultan vía variantes `dark:` (clase .dark).
export default function ThemeToggle() {
  function toggle() {
    const next = !document.documentElement.classList.contains("dark");
    document.documentElement.classList.toggle("dark", next);
    localStorage.setItem("theme", next ? "dark" : "light");
  }

  return (
    <button
      onClick={toggle}
      className="p-2 rounded-xl bg-white dark:bg-white/10 shadow-[0_1px_4px_rgba(0,0,0,0.06)] dark:shadow-none hover:scale-105 active:scale-95 transition-transform duration-150"
      aria-label="Cambiar tema"
    >
      <Sun size={20} weight="bold" className="hidden dark:block text-[#F59E0B]" />
      <Moon size={20} weight="bold" className="dark:hidden text-[#888]" />
    </button>
  );
}
