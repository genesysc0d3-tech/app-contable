"use client";

import { useState, useTransition } from "react";
import { useToast } from "@/components/Toast";
import { setEmisionConfig, type EmisionProveedor } from "./actions";

export interface EmissionProviderState {
  proveedor: EmisionProveedor;
  baseapiSandbox: boolean;
}

export default function EmissionProviderConfig({
  inicial,
  libredteConfigured,
}: {
  inicial: EmissionProviderState;
  libredteConfigured: boolean;
}) {
  const { toast } = useToast();
  const [state, setState] = useState(inicial);
  const [pending, start] = useTransition();

  function save(next: EmissionProviderState) {
    const previous = state;
    setState(next);
    start(async () => {
      const r = await setEmisionConfig(next);
      if (r.error) {
        setState(previous);
        toast(r.error, "error");
      } else {
        toast(providerLabel(next.proveedor) + " seleccionado para emitir");
      }
    });
  }

  function selectProveedor(proveedor: EmisionProveedor) {
    save({ ...state, proveedor });
  }

  const isLibreDte = state.proveedor === "libredte";
  const isSiiLocal = state.proveedor === "sii_local";

  return (
    <div style={{
      borderRadius: 22,
      border: "1px solid rgba(255,255,255,0.08)",
      background: "rgba(255,255,255,0.025)",
      boxShadow: "inset 0 1px 0 rgba(255,255,255,0.035)",
    }}>
      <div style={{ maxWidth: 1180, margin: "0 auto", padding: "28px 36px" }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 20, marginBottom: 24 }}>
          <div style={{
            width: 48, height: 48, flexShrink: 0,
            display: "flex", alignItems: "center", justifyContent: "center",
            borderRadius: 16,
            border: "1px solid rgba(91,156,246,0.25)",
            background: "rgba(91,156,246,0.12)",
            color: "#93C5FD",
          }}>
            <svg viewBox="0 0 24 24" fill="none" width={21} height={21}>
              <path d="M4 7h16M7 4v16M17 4v16M4 17h16" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
              <path d="M9 12h6" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
            </svg>
          </div>
          <div style={{ minWidth: 0, paddingTop: 4, flex: 1 }}>
            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10 }}>
              <h3 style={{ fontSize: 20, fontWeight: 700, lineHeight: 1.2, letterSpacing: "-0.04em", color: "#ffffff" }}>
                Proveedor de emision
              </h3>
              <span style={{
                display: "inline-block", borderRadius: 9999,
                border: `1px solid ${isSiiLocal ? "rgba(232,85,62,0.28)" : isLibreDte ? "rgba(91,156,246,0.25)" : "rgba(52,211,153,0.20)"}`,
                background: isSiiLocal ? "rgba(232,85,62,0.12)" : isLibreDte ? "rgba(91,156,246,0.14)" : "rgba(52,211,153,0.15)",
                padding: "4px 10px", fontSize: 11, fontWeight: 700,
                color: isSiiLocal ? "#FCA5A5" : isLibreDte ? "#93C5FD" : "#86EFAC",
              }}>
                {providerLabel(state.proveedor)}
              </span>
            </div>
            <p style={{ marginTop: 6, fontSize: 13, lineHeight: 1.4, color: "rgba(255,255,255,0.45)" }}>
              Define que motor usa el boton Emitir para la tanda diaria.
            </p>
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
          <ProviderButton
            active={state.proveedor === "mock"}
            title="Mock local"
            description="Usa CAF y SII simulado. Default seguro."
            disabled={pending}
            onClick={() => selectProveedor("mock")}
          />
          <ProviderButton
            active={isLibreDte}
            title="LibreDTE"
            description="Proximamente. La integracion backend aun no esta conectada."
            disabled={true}
            onClick={() => selectProveedor("libredte")}
          />
          <ProviderButton
            active={isSiiLocal}
            title="SII local"
            description="Abre e-Boleta en una ventana segura con la extension."
            disabled={pending}
            onClick={() => selectProveedor("sii_local")}
          />
        </div>

        <div style={{
          marginTop: 12,
          borderRadius: 14,
          border: "1px solid rgba(255,255,255,0.08)",
          background: isSiiLocal ? "rgba(232,85,62,0.055)" : isLibreDte ? "rgba(91,156,246,0.055)" : "rgba(255,255,255,0.03)",
          padding: "14px 16px",
          display: "block",
        }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 760, color: "#eaf0f8" }}>
              {state.proveedor === "mock" && "Mock local activo"}
              {isLibreDte && "LibreDTE pendiente de integracion"}
              {isSiiLocal && "SII local usa la extension del navegador"}
            </div>
            <div style={{ marginTop: 3, fontSize: 11, color: "rgba(255,255,255,0.45)", lineHeight: 1.45 }}>
              {state.proveedor === "mock" && "No sale a proveedores externos. Sirve para demos y pruebas internas."}
              {isLibreDte && (libredteConfigured ? "Hay credenciales en servidor, pero el flujo de emision se implementara despues." : "Selecciona Mock local o SII local hasta conectar el backend LibreDTE.")}
              {isSiiLocal && "La app abre una ventana e-Boleta. Clave SII, cookies y sesion quedan en el navegador del cliente."}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function providerLabel(proveedor: EmisionProveedor) {
  if (proveedor === "libredte") return "LibreDTE";
  if (proveedor === "sii_local") return "SII local";
  return "Mock";
}

function ProviderButton({ active, title, description, disabled, onClick }: {
  active: boolean;
  title: string;
  description: string;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        textAlign: "left",
        borderRadius: 14,
        border: `1px solid ${active ? "rgba(232,85,62,0.42)" : "rgba(255,255,255,0.08)"}`,
        background: active ? "rgba(232,85,62,0.10)" : "rgba(255,255,255,0.03)",
        padding: "14px 16px",
        color: "#eff3fa",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.68 : 1,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
        <strong style={{ fontSize: 13 }}>{title}</strong>
        <span style={{ width: 18, height: 18, borderRadius: "50%", display: "grid", placeItems: "center", border: `1px solid ${active ? "#E8553E" : "rgba(255,255,255,0.16)"}`, color: active ? "#E8553E" : "transparent", fontSize: 11, fontWeight: 900 }}>
          {active ? "✓" : ""}
        </span>
      </div>
      <div style={{ marginTop: 5, fontSize: 11, lineHeight: 1.4, color: "rgba(255,255,255,0.45)" }}>
        {description}
      </div>
    </button>
  );
}
