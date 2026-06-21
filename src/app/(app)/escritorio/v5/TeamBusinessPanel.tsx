"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import type { EquipoPersona } from "./actions";

type PresenceStatus = "active" | "idle" | "offline";

type PresencePayload = {
  user_id: string;
  nombre: string;
  iniciales: string;
  empresa_activa_id: string;
  empresa_activa_nombre: string;
  last_seen_at: string;
  status: Exclude<PresenceStatus, "offline">;
};

type TeamPerson = EquipoPersona & {
  status: PresenceStatus;
  lastSeenAt: string | null;
};

function statusColor(status: PresenceStatus) {
  if (status === "active") return "#22c55e";
  if (status === "idle") return "#f59e0b";
  return "var(--text3)";
}

function statusLabel(status: PresenceStatus) {
  if (status === "active") return "Activo";
  if (status === "idle") return "Inactivo";
  return "Desconectado";
}

function newestPresence(values: unknown[]): PresencePayload | null {
  const payloads = values
    .filter((value): value is PresencePayload => Boolean(value && typeof value === "object" && "user_id" in value))
    .sort((a, b) => String(b.last_seen_at).localeCompare(String(a.last_seen_at)));
  return payloads[0] ?? null;
}

export default function TeamBusinessPanel({
  cuentaId,
  usuarioId,
  empresaActivaId,
  empresaActivaNombre,
  personas,
}: {
  cuentaId: string;
  usuarioId: string;
  empresaActivaId: string;
  empresaActivaNombre: string;
  personas: EquipoPersona[];
}) {
  const [open, setOpen] = useState(false);
  const [presence, setPresence] = useState<Record<string, PresencePayload>>({});

  const currentPerson = personas.find((persona) => persona.id === usuarioId);
  const currentNombre = currentPerson?.nombre ?? "Yo";
  const currentIniciales = currentPerson?.iniciales ?? "YO";

  useEffect(() => {
    let active = true;
    let status: Exclude<PresenceStatus, "offline"> = "active";

    const channel = supabase.channel(`presence:cuenta:${cuentaId}`, {
      config: { presence: { key: usuarioId } },
    });

    function payload(): PresencePayload {
      return {
        user_id: usuarioId,
        nombre: currentNombre,
        iniciales: currentIniciales,
        empresa_activa_id: empresaActivaId,
        empresa_activa_nombre: empresaActivaNombre,
        last_seen_at: new Date().toISOString(),
        status,
      };
    }

    async function track(nextStatus?: Exclude<PresenceStatus, "offline">) {
      if (!active) return;
      if (nextStatus) status = nextStatus;
      await channel.track(payload());
    }

    function syncPresence() {
      const state = channel.presenceState();
      const next: Record<string, PresencePayload> = {};
      for (const values of Object.values(state)) {
        const latest = newestPresence(values as unknown[]);
        if (latest?.user_id) next[latest.user_id] = latest;
      }
      setPresence(next);
    }

    channel.on("presence", { event: "sync" }, syncPresence);
    channel.subscribe((subscriptionStatus) => {
      if (subscriptionStatus === "SUBSCRIBED") void track("active");
    });

    let idleTimer = window.setTimeout(() => { void track("idle"); }, 60000);
    function markActive() {
      window.clearTimeout(idleTimer);
      void track("active");
      idleTimer = window.setTimeout(() => { void track("idle"); }, 60000);
    }
    function markIdle() {
      void track("idle");
    }

    window.addEventListener("focus", markActive);
    window.addEventListener("pointerdown", markActive);
    window.addEventListener("keydown", markActive);
    window.addEventListener("blur", markIdle);

    return () => {
      active = false;
      window.clearTimeout(idleTimer);
      window.removeEventListener("focus", markActive);
      window.removeEventListener("pointerdown", markActive);
      window.removeEventListener("keydown", markActive);
      window.removeEventListener("blur", markIdle);
      void supabase.removeChannel(channel);
    };
  }, [cuentaId, currentIniciales, currentNombre, empresaActivaId, empresaActivaNombre, usuarioId]);

  const team = useMemo<TeamPerson[]>(() => personas.map((persona) => {
    const state = presence[persona.id];
    return {
      ...persona,
      status: state?.status ?? "offline",
      lastSeenAt: state?.last_seen_at ?? null,
      empresaActivaId: state?.empresa_activa_id ?? persona.empresaActivaId,
      empresaActivaNombre: state?.empresa_activa_nombre ?? persona.empresaActivaNombre,
    };
  }), [personas, presence]);

  const connected = team.filter((persona) => persona.status !== "offline").length;
  const visible = team.slice(0, 5);
  const hidden = Math.max(0, team.length - visible.length);

  return (
    <div style={{ position: "relative" }}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        style={{ width: "100%", minHeight: 76, padding: "12px 13px", borderRadius: 16, border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text)", boxShadow: "inset 0 1px 0 var(--border),0 8px 32px var(--shadow)", cursor: "pointer", textAlign: "left" }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", marginBottom: 10 }}>
          <span style={{ fontSize: 11, fontWeight: 850, color: "var(--text)" }}>Equipo</span>
          <span style={{ fontSize: 9, fontWeight: 800, color: connected > 0 ? "#22c55e" : "var(--text3)" }}>{connected} conectados</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          {visible.map((persona) => (
            <span key={persona.id} title={`${persona.nombre} · ${statusLabel(persona.status)}`} style={{ position: "relative", width: 28, height: 28, borderRadius: 999, display: "grid", placeItems: "center", background: persona.id === usuarioId ? "rgba(232,85,62,.14)" : "var(--bg-muted)", border: persona.id === usuarioId ? "1px solid rgba(232,85,62,.28)" : "1px solid var(--border)", color: persona.id === usuarioId ? "#E8553E" : "var(--text2)", fontSize: 9, fontWeight: 900, flexShrink: 0 }}>
              {persona.iniciales}
              <span style={{ position: "absolute", right: 0, bottom: 0, width: 8, height: 8, borderRadius: 999, background: statusColor(persona.status), border: "2px solid var(--surface)" }} />
            </span>
          ))}
          {hidden > 0 && <span style={{ fontSize: 10, color: "var(--text2)", fontWeight: 800 }}>+{hidden}</span>}
        </div>
      </button>

      {open && (
        <div style={{ position: "absolute", left: 0, right: 0, top: "calc(100% + 8px)", zIndex: 75, padding: 10, borderRadius: 14, border: "1px solid var(--border)", background: "var(--surface)", boxShadow: "0 22px 64px rgba(0,0,0,.34), inset 0 1px 0 var(--border)" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 240, overflow: "auto" }}>
            {team.map((persona) => (
              <div key={persona.id} style={{ display: "grid", gridTemplateColumns: "30px 1fr auto", gap: 8, alignItems: "center", minHeight: 38 }}>
                <span style={{ position: "relative", width: 30, height: 30, borderRadius: 999, display: "grid", placeItems: "center", background: "var(--bg-muted)", color: "var(--text2)", fontSize: 9, fontWeight: 900 }}>
                  {persona.iniciales}
                  <span style={{ position: "absolute", right: 0, bottom: 0, width: 8, height: 8, borderRadius: 999, background: statusColor(persona.status), border: "2px solid var(--surface)" }} />
                </span>
                <span style={{ minWidth: 0 }}>
                  <span style={{ display: "block", fontSize: 10, fontWeight: 850, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{persona.nombre}</span>
                  <span style={{ display: "block", marginTop: 1, fontSize: 8, color: "var(--text2)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{persona.empresaActivaNombre ?? "Empresa activa"}</span>
                </span>
                <span style={{ fontSize: 8, fontWeight: 850, color: statusColor(persona.status), whiteSpace: "nowrap" }}>{statusLabel(persona.status)}</span>
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={() => window.dispatchEvent(new CustomEvent("toggle-empresa"))}
            style={{ marginTop: 10, width: "100%", height: 32, borderRadius: 10, border: "1px solid rgba(232,85,62,.22)", background: "rgba(232,85,62,.09)", color: "#E8553E", fontSize: 10, fontWeight: 850, cursor: "pointer" }}
          >
            Agregar persona
          </button>
        </div>
      )}
    </div>
  );
}
