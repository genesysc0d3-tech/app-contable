"use client";

import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { entrarModoClienteDev, setCuentaPlan } from "../actions";

const C = {
  border: "rgba(255,255,255,.08)",
  text: "#e8eaf0",
  text2: "#9aa0ad",
  accent: "#E8553E",
  accentSoft: "rgba(232,85,62,.14)",
  muted: "rgba(255,255,255,.05)",
} as const;

export function VerComoClienteButton({
  empresaId,
  children = "Ver como cliente",
  compacto = false,
}: {
  empresaId: string | null;
  children?: ReactNode;
  compacto?: boolean;
}) {
  const router = useRouter();
  const [estado, setEstado] = useState<"idle" | "loading" | "error">("idle");

  async function entrar() {
    if (!empresaId || estado === "loading") return;
    setEstado("loading");
    const res = await entrarModoClienteDev(empresaId);
    if ("error" in res) {
      setEstado("error");
      return;
    }
    router.push("/massdte");
  }

  return (
    <button
      type="button"
      onClick={entrar}
      disabled={!empresaId || estado === "loading"}
      title={estado === "error" ? "No se pudo entrar en modo cliente" : undefined}
      style={{
        border: `1px solid ${estado === "error" ? "rgba(232,85,62,.55)" : "rgba(232,85,62,.45)"}`,
        background: estado === "error" ? "rgba(232,85,62,.08)" : C.accentSoft,
        color: estado === "error" ? C.accent : C.text,
        borderRadius: 7,
        padding: compacto ? "5px 9px" : "7px 11px",
        fontSize: compacto ? 10 : 11,
        fontWeight: 700,
        cursor: !empresaId || estado === "loading" ? "default" : "pointer",
        opacity: !empresaId ? 0.45 : 1,
        whiteSpace: "nowrap",
      }}
    >
      {estado === "loading" ? "Abriendo..." : estado === "error" ? "Error" : children}
    </button>
  );
}

export function DevLinkButton({
  href,
  children,
}: {
  href: string;
  children: ReactNode;
}) {
  return (
    <a
      href={href}
      style={{
        border: `1px solid ${C.border}`,
        background: C.muted,
        color: C.text2,
        borderRadius: 7,
        padding: "7px 11px",
        fontSize: 11,
        fontWeight: 700,
        textDecoration: "none",
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </a>
  );
}

export function PlanToggle({
  cuentaId,
  planCodigo,
  planActivo,
}: {
  cuentaId: string;
  planCodigo: string | null;
  planActivo: boolean;
}) {
  const router = useRouter();
  const [plan, setPlan] = useState(planCodigo ?? "start");
  const [activo, setActivo] = useState(planActivo);
  const [estado, setEstado] = useState<"idle" | "loading" | "error" | "ok">("idle");

  async function guardar() {
    if (estado === "loading") return;
    setEstado("loading");
    const res = await setCuentaPlan(cuentaId, plan, activo);
    setEstado("error" in res ? "error" : "ok");
    if (!("error" in res)) router.refresh();
  }

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
      <select
        value={plan}
        onChange={(e) => { setPlan(e.target.value); setEstado("idle"); }}
        style={{
          border: `1px solid ${C.border}`, background: C.muted, color: C.text,
          borderRadius: 7, padding: "7px 10px", fontSize: 12, fontWeight: 700,
        }}
      >
        <option value="start">Start</option>
        <option value="pro">Pro</option>
        <option value="business">Business</option>
      </select>
      <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: C.text2, fontWeight: 700 }}>
        <input type="checkbox" checked={activo} onChange={(e) => { setActivo(e.target.checked); setEstado("idle"); }} />
        activo
      </label>
      <button
        type="button"
        onClick={guardar}
        disabled={estado === "loading"}
        style={{
          border: "1px solid rgba(232,85,62,.45)",
          background: estado === "error" ? "rgba(232,85,62,.08)" : C.accentSoft,
          color: estado === "error" ? C.accent : C.text,
          borderRadius: 7, padding: "7px 12px", fontSize: 11, fontWeight: 700,
          cursor: estado === "loading" ? "default" : "pointer",
        }}
      >
        {estado === "loading" ? "Guardando..." : estado === "ok" ? "Guardado ✓" : estado === "error" ? "Error" : "Guardar plan"}
      </button>
    </div>
  );
}
