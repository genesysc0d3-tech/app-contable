"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { TeamEstado, TeamMiembro } from "./actions";
import { cambiarTicksDelTeam, invitarAlTeam, quitarDelTeam, revocarInvitacionTeam } from "./actions";

/**
 * Apartado Team del popup de empresa (diseño del fundador, 2026-09-02/06):
 * agregas a alguien, le marcas con ticks qué empresas ve, listo. Gris con una
 * línea de upsell en Start/Pro; activo en Business. Solo el titular escribe.
 * Estilos inline como el resto del v5.
 */
export default function TeamSection({ team }: { team: TeamEstado }) {
  const router = useRouter();
  const [vista, setVista] = useState<{ tipo: "lista" } | { tipo: "invitar" } | { tipo: "editar"; miembro: TeamMiembro }>({ tipo: "lista" });
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (!team.ok) return null;

  const cabecera = (texto: string, apagado = false) => (
    <div style={{ padding: "9px 8px 7px", fontSize: 9, fontWeight: 850, color: "var(--text3)", textTransform: "uppercase", letterSpacing: ".06em", opacity: apagado ? 0.7 : 1 }}>{texto}</div>
  );

  if (!team.equipo) {
    // Upsell en una línea: el team ES el motivo para subir a Business.
    return (
      <div style={{ marginTop: 6, borderTop: "1px solid var(--border)" }}>
        {cabecera("Team", true)}
        <div style={{ display: "flex", alignItems: "center", gap: 9, padding: "4px 8px 8px", opacity: 0.55 }}>
          <span style={{ width: 30, height: 30, borderRadius: 9, display: "grid", placeItems: "center", background: "var(--bg-muted)", color: "var(--text3)", fontSize: 13, fontWeight: 700, flexShrink: 0 }}>+</span>
          <span style={{ fontSize: 10.5, color: "var(--text2)", lineHeight: 1.35 }}>
            Trabajar con tu equipo viene con Business. <a href="/planes" style={{ color: "var(--accent)", fontWeight: 800, textDecoration: "none" }}>Ver planes</a>
          </span>
        </div>
      </div>
    );
  }

  const nombreEmpresa = new Map(team.empresas.map((e) => [e.id, e.nombre]));
  const quedan = team.cupo.total - team.cupo.uso;

  function correr(accion: () => Promise<{ ok: true } | { ok: false; error: string }>) {
    setError(null);
    startTransition(async () => {
      const r = await accion();
      if (!r.ok) { setError(r.error); return; }
      setVista({ tipo: "lista" });
      router.refresh();
    });
  }

  if (vista.tipo === "invitar") {
    return (
      <div style={{ marginTop: 6, borderTop: "1px solid var(--border)" }}>
        <InvitarForm
          empresas={team.empresas}
          onCancelar={() => setVista({ tipo: "lista" })}
          onListo={() => router.refresh()}
        />
      </div>
    );
  }

  if (vista.tipo === "editar") {
    const m = vista.miembro;
    return (
      <div style={{ marginTop: 6, borderTop: "1px solid var(--border)" }}>
        {cabecera(`${m.nombre} · qué ve`)}
        <TicksSelector
          empresas={team.empresas}
          inicial={m.empresas}
          pending={pending}
          textoOk="Guardar"
          onCancelar={() => setVista({ tipo: "lista" })}
          onOk={(ids) => correr(() => cambiarTicksDelTeam(m.id, ids))}
        />
        <button type="button" disabled={pending} onClick={() => { if (window.confirm(`¿Quitar a ${m.nombre} del team? Deja de ver todo al instante.`)) correr(() => quitarDelTeam(m.id)); }}
          style={{ display: "block", width: "100%", marginTop: 4, padding: "8px", borderRadius: 9, border: 0, background: "transparent", color: "var(--red)", fontSize: 10.5, fontWeight: 800, cursor: "pointer", textAlign: "left" }}>
          Quitar del team
        </button>
        {error && <div style={{ margin: "4px 8px 6px", color: "var(--red)", fontSize: 9, lineHeight: 1.35 }}>{error}</div>}
      </div>
    );
  }

  return (
    <div style={{ marginTop: 6, borderTop: "1px solid var(--border)" }}>
      {cabecera(`Team · ${team.cupo.uso} de ${team.cupo.total}`)}
      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        {team.miembros.map((m) => {
          const editable = team.esTitular && !m.esTitular;
          const veTodo = m.esTitular || m.empresas.length === team.empresas.length;
          const sub = m.esTitular
            ? "Titular · ve todo"
            : veTodo
              ? "Ve todas las empresas"
              : m.empresas.length === 1
                ? `Ve ${nombreEmpresa.get(m.empresas[0]) ?? "1 empresa"}`
                : `Ve ${m.empresas.length} de ${team.empresas.length} empresas`;
          return (
            <button key={m.id} type="button" disabled={!editable} onClick={() => editable && setVista({ tipo: "editar", miembro: m })}
              title={editable ? "Cambiar qué ve o quitar" : undefined}
              style={{ display: "grid", gridTemplateColumns: "30px 1fr auto", alignItems: "center", gap: 9, width: "100%", minHeight: 40, padding: "6px 8px", borderRadius: 9, border: "1px solid transparent", background: "transparent", color: "var(--text)", cursor: editable ? "pointer" : "default", textAlign: "left", font: "inherit" }}>
              <span style={{ width: 30, height: 30, borderRadius: 9, display: "grid", placeItems: "center", background: m.id === team.usuarioId ? "rgba(232,85,62,.14)" : "var(--bg-muted)", color: m.id === team.usuarioId ? "var(--accent)" : "var(--text2)", fontSize: 10, fontWeight: 900, flexShrink: 0 }}>{m.iniciales}</span>
              <span style={{ minWidth: 0 }}>
                <span style={{ display: "block", fontSize: 11, fontWeight: 800, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.nombre}{m.id === team.usuarioId ? " (tú)" : ""}</span>
                <span style={{ display: "block", marginTop: 1, fontSize: 9, color: "var(--text2)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{sub}</span>
              </span>
              {editable ? <span style={{ fontSize: 9, fontWeight: 800, color: "var(--text3)" }}>Editar</span> : <span />}
            </button>
          );
        })}
        {team.pendientes.map((p) => (
          <div key={p.id} style={{ display: "grid", gridTemplateColumns: "30px 1fr auto", alignItems: "center", gap: 9, width: "100%", minHeight: 40, padding: "6px 8px", borderRadius: 9, color: "var(--text)" }}>
            <span style={{ width: 30, height: 30, borderRadius: 9, display: "grid", placeItems: "center", border: "1px dashed var(--border)", color: "var(--text3)", fontSize: 10, fontWeight: 900, flexShrink: 0 }}>…</span>
            <span style={{ minWidth: 0 }}>
              <span style={{ display: "block", fontSize: 11, fontWeight: 800, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--text2)" }}>{p.email}</span>
              <span style={{ display: "block", marginTop: 1, fontSize: 9, color: "var(--text3)" }}>Invitación pendiente</span>
            </span>
            {team.esTitular ? (
              <button type="button" disabled={pending} onClick={() => correr(() => revocarInvitacionTeam(p.id))}
                style={{ border: 0, background: "transparent", color: "var(--text3)", fontSize: 9, fontWeight: 800, cursor: "pointer", padding: 0 }}>Revocar</button>
            ) : <span />}
          </div>
        ))}
      </div>
      {team.esTitular && (
        <button type="button" disabled={quedan <= 0} onClick={() => setVista({ tipo: "invitar" })}
          title={quedan <= 0 ? "No quedan lugares en el team" : undefined}
          style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", marginTop: 4, padding: "9px 8px", borderRadius: 9, border: "1px dashed var(--border)", background: "transparent", color: quedan <= 0 ? "var(--text3)" : "var(--text2)", fontSize: 11, fontWeight: 800, cursor: quedan <= 0 ? "default" : "pointer", textAlign: "left", opacity: quedan <= 0 ? 0.6 : 1 }}>
          <span style={{ width: 30, height: 30, borderRadius: 9, display: "grid", placeItems: "center", background: "var(--bg-muted)", fontSize: 15, fontWeight: 700 }}>+</span>
          Agregar alguien al team
        </button>
      )}
      {error && <div style={{ margin: "6px 8px 2px", color: "var(--red)", fontSize: 9, lineHeight: 1.35 }}>{error}</div>}
    </div>
  );
}

function TicksSelector({ empresas, inicial, pending, textoOk, onOk, onCancelar }: {
  empresas: Array<{ id: string; nombre: string }>;
  inicial: string[];
  pending: boolean;
  textoOk: string;
  onOk: (ids: string[]) => void;
  onCancelar: () => void;
}) {
  const [marcadas, setMarcadas] = useState<Set<string>>(() => new Set(inicial));
  function toggle(id: string) {
    setMarcadas((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  }
  return (
    <div style={{ padding: "0 8px 6px" }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
        {empresas.map((e) => {
          const on = marcadas.has(e.id);
          return (
            <label key={e.id} style={{ display: "flex", alignItems: "center", gap: 9, padding: "7px 6px", borderRadius: 9, cursor: "pointer", border: on ? "1px solid rgba(232,85,62,.22)" : "1px solid transparent", background: on ? "rgba(232,85,62,.07)" : "transparent" }}>
              <span aria-hidden style={{ width: 16, height: 16, borderRadius: 5, border: on ? "1px solid var(--accent)" : "1px solid var(--border)", background: on ? "var(--accent)" : "transparent", display: "grid", placeItems: "center", flexShrink: 0 }}>
                {on && <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>}
              </span>
              <input type="checkbox" checked={on} onChange={() => toggle(e.id)} style={{ position: "absolute", opacity: 0, width: 0, height: 0 }} />
              <span style={{ fontSize: 11, fontWeight: 700, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{e.nombre}</span>
            </label>
          );
        })}
      </div>
      <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
        <button type="button" onClick={onCancelar} disabled={pending}
          style={{ flex: 1, padding: "9px 0", borderRadius: 10, border: "1px solid var(--border)", background: "transparent", color: "var(--text2)", fontSize: 11, fontWeight: 700, cursor: "pointer" }}>Cancelar</button>
        <button type="button" onClick={() => onOk(Array.from(marcadas))} disabled={pending || marcadas.size === 0}
          style={{ flex: 2, padding: "9px 0", borderRadius: 10, border: 0, background: "var(--accent)", color: "#fff", fontSize: 11, fontWeight: 800, cursor: pending ? "wait" : "pointer", opacity: pending || marcadas.size === 0 ? 0.55 : 1 }}>
          {pending ? "Guardando…" : textoOk}
        </button>
      </div>
    </div>
  );
}

function InvitarForm({ empresas, onCancelar, onListo }: {
  empresas: Array<{ id: string; nombre: string }>;
  onCancelar: () => void;
  onListo: () => void;
}) {
  const [email, setEmail] = useState("");
  const [link, setLink] = useState<string | null>(null);
  const [copiado, setCopiado] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const inputStyle = { width: "100%", boxSizing: "border-box" as const, padding: "10px 12px", borderRadius: 10, border: "1px solid var(--border)", background: "var(--bg-muted)", color: "var(--text)", fontSize: 12, outline: "none", lineHeight: 1.3 };

  function invitar(ids: string[]) {
    setError(null);
    startTransition(async () => {
      const r = await invitarAlTeam({ email, empresas: ids });
      if (!r.ok) { setError(r.error); return; }
      setLink(`${window.location.origin}${r.invitePath}`);
      onListo();
    });
  }

  async function copiar() {
    if (!link) return;
    try { await navigator.clipboard.writeText(link); setCopiado(true); setTimeout(() => setCopiado(false), 1600); } catch { /* el campo queda seleccionable */ }
  }

  if (link) {
    // El link se muestra UNA vez (el servidor guarda solo el hash). Se manda
    // por WhatsApp; no hay correo.
    return (
      <div style={{ padding: 8 }}>
        <div style={{ padding: "2px 0 10px", fontSize: 9, fontWeight: 850, color: "var(--text3)", textTransform: "uppercase", letterSpacing: ".08em" }}>Invitación lista</div>
        <div style={{ fontSize: 10.5, color: "var(--text2)", lineHeight: 1.5, marginBottom: 8 }}>
          Mándale este link a <strong style={{ color: "var(--text)" }}>{email}</strong>. Vale 7 días y solo entra con ese correo. Cópialo ahora: no se vuelve a mostrar.
        </div>
        <input readOnly value={link} onFocus={(e) => e.currentTarget.select()} style={{ ...inputStyle, fontSize: 10.5, color: "var(--text2)" }} />
        <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
          <button type="button" onClick={onCancelar} style={{ flex: 1, padding: "9px 0", borderRadius: 10, border: "1px solid var(--border)", background: "transparent", color: "var(--text2)", fontSize: 11, fontWeight: 700, cursor: "pointer" }}>Listo</button>
          <button type="button" onClick={copiar} style={{ flex: 2, padding: "9px 0", borderRadius: 10, border: 0, background: "var(--accent)", color: "#fff", fontSize: 11, fontWeight: 800, cursor: "pointer" }}>{copiado ? "Copiado ✓" : "Copiar link"}</button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: "8px 0 0" }}>
      <div style={{ padding: "2px 8px 10px", fontSize: 9, fontWeight: 850, color: "var(--text3)", textTransform: "uppercase", letterSpacing: ".08em" }}>Agregar alguien al team</div>
      <div style={{ padding: "0 8px 8px" }}>
        <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Correo de la persona" type="email" autoFocus style={inputStyle} />
      </div>
      <div style={{ padding: "0 8px 6px", fontSize: 9.5, color: "var(--text3)", lineHeight: 1.5 }}>Qué empresas va a ver:</div>
      <TicksSelector
        empresas={empresas}
        inicial={empresas.map((e) => e.id)}
        pending={pending}
        textoOk="Crear invitación"
        onCancelar={onCancelar}
        onOk={invitar}
      />
      {error && <div style={{ margin: "0 8px 6px", color: "var(--red)", fontSize: 9.5, lineHeight: 1.4 }}>{error}</div>}
    </div>
  );
}
