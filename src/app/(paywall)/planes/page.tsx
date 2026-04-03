"use client";

import { useState } from "react";
import { activarPlan } from "./actions";

const PLANES = [
  {
    id: "starter",
    nombre: "Starter",
    precio: "$7.990",
    docs: "10 documentos",
    extra: "$490/doc extra",
    popular: false,
  },
  {
    id: "pro",
    nombre: "Pro",
    precio: "$19.990",
    docs: "50 documentos",
    extra: "$290/doc extra",
    popular: true,
  },
  {
    id: "empresa",
    nombre: "Empresa",
    precio: "$39.990",
    docs: "200 documentos",
    extra: "$150/doc extra",
    popular: false,
  },
] as const;

export default function PlanesPage() {
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleSelect(planId: string) {
    setLoading(planId);
    setError(null);
    const formData = new FormData();
    formData.set("plan", planId);
    const result = await activarPlan(formData);
    if (result?.error) {
      setError(result.error);
      setLoading(null);
    }
  }

  return (
    <div className="flex-1 flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-lg space-y-6">
        <div className="text-center">
          <h1 className="text-3xl font-bold">Elige tu plan</h1>
          <p className="text-white/50 mt-2 text-sm">
            Procesamiento IA ilimitado en todos los planes
          </p>
        </div>

        {error && (
          <div className="rounded-xl bg-red-500/10 border border-red-500/20 px-4 py-3 text-sm text-red-300">
            {error}
          </div>
        )}

        <div className="space-y-3">
          {PLANES.map((plan) => (
            <button
              key={plan.id}
              onClick={() => handleSelect(plan.id)}
              disabled={loading !== null}
              className={`w-full text-left rounded-2xl backdrop-blur-sm border p-5 transition-all ${
                plan.popular
                  ? "bg-blue-500/10 border-blue-400/30 hover:border-blue-400/50"
                  : "bg-white/5 border-white/10 hover:border-white/20"
              } disabled:opacity-50`}
            >
              <div className="flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-lg font-bold">{plan.nombre}</span>
                    {plan.popular && (
                      <span className="text-[10px] font-semibold bg-blue-500 text-white px-2 py-0.5 rounded-full">
                        POPULAR
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-white/50 mt-1">
                    {plan.docs} / mes &middot; {plan.extra}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-xl font-bold">{plan.precio}</p>
                  <p className="text-xs text-white/40">/mes</p>
                </div>
              </div>
              {loading === plan.id && (
                <p className="text-xs text-blue-400 mt-2">Activando...</p>
              )}
            </button>
          ))}
        </div>

        <p className="text-xs text-white/30 text-center">
          20% descuento con pago anual &middot; Documentos no usados acumulan
          hasta 3 meses
        </p>
      </div>
    </div>
  );
}
