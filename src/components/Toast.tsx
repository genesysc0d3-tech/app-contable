"use client";

import { useState, useCallback, createContext, useContext } from "react";
import { CheckCircle, XCircle, Info } from "@phosphor-icons/react";

interface ToastItem {
  id: number;
  message: string;
  type: "success" | "error" | "info";
}

const ToastContext = createContext<{
  toast: (message: string, type?: "success" | "error" | "info") => void;
}>({ toast: () => {} });

export function useToast() {
  return useContext(ToastContext);
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const toast = useCallback((message: string, type: "success" | "error" | "info" = "success") => {
    const id = Date.now();
    setToasts((prev) => [...prev, { id, message, type }]);
    // Errores e info necesitan más tiempo de lectura que las confirmaciones.
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, type === "error" ? 6000 : type === "info" ? 5000 : 2000);
  }, []);

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      {/* z-[120]: el feedback SIEMPRE sobre cualquier modal (el wizard de empresa y el
          mapper usan z-100) — un "RUT inválido" debajo del overlay es un error invisible. */}
      <div role="status" aria-live="polite" className="fixed bottom-6 left-0 right-0 z-[120] flex flex-col items-center gap-2 pointer-events-none">
        {toasts.map((t) => (
          <div
            key={t.id}
            className="animate-fade-in-up pointer-events-auto px-4 py-2.5 rounded-xl bg-white dark:bg-[#1c1c1e] shadow-[0_4px_20px_rgba(0,0,0,0.12)] flex items-center gap-2"
          >
            {t.type === "success" ? (
              <CheckCircle size={18} weight="fill" className="text-[#22C55E]" />
            ) : t.type === "info" ? (
              <Info size={18} weight="fill" className="text-[#3B82F6]" />
            ) : (
              <XCircle size={18} weight="fill" className="text-[#E8553E]" />
            )}
            <span className="text-sm font-medium text-[#111] dark:text-white">{t.message}</span>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
