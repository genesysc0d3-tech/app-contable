"use client";

import { useState, useTransition } from "react";
import { ShieldCheck, ShieldWarning } from "@phosphor-icons/react";
import { setCertificadoSii } from "./actions";
import { useToast } from "@/components/Toast";

export default function CertificadoToggle({ inicial }: { inicial: boolean }) {
  const { toast } = useToast();
  const [activo, setActivo] = useState(inicial);
  const [pending, start] = useTransition();

  function toggle() {
    const siguiente = !activo;
    setActivo(siguiente);
    start(async () => {
      const r = await setCertificadoSii(siguiente);
      if (r.error) {
        setActivo(!siguiente);
        toast(r.error, "error");
      } else {
        toast(siguiente ? "Certificado delegado al intermediario" : "Certificado desactivado");
      }
    });
  }

  const Icon = activo ? ShieldCheck : ShieldWarning;
  return (
    <div className={`p-4 rounded-xl border transition-colors ${
      activo
        ? "bg-[#10B981]/5 border-[#10B981]/30"
        : "bg-[#F59E0B]/5 border-[#F59E0B]/30"
    }`}>
      <div className="flex items-start gap-3">
        <Icon size={20} weight="fill" className={activo ? "text-[#10B981]" : "text-[#F59E0B]"} />
        <div className="flex-1">
          <div className="text-sm font-semibold">
            {activo ? "Certificado digital delegado" : "Sin certificado digital"}
          </div>
          <p className="text-xs text-[#888] dark:text-white/60 mt-0.5 leading-relaxed">
            {activo
              ? "El intermediario (mock) puede emitir DTEs en tu nombre. Los folios se solicitan al SII automáticamente cuando se agotan."
              : "Activá para que el intermediario pueda firmar boletas en nombre del contribuyente. En producción, acá subirías tu .pfx + clave tributaria."}
          </p>
        </div>
        <button
          type="button"
          onClick={toggle}
          disabled={pending}
          className={`relative shrink-0 w-11 h-6 rounded-full transition-colors disabled:opacity-60 ${
            activo ? "bg-[#10B981]" : "bg-black/20 dark:bg-white/20"
          }`}
          aria-label="Toggle certificado"
          role="switch"
          aria-checked={activo}
        >
          <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${
            activo ? "translate-x-5" : "translate-x-0.5"
          }`} />
        </button>
      </div>
    </div>
  );
}
