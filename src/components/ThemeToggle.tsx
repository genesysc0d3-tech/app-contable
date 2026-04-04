"use client";

import { useEffect, useState } from "react";
import { Sun, Moon } from "@phosphor-icons/react";

export default function ThemeToggle() {
  const [dark, setDark] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem("theme");
    const prefersDark = saved === "dark" || (!saved && window.matchMedia("(prefers-color-scheme: dark)").matches);
    setDark(prefersDark);
    document.documentElement.classList.toggle("dark", prefersDark);
  }, []);

  function toggle() {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle("dark", next);
    localStorage.setItem("theme", next ? "dark" : "light");
  }

  return (
    <button
      onClick={toggle}
      className="p-2 rounded-xl bg-white dark:bg-white/10 shadow-[0_1px_4px_rgba(0,0,0,0.06)] dark:shadow-none hover:scale-105 active:scale-95 transition-transform duration-150"
      aria-label="Cambiar tema"
    >
      {dark ? (
        <Sun size={20} weight="bold" className="text-[#F59E0B]" />
      ) : (
        <Moon size={20} weight="bold" className="text-[#888]" />
      )}
    </button>
  );
}
