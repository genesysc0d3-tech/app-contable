"use client";

import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { entrarModoClienteDev, setCuentaPlan, setTrialGlobal, setCuentaTrialCortesia, purgarCuenta } from "../actions";

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

/** Toggle GLOBAL del trial (oferta pública para todas las cuentas sin plan). */
export function TrialGlobalToggle({ habilitado }: { habilitado: boolean }) {
  const router = useRouter();
  const [on, setOn] = useState(habilitado);
  const [estado, setEstado] = useState<"idle" | "loading" | "error">("idle");

  async function toggle() {
    if (estado === "loading") return;
    const next = !on;
    setEstado("loading");
    const res = await setTrialGlobal(next);
    if ("error" in res) { setEstado("error"); return; }
    setOn(next);
    setEstado("idle");
    router.refresh();
  }

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
      <span style={{
        fontSize: 11, fontWeight: 800, letterSpacing: ".04em",
        color: on ? "#22c55e" : C.text2,
      }}>
        {on ? "TRIAL GLOBAL: ON" : "TRIAL GLOBAL: OFF"}
      </span>
      <button
        type="button"
        onClick={toggle}
        disabled={estado === "loading"}
        style={{
          border: `1px solid ${on ? "rgba(34,197,94,.45)" : "rgba(232,85,62,.45)"}`,
          background: estado === "error" ? "rgba(232,85,62,.08)" : on ? "rgba(34,197,94,.12)" : C.accentSoft,
          color: estado === "error" ? C.accent : C.text,
          borderRadius: 7, padding: "7px 12px", fontSize: 11, fontWeight: 700,
          cursor: estado === "loading" ? "default" : "pointer",
        }}
      >
        {estado === "loading" ? "..." : estado === "error" ? "Error" : on ? "Apagar trial global" : "Prender trial global"}
      </button>
    </div>
  );
}

/** Zona de peligro: purga TOTAL de la cuenta. Exige tipear el nombre exacto. */
export function PurgarCuentaButton({ cuentaId, nombre }: { cuentaId: string; nombre: string }) {
  const router = useRouter();
  const [confirmacion, setConfirmacion] = useState("");
  const [estado, setEstado] = useState<"idle" | "loading" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const armado = confirmacion.trim() === nombre.trim();

  async function purgar() {
    if (!armado || estado === "loading") return;
    setEstado("loading");
    setError(null);
    const res = await purgarCuenta(cuentaId, confirmacion);
    if ("error" in res) { setEstado("error"); setError(res.error); return; }
    router.push("/dev/cuentas");
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <input
        value={confirmacion}
        onChange={(e) => { setConfirmacion(e.target.value); setEstado("idle"); }}
        placeholder={`Escribí «${nombre}» para habilitar`}
        style={{
          border: "1px solid rgba(232,85,62,.45)", background: C.muted, color: C.text,
          borderRadius: 7, padding: "8px 10px", fontSize: 12, width: "100%", maxWidth: 360,
        }}
      />
      <button
        type="button"
        onClick={purgar}
        disabled={!armado || estado === "loading"}
        style={{
          border: "1px solid rgba(232,85,62,.6)",
          background: armado ? "rgba(232,85,62,.18)" : "rgba(232,85,62,.05)",
          color: armado ? C.accent : C.text2,
          borderRadius: 7, padding: "8px 12px", fontSize: 11, fontWeight: 800, letterSpacing: ".03em",
          cursor: armado && estado !== "loading" ? "pointer" : "not-allowed", alignSelf: "flex-start",
        }}
      >
        {estado === "loading" ? "Purgando..." : "Purgar cuenta (irreversible)"}
      </button>
      {error && <span style={{ fontSize: 11, color: C.accent }}>{error}</span>}
    </div>
  );
}

/** Toggle de trial de CORTESÍA para una cuenta puntual ("amistad"). */
export function TrialCortesiaToggle({ cuentaId, cortesia }: { cuentaId: string; cortesia: boolean }) {
  const router = useRouter();
  const [on, setOn] = useState(cortesia);
  const [estado, setEstado] = useState<"idle" | "loading" | "error">("idle");

  async function toggle() {
    if (estado === "loading") return;
    const next = !on;
    setEstado("loading");
    const res = await setCuentaTrialCortesia(cuentaId, next);
    if ("error" in res) { setEstado("error"); return; }
    setOn(next);
    setEstado("idle");
    router.refresh();
  }

  return (
    <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11, color: C.text2, fontWeight: 700 }}>
      <input type="checkbox" checked={on} disabled={estado === "loading"} onChange={toggle} />
      Trial de cortesía {estado === "error" ? <span style={{ color: C.accent }}>· error</span> : on ? <span style={{ color: "#22c55e" }}>· activo</span> : null}
    </label>
  );
}
