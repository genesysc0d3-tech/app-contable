"use client";

import { useState, useCallback, createContext, useContext } from "react";
import { CheckCircle, XCircle } from "@phosphor-icons/react";

interface ToastItem {
  id: number;
  message: string;
  type: "success" | "error";
}

const ToastContext = createContext<{
  toast: (message: string, type?: "success" | "error") => void;
}>({ toast: () => {} });

export function useToast() {
  return useContext(ToastContext);
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const toast = useCallback((message: string, type: "success" | "error" = "success") => {
    const id = Date.now();
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 2000);
  }, []);

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <div className="fixed bottom-20 left-0 right-0 z-[60] flex flex-col items-center gap-2 pointer-events-none">
        {toasts.map((t) => (
          <div
            key={t.id}
            className="animate-fade-in-up pointer-events-auto px-4 py-2.5 rounded-xl bg-white dark:bg-[#1c1c1e] shadow-[0_4px_20px_rgba(0,0,0,0.12)] flex items-center gap-2"
          >
            {t.type === "success" ? (
              <CheckCircle size={18} weight="fill" className="text-[#22C55E]" />
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
