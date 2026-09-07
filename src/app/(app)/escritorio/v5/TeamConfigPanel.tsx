"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { cambiarEmpresaActiva, estadoTeam, listarEmpresasSelector, type Colaboracion, type TeamEstado } from "./actions";
import TeamSection from "./TeamSection";
import ColaborasEn from "./ColaborasEn";
import TeamComoFunciona from "./TeamComoFunciona";

/**
 * Paso "Team" del wizard de configuración de empresa (fundador 2026-09-07):
 * lo mismo que vive en el popup del logo, en el segundo lugar donde se
 * configura la empresa. Se trae sus datos solo (el wizard no sabe del plan,
 * mismo patrón que Facturación). Team gris fuera de Business; "Colaboras en"
 * activo en todos los planes.
 */
export default function TeamConfigPanel() {
  const router = useRouter();
  const [team, setTeam] = useState<TeamEstado | null>(null);
  const [colab, setColab] = useState<{ colaboraciones: Colaboracion[]; enCuentaAjena: boolean; cuentaPropia: { empresaId: string; nombre: string } | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    let vivo = true;
    void Promise.all([estadoTeam(), listarEmpresasSelector()]).then(([t, s]) => {
      if (!vivo) return;
      setTeam(t);
      setColab(s.ok ? { colaboraciones: s.colaboraciones, enCuentaAjena: s.enCuentaAjena, cuentaPropia: s.cuentaPropia } : { colaboraciones: [], enCuentaAjena: false, cuentaPropia: null });
    });
    return () => { vivo = false; };
  }, []);

  function irA(empresaId: string) {
    setError(null);
    startTransition(async () => {
      const r = await cambiarEmpresaActiva(empresaId);
      if (!r.ok) { setError(r.detalle ?? "No se pudo cambiar de empresa."); return; }
      router.refresh();
    });
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 26, minWidth: 0 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 12, maxWidth: 520 }}>
      <div>
        <h3 style={{ margin: 0, fontSize: 15, fontWeight: 800, color: "var(--text)", letterSpacing: "-.01em" }}>Team</h3>
        <p style={{ margin: "6px 0 0", fontSize: 11.5, lineHeight: 1.5, color: "var(--text2)" }}>
          Quién trabaja contigo y qué empresas ve cada persona. Agregar gente al team viene con Business;
          colaborar en un team ajeno al que te invitaron funciona en cualquier plan.
        </p>
      </div>

      <div style={{ padding: "6px 8px 8px", borderRadius: 12, border: "1px solid var(--border)", background: "var(--surface)" }}>
        {colab?.enCuentaAjena && colab.cuentaPropia && (
          <button type="button" onClick={() => irA(colab.cuentaPropia!.empresaId)} disabled={pending}
            style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", marginBottom: 4, padding: "8px 8px", borderRadius: 9, border: "1px solid var(--border)", background: "var(--bg-muted)", color: "var(--text)", fontSize: 11, fontWeight: 800, cursor: pending ? "wait" : "pointer", textAlign: "left" }}>
            <span aria-hidden style={{ color: "var(--text2)" }}>←</span> Volver a tu cuenta
            <span style={{ marginLeft: "auto", fontSize: 9, color: "var(--text3)", fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 160 }}>{colab.cuentaPropia.nombre}</span>
          </button>
        )}
        {team ? <TeamSection team={team} /> : <div style={{ padding: "10px 8px", fontSize: 10.5, color: "var(--text3)" }}>Cargando el team…</div>}
        {colab && <ColaborasEn colaboraciones={colab.colaboraciones} pending={pending} onIr={irA} />}
        {error && <div style={{ margin: "6px 8px 2px", color: "var(--red)", fontSize: 9.5, lineHeight: 1.35 }}>{error}</div>}
      </div>
      </div>

      {/* Cómo funciona (fundador 2026-09-07): el globito animado + paso a paso, DEBAJO de la config, entero. */}
      <div style={{ display: "flex", flexDirection: "column", gap: 12, minWidth: 0, paddingTop: 18, borderTop: "1px solid var(--border)" }}>
        <div>
          <h3 style={{ margin: 0, fontSize: 15, fontWeight: 800, color: "var(--text)", letterSpacing: "-.01em" }}>Cómo funciona</h3>
          <p style={{ margin: "6px 0 0", fontSize: 11.5, lineHeight: 1.5, color: "var(--text2)" }}>Un solo globito para avisos y team. Nadie te saca de lo que estás haciendo.</p>
        </div>
        <TeamComoFunciona />
      </div>
    </div>
  );
}
