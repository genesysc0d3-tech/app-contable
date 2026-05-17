"use client";

import Link from "next/link";
import { MagnifyingGlass, Bell, ChartBar, Files, CalendarDots, Receipt, Gear } from "@phosphor-icons/react";

export default function DashboardShell({ children, empresa, empresaId, activeTab, rightPanel }: {
  children: React.ReactNode; empresa: string; empresaId: string;
  activeTab: string; rightPanel?: React.ReactNode;
}) {
  const nav = [
    { id: "dashboard", icon: ChartBar, label: "Dashboard" },
    { id: "emitir", icon: Files, label: "Emitir" },
    { id: "revisar", icon: Receipt, label: "Revisar" },
    { id: "boletas", icon: CalendarDots, label: "Boletas" },
    { id: "config", icon: Gear, label: "Config" },
  ];

  return (
    <div style={{ display: "flex", height: "100vh", overflow: "hidden", background: "#0f1014", color: "#e8eaf0", fontFamily: "'DM Sans', 'Inter', sans-serif" }}>
      <style>{`.nav-i:hover{background:#1e2028!important;color:#9499a8!important}`}</style>
      <div style={{ width: 72, background: "#16181d", borderRight: "1px solid #2a2d36", display: "flex", flexDirection: "column", alignItems: "center", padding: "18px 0 12px", gap: 6, flexShrink: 0 }}>
        <Link href="/escritorio/v3" scroll={false} style={{ textDecoration: "none" }}>
          <svg width="32" height="32" viewBox="0 0 32 32" style={{ marginBottom: 18 }}><rect width="32" height="32" rx="8" fill="#b4f027"/><rect x="8" y="8" width="6" height="16" rx="2" fill="#0f1014"/><rect x="18" y="12" width="6" height="12" rx="2" fill="#0f1014"/></svg>
        </Link>
        {nav.map((n) => {
          const Icon = n.icon;
          const active = activeTab === n.id;
          const href = n.id === "dashboard" ? "/escritorio/v3" : `/escritorio/v3?tab=${n.id}`;
          return (
            <Link key={n.id} href={href} scroll={false} style={{ textDecoration: "none" }}>
              <div className="nav-i"
                style={{ width: 44, height: 44, borderRadius: 10, display: "flex", alignItems: "center", justifyContent: "center", background: active ? "#b4f027" : "transparent", color: active ? "#000" : "#636878", transition: "all .15s", cursor: "pointer" }}>
                <Icon size={20} weight={active ? "fill" : "bold"} />
              </div>
            </Link>
          );
        })}
        <div style={{ marginTop: "auto" }}>
          <Link href="/empresa" style={{ textDecoration: "none" }}>
            <div style={{ width: 36, height: 36, borderRadius: "50%", background: "linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%)", border: "2px solid #333742", position: "relative", cursor: "pointer" }}>
              <span style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 700, color: "#fff" }}>{empresa[0]}</span>
              <div style={{ position: "absolute", bottom: 0, right: 0, width: 10, height: 10, borderRadius: "50%", background: "#22c55e", border: "2px solid #16181d" }} />
            </div>
          </Link>
        </div>
      </div>

      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <div style={{ display: "flex", alignItems: "center", padding: "14px 24px", borderBottom: "1px solid #2a2d36", gap: 12, flexShrink: 0 }}>
          <div>
            <h1 style={{ fontSize: 18, fontWeight: 700, letterSpacing: "-.3px", margin: 0, color: "#e8eaf0" }}>
              {nav.find(n => n.id === activeTab)?.label ?? "Dashboard"}
            </h1>
            <p style={{ fontSize: 12, color: "#636878", margin: "1px 0 0" }}>Sistema de facturación y documentos tributarios</p>
          </div>
          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, background: "#1e2028", border: "1px solid #2a2d36", borderRadius: 9, padding: "6px 12px", width: 160 }}>
              <MagnifyingGlass size={14} color="#636878" />
              <input placeholder="Buscar..." style={{ background: "none", border: "none", outline: "none", color: "#e8eaf0", fontSize: 13, width: "100%" }} />
            </div>
            <div style={{ width: 36, height: 36, borderRadius: 9, background: "#1e2028", border: "1px solid #2a2d36", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: "#9499a8", position: "relative" }}>
              <Bell size={17} />
              <div style={{ position: "absolute", top: 6, right: 6, width: 7, height: 7, borderRadius: "50%", background: "#b4f027", border: "1.5px solid #1e2028" }} />
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, background: "#1e2028", border: "1px solid #2a2d36", borderRadius: 9, padding: "5px 10px 5px 5px", cursor: "pointer" }}>
              <div style={{ width: 26, height: 26, borderRadius: 6, background: "linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 700, color: "#fff" }}>{empresa[0]}</div>
              <span style={{ fontSize: 13, fontWeight: 500, color: "#e8eaf0" }}>{empresa.slice(0, 14)}</span>
            </div>
          </div>
        </div>

        <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
          <div style={{ flex: 1, overflowY: "auto", padding: 0 }}>
            {children}
          </div>
          {rightPanel}
        </div>
      </div>
    </div>
  );
}
