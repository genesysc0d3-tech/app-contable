"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  canjearIntervencionDev,
  salirModoClienteDev,
  solicitarIntervencionDev,
  terminarIntervencionDev,
} from "@/app/(dev)/dev/actions";

export type BannerIntervencion =
  | { estado: "ninguna" }
  | { estado: "pendiente"; canal: string }
  | { estado: "activa"; expiraAt: string };

export default function DevSupportBanner({
  empresaNombre,
  operatorEmail,
  intervencion = { estado: "ninguna" },
}: {
  empresaNombre: string;
  operatorEmail: string;
  intervencion?: BannerIntervencion;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [pidiendo, setPidiendo] = useState(false);
  const [codigo, setCodigo] = useState("");
  const [error, setError] = useState<string | null>(null);
  // Estado local optimista: el server pasa el inicial; las acciones lo mueven.
  const [local, setLocal] = useState<BannerIntervencion>(intervencion);

  const activa = local.estado === "activa";
  const pendiente = local.estado === "pendiente";
  const horaTermino = activa
    ? new Date((local as { expiraAt: string }).expiraAt).toLocaleTimeString("es-CL", { hour: "2-digit", minute: "2-digit" })
    : null;

  async function salir() {
    setLoading(true);
    const res = await salirModoClienteDev();
    setLoading(false);
    if ("error" in res) return;
    router.push("/dev/cuentas");
  }

  async function pedir() {
    if (pidiendo) return;
    setPidiendo(true);
    setError(null);
    const res = await solicitarIntervencionDev();
    setPidiendo(false);
    if ("error" in res) { setError(res.error); return; }
    setLocal({ estado: "pendiente", canal: res.canal });
  }

  async function canjear() {
    if (pidiendo || codigo.trim().length < 6) return;
    setPidiendo(true);
    setError(null);
    const res = await canjearIntervencionDev(codigo);
    setPidiendo(false);
    if ("error" in res) { setError(res.error); return; }
    setCodigo("");
    setLocal({ estado: "activa", expiraAt: res.expiraAt });
    router.refresh();
  }

  async function terminar() {
    if (pidiendo) return;
    setPidiendo(true);
    const res = await terminarIntervencionDev();
    setPidiendo(false);
    if ("error" in res) { setError(res.error); return; }
    setLocal({ estado: "ninguna" });
    router.refresh();
  }

  const btn: React.CSSProperties = {
    border: "1px solid rgba(232,85,62,.38)",
    background: "rgba(232,85,62,.14)",
    color: "#E8553E",
    borderRadius: 10,
    padding: "7px 11px",
    fontSize: 10,
    fontWeight: 800,
    cursor: "pointer",
    whiteSpace: "nowrap",
  };

  return (
    <div
      style={{
        position: "sticky",
        top: 0,
        zIndex: 70,
        margin: "0 0 12px",
        border: `1px solid ${activa ? "rgba(232,85,62,.55)" : "rgba(232,85,62,.28)"}`,
        borderRadius: 14,
        background: activa ? "rgba(232,85,62,.18)" : "rgba(232,85,62,.12)",
        color: "#E8553E",
        padding: "9px 12px",
        display: "flex",
        alignItems: "center",
        gap: 10,
        flexWrap: "wrap",
        boxShadow: "0 14px 34px rgba(0,0,0,.22)",
      }}
    >
      <div style={{ flex: 1, minWidth: 220 }}>
        <div style={{ fontSize: 10, fontWeight: 900, textTransform: "uppercase", letterSpacing: ".08em" }}>
          {activa ? "🔴 Intervención activa" : "Modo soporte Genesys"}
        </div>
        <div style={{ fontSize: 11, color: "var(--text, #111827)", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {activa
            ? `Interviniendo ${empresaNombre} con permiso del cliente · expira a las ${horaTermino} · cada cambio queda auditado`
            : `Viendo ${empresaNombre} como cliente. Sesion: ${operatorEmail}. Solo lectura.`}
        </div>
        {error && <div style={{ fontSize: 10, marginTop: 2, fontWeight: 700 }}>{error}</div>}
      </div>

      {!activa && !pendiente && (
        <button type="button" onClick={pedir} disabled={pidiendo} style={btn}>
          {pidiendo ? "Pidiendo…" : "Pedir permiso para intervenir"}
        </button>
      )}

      {pendiente && (
        <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontSize: 10, fontWeight: 700 }}>
            Código enviado por {(local as { canal: string }).canal === "telegram" ? "Telegram" : "su app"} →
          </span>
          <input
            value={codigo}
            onChange={(e) => setCodigo(e.target.value.replace(/\D/g, "").slice(0, 6))}
            placeholder="000000"
            inputMode="numeric"
            style={{
              width: 84, height: 30, borderRadius: 8,
              border: "1px solid rgba(232,85,62,.38)",
              background: "rgba(0,0,0,.18)", color: "var(--text, #e8eaf0)",
              textAlign: "center", fontSize: 13, fontWeight: 800, letterSpacing: ".2em",
              outline: "none",
            }}
          />
          <button type="button" onClick={canjear} disabled={pidiendo || codigo.length < 6} style={{ ...btn, opacity: codigo.length < 6 ? 0.5 : 1 }}>
            {pidiendo ? "…" : "Autorizar"}
          </button>
        </span>
      )}

      {activa && (
        <button type="button" onClick={terminar} disabled={pidiendo} style={btn}>
          {pidiendo ? "…" : "Terminar ahora"}
        </button>
      )}

      <button type="button" onClick={salir} disabled={loading} style={{ ...btn, background: "transparent" }}>
        {loading ? "Saliendo..." : "Volver a dev"}
      </button>
    </div>
  );
}
