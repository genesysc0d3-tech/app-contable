"use client";

import { useEffect, useState } from "react";
import { listarEmpresasSelector, type EmpresaSelectorRow, type EmpresasSelectorResult } from "./actions";
import { formatRut } from "@/lib/rut";

/**
 * Selector de empresas ARRIBA del paso Emisor (fundador 2026-09-07, segunda
 * vuelta: la lista debajo del formulario "quedaba rara"). Chips compactos —
 * 1 MV Inversiones · 2 … · + Agregar · 1 de 3 — y el formulario de abajo es
 * el de la empresa elegida. Es configuración, no cambia la mesa.
 * Solo Business (multiempresa) y solo en tu propia cuenta: para el resto no
 * se pinta nada, el paso queda como siempre.
 */
type Estado =
  | { fase: "cargando" }
  | { fase: "error" }
  | {
      fase: "ok";
      empresas: EmpresaSelectorRow[];
      multiempresa: boolean;
      puedeAgregar: boolean;
      cupo: { activas: number; incluidas: number } | null;
      enCuentaAjena: boolean;
    };

function estadoDe(r: EmpresasSelectorResult): Estado {
  if (!r.ok) return { fase: "error" };
  return { fase: "ok", empresas: r.empresas, multiempresa: r.multiempresa, puedeAgregar: r.puedeAgregar, cupo: r.cupoEmpresas, enCuentaAjena: r.enCuentaAjena };
}

const corto = (s: string, n = 26) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

export default function EmpresasCuentaPanel({ enEdicion, nuevaActiva = false, onElegir, onAgregar, onIrAFacturacion, refreshKey = 0, semilla = null }: {
  /** Empresa cuyo emisor se está editando (la activa si es null). */
  enEdicion: string | null;
  /** Hay una empresa nueva abierta en el formulario (chip "Nueva" seleccionado). */
  nuevaActiva?: boolean;
  onElegir: (empresaId: string) => void;
  /** "+ Agregar": abre el MISMO formulario vacío (fundador 2026-09-08). */
  onAgregar: () => void;
  onIrAFacturacion: () => void;
  refreshKey?: number;
  /** Selector ya cargado por la página (cero fetch al montar). */
  semilla?: EmpresasSelectorResult | null;
}) {
  const [estado, setEstado] = useState<Estado>(() => (semilla ? estadoDe(semilla) : { fase: "cargando" }));

  // Con semilla y sin mutaciones (refreshKey 0) no se pide nada al montar.
  // Tras crear una empresa (refreshKey > 0) sí se relee del servidor.
  useEffect(() => {
    if (semilla && refreshKey === 0) return;
    let vivo = true;
    void listarEmpresasSelector().then((r) => { if (vivo) setEstado(estadoDe(r)); });
    return () => { vivo = false; };
  }, [refreshKey, semilla]);

  // Fuera de Business, o colaborando en un team ajeno: el paso es el de siempre.
  if (estado.fase !== "ok" || !estado.multiempresa || estado.enCuentaAjena) return null;

  const { empresas, puedeAgregar, cupo } = estado;
  const cupoLleno = !puedeAgregar && !!cupo && cupo.activas >= cupo.incluidas;

  const chipBase = { display: "inline-flex", alignItems: "center", gap: 7, height: 34, padding: "0 10px 0 6px", borderRadius: 10, fontSize: 11, fontWeight: 800, cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap" as const, transition: "border-color .15s, background .15s" };

  return (
    <div data-panel="empresas-cuenta" style={{ marginBottom: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
        <span style={{ fontSize: 9, fontWeight: 850, color: "var(--text3)", textTransform: "uppercase", letterSpacing: ".08em", marginRight: 4 }}>Tus empresas</span>
        {empresas.map((e, i) => {
          const editando = !nuevaActiva && (enEdicion ? enEdicion === e.id : e.activaActual);
          return (
            <button key={e.id} type="button" onClick={() => onElegir(e.id)} data-empresa-chip={e.id} aria-pressed={editando}
              title={`${e.nombre}${e.rut ? ` · ${formatRut(e.rut)}` : ""}${e.esPrincipal ? " · Principal" : ""}${e.activaActual ? " · En la mesa" : ""}${editando ? "" : " — configurar sin cambiar de mesa"}`}
              style={{ ...chipBase, border: editando ? "1px solid rgba(232,85,62,.55)" : "1px solid var(--border)", background: editando ? "var(--accent-light)" : "var(--surface)", color: editando ? "var(--text)" : "var(--text2)", cursor: editando ? "default" : "pointer", maxWidth: 260 }}>
              <span style={{ width: 22, height: 22, borderRadius: 7, display: "grid", placeItems: "center", background: editando ? "rgba(232,85,62,.18)" : "var(--bg-muted)", color: editando ? "var(--accent)" : "var(--text3)", fontSize: 10, fontWeight: 900, flexShrink: 0 }}>{i + 1}</span>
              <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{corto(e.nombre)}</span>
              {e.activaActual && <span aria-label="En la mesa" title="En la mesa" style={{ width: 6, height: 6, borderRadius: 99, background: "var(--green)", flexShrink: 0 }} />}
            </button>
          );
        })}

        {puedeAgregar && (nuevaActiva ? (
          <span data-empresa-chip="nueva" aria-current="true"
            style={{ ...chipBase, cursor: "default", border: "1px dashed rgba(232,85,62,.55)", background: "var(--accent-light)", color: "var(--text)" }}>
            <span style={{ width: 22, height: 22, borderRadius: 7, display: "grid", placeItems: "center", background: "rgba(232,85,62,.18)", color: "var(--accent)", fontSize: 10, fontWeight: 900, flexShrink: 0 }}>{empresas.length + 1}</span>
            Nueva
          </span>
        ) : (
          <button type="button" onClick={onAgregar} data-accion="agregar-empresa"
            style={{ ...chipBase, border: "1px dashed var(--border)", background: "transparent", color: "var(--text2)" }}>
            <span style={{ width: 22, height: 22, borderRadius: 7, display: "grid", placeItems: "center", background: "var(--bg-muted)", fontSize: 14, fontWeight: 700, flexShrink: 0 }}>+</span>
            Agregar
          </button>
        ))}
        {cupoLleno && (
          <button type="button" onClick={onIrAFacturacion} data-accion="cupo-lleno"
            title="Tu plan ya tiene todas sus empresas. Mira tu plan en Facturación y uso."
            style={{ ...chipBase, border: "1px dashed var(--border)", background: "transparent", color: "var(--text3)", opacity: .7 }}>
            <span style={{ width: 22, height: 22, borderRadius: 7, display: "grid", placeItems: "center", background: "var(--bg-muted)", fontSize: 14, fontWeight: 700, flexShrink: 0 }}>+</span>
            Cupo lleno <span style={{ color: "var(--accent)", fontWeight: 800 }}>· Ver plan →</span>
          </button>
        )}
        {cupo && <span style={{ marginLeft: "auto", fontSize: 9.5, fontWeight: 700, color: "var(--text3)", fontVariantNumeric: "tabular-nums" }}>{cupo.activas} de {cupo.incluidas}</span>}
      </div>

    </div>
  );
}
