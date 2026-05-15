"use client";

import { useState, isValidElement, type ReactNode } from "react";
import { UploadSimple, CheckSquare, Lightning, Receipt } from "@phosphor-icons/react";

const TABS = [
  { id: "subir", label: "Emitir", icon: UploadSimple },
  { id: "revisar", label: "Revisar", icon: CheckSquare },
  { id: "emitir", label: "Boleta Electrónica", icon: Lightning },
  { id: "boletas", label: "Boletas", icon: Receipt },
];

export default function TabsV3({
  subirContent, revisarContent, emitirContent, boletasContent
}: {
  subirContent: ReactNode; revisarContent: ReactNode;
  emitirContent: ReactNode; boletasContent: ReactNode;
}) {
  const [tab, setTab] = useState("revisar");

  return (
    <div style={{
      background: "#1c1c1e",
      borderRadius: 18,
      border: "1px solid #38383a",
      overflow: "hidden",
    }}>
      <div style={{
        display: "flex", alignItems: "center", gap: 4,
        padding: "10px 14px",
        background: "#252527",
        borderBottom: "1px solid #38383a",
        overflowX: "auto",
      }}>
        {TABS.map((t) => {
          const Icon = t.icon;
          const active = t.id === tab;
          return (
            <button key={t.id} onClick={() => setTab(t.id)}
              style={{
                display: "flex", alignItems: "center", gap: 6,
                padding: "6px 12px", borderRadius: 8, border: "none",
                fontSize: 12, fontWeight: 600,
                cursor: "pointer", whiteSpace: "nowrap",
                background: active ? "#3a3a3c" : "transparent",
                color: active ? "#fff" : "#8a8a8e",
                transition: "all 0.15s",
              }}
              onMouseEnter={(e) => { if (!active) { e.currentTarget.style.background = "#2e2e30"; e.currentTarget.style.color = "#fff"; }}}
              onMouseLeave={(e) => { if (!active) { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "#8a8a8e"; }}}>
              <Icon size={13} weight={active ? "fill" : "bold"} />
              {t.label}
            </button>
          );
        })}
      </div>
      <div style={{ padding: 14, minHeight: 300 }}>
        <div style={{ display: tab === "subir" ? "block" : "none" }}>{subirContent}</div>
        <div style={{ display: tab === "revisar" ? "block" : "none" }}>{revisarContent}</div>
        <div style={{ display: tab === "emitir" ? "block" : "none" }}>{emitirContent}</div>
        <div style={{ display: tab === "boletas" ? "block" : "none" }}>{boletasContent}</div>
      </div>
    </div>
  );
}
