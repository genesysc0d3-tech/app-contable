"use client";

import { useState, useTransition } from "react";
import { setDatosEmisor, type DatosEmisor } from "./actions";
import { formatRut, validarRut, cleanRut } from "@/lib/sii/validation";
import { useToast } from "@/components/Toast";

interface Props {
  inicial: DatosEmisor;
}

export default function EmisorForm({ inicial }: Props) {
  const { toast } = useToast();
  const [pending, start] = useTransition();
  const [rut, setRut] = useState(inicial.rut ? formatRut(inicial.rut) : "");
  const [razonSocial, setRazonSocial] = useState(inicial.razon_social ?? "");
  const [giro, setGiro] = useState(inicial.giro ?? "");
  const [direccion, setDireccion] = useState(inicial.direccion ?? "");
  const [comuna, setComuna] = useState(inicial.comuna ?? "");
  const [emailSii, setEmailSii] = useState(inicial.email_sii ?? "");

  const rutOk = !rut || validarRut(rut);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (rut && !validarRut(rut)) {
      toast("RUT inválido", "error");
      return;
    }
    if (!razonSocial.trim()) {
      toast("Razón social obligatoria", "error");
      return;
    }
    start(async () => {
      const r = await setDatosEmisor({
        rut: rut ? cleanRut(rut) : null,
        razon_social: razonSocial,
        giro,
        direccion,
        comuna,
        email_sii: emailSii,
      });
      if (r.error) toast(r.error, "error");
      else toast("Datos del emisor guardados");
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div>
        <label className="text-xs text-[#888] dark:text-white/60 mb-1 block">RUT</label>
        <input
          type="text"
          value={rut}
          onChange={(e) => setRut(e.target.value)}
          onBlur={() => rut && setRut(formatRut(rut))}
          placeholder="12.345.678-9"
          className={`w-full px-3 py-2 rounded-lg bg-white dark:bg-white/5 border text-sm ${
            rutOk ? "border-black/10 dark:border-white/10" : "border-red-500"
          }`}
        />
        {!rutOk && <p className="text-xs text-red-500 mt-1">RUT inválido (dígito verificador)</p>}
      </div>

      <div>
        <label className="text-xs text-[#888] dark:text-white/60 mb-1 block">Razón social</label>
        <input
          type="text"
          value={razonSocial}
          onChange={(e) => setRazonSocial(e.target.value)}
          placeholder="Mi Empresa SpA"
          className="w-full px-3 py-2 rounded-lg bg-white dark:bg-white/5 border border-black/10 dark:border-white/10 text-sm"
        />
      </div>

      <div>
        <label className="text-xs text-[#888] dark:text-white/60 mb-1 block">Giro</label>
        <input
          type="text"
          value={giro}
          onChange={(e) => setGiro(e.target.value)}
          placeholder="Servicios de software"
          className="w-full px-3 py-2 rounded-lg bg-white dark:bg-white/5 border border-black/10 dark:border-white/10 text-sm"
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs text-[#888] dark:text-white/60 mb-1 block">Dirección</label>
          <input
            type="text"
            value={direccion}
            onChange={(e) => setDireccion(e.target.value)}
            placeholder="Av. Apoquindo 123"
            className="w-full px-3 py-2 rounded-lg bg-white dark:bg-white/5 border border-black/10 dark:border-white/10 text-sm"
          />
        </div>
        <div>
          <label className="text-xs text-[#888] dark:text-white/60 mb-1 block">Comuna</label>
          <input
            type="text"
            value={comuna}
            onChange={(e) => setComuna(e.target.value)}
            placeholder="Las Condes"
            className="w-full px-3 py-2 rounded-lg bg-white dark:bg-white/5 border border-black/10 dark:border-white/10 text-sm"
          />
        </div>
      </div>

      <div>
        <label className="text-xs text-[#888] dark:text-white/60 mb-1 block">Email para el SII</label>
        <input
          type="email"
          value={emailSii}
          onChange={(e) => setEmailSii(e.target.value)}
          placeholder="sii@miempresa.cl"
          className="w-full px-3 py-2 rounded-lg bg-white dark:bg-white/5 border border-black/10 dark:border-white/10 text-sm"
        />
      </div>

      <button
        type="submit"
        disabled={pending}
        className="btn-press w-full px-4 py-2.5 rounded-lg bg-[#E8553E] text-white font-semibold text-sm disabled:opacity-50"
      >
        {pending ? "Guardando…" : "Guardar datos del emisor"}
      </button>
    </form>
  );
}
