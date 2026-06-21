"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { salirModoClienteDev } from "@/app/(dev)/dev/actions";

export default function DevSupportBanner({
  empresaNombre,
  operatorEmail,
}: {
  empresaNombre: string;
  operatorEmail: string;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function salir() {
    setLoading(true);
    const res = await salirModoClienteDev();
    setLoading(false);
    if ("error" in res) return;
    router.push("/dev/cuentas");
  }

  return (
    <div
      style={{
        position: "sticky",
        top: 0,
        zIndex: 70,
        margin: "0 0 12px",
        border: "1px solid rgba(232,85,62,.28)",
        borderRadius: 14,
        background: "rgba(232,85,62,.12)",
        color: "#E8553E",
        padding: "9px 12px",
        display: "flex",
        alignItems: "center",
        gap: 10,
        boxShadow: "0 14px 34px rgba(0,0,0,.22)",
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 10, fontWeight: 900, textTransform: "uppercase", letterSpacing: ".08em" }}>
          Modo soporte Genesys
        </div>
        <div style={{ fontSize: 11, color: "var(--text, #111827)", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          Viendo {empresaNombre} como cliente. Sesion: {operatorEmail}. Solo lectura.
        </div>
      </div>
      <button
        type="button"
        onClick={salir}
        disabled={loading}
        style={{
          border: "1px solid rgba(232,85,62,.38)",
          background: "rgba(232,85,62,.14)",
          color: "#E8553E",
          borderRadius: 10,
          padding: "7px 11px",
          fontSize: 10,
          fontWeight: 800,
          cursor: loading ? "default" : "pointer",
          whiteSpace: "nowrap",
        }}
      >
        {loading ? "Saliendo..." : "Volver a dev"}
      </button>
    </div>
  );
}
