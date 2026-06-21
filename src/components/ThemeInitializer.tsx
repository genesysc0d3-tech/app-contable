"use client";

import { useEffect } from "react";

export default function ThemeInitializer() {
  useEffect(() => {
    try {
      const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
      const saved = window.localStorage.getItem("theme");
      document.documentElement.classList.toggle("dark", saved === "dark" || (!saved && prefersDark));
    } catch {
      // El tema es una mejora visual; si localStorage no esta disponible no bloquea la app.
    }
  }, []);

  return null;
}
