"use client";

import { useEffect, useState } from "react";
import { listarEmpresasSelector, type EmpresaSelectorRow, type EmpresasSelectorResult } from "./actions";
import AgregarEmpresaForm from "./AgregarEmpresaForm";
import { formatRut } from "@/lib/rut";

/**
 * Empresas de la cuenta dentro del paso Emisor del wizard (fundador
 * 2026-09-07): Empresa 1, Empresa 2, Empresa 3… Tocar una abre SU emisor
 * para configurarla sin cambiar de mesa (la mesa se cambia en el logo).
 * "+ Agregar empresa" vive acá también — el mismo formulario que el popup
 * del logo. Con el cupo lleno, el botón lleva a Facturación y uso.
 * Fuera de Business queda gris.
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

export default function EmpresasCuentaPanel({ enEdicion, onElegir, onCreada, onIrAFacturacion, refreshKey = 0, semilla = null }: {
  /** Empresa cuyo emisor se está editando (la activa si es null). */
  enEdicion: string | null;
  onElegir: (empresaId: string) => void;
  onCreada: (empresaId: string) => void;
  onIrAFacturacion: () => void;
  refreshKey?: number;
  /** Selector ya cargado por la página (cero fetch al montar). */
  semilla?: EmpresasSelectorResult | null;
}) {
  const [estado, setEstado] = useState<Estado>(() => (semilla ? estadoDe(semilla) : { fase: "cargando" }));
  const [agregando, setAgregando] = useState(false);

  // Con semilla y sin mutaciones (refreshKey 0) no se pide nada al montar.
  // Tras crear una empresa (refreshKey > 0) sí se relee del servidor.
  useEffect(() => {
    if (semilla && refreshKey === 0) return;
    let vivo = true;
    void listarEmpresasSelector().then((r) => { if (vivo) setEstado(estadoDe(r)); });
    return () => { vivo = false; };
  }, [refreshKey, semilla]);

  const titulo = (
    <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10, padding: "0 2px 8px" }}>
      <span style={{ fontSize: 9, fontWeight: 850, color: "var(--text3)", textTransform: "uppercase", letterSpacing: ".08em" }}>Empresas de tu cuenta</span>
      {estado.fase === "ok" && estado.cupo && (
        <span style={{ fontSize: 9.5, fontWeight: 700, color: "var(--text3)", fontVariantNumeric: "tabular-nums" }}>{estado.cupo.activas} de {estado.cupo.incluidas}</span>
      )}
    </div>
  );

  if (estado.fase !== "ok") {
    return (
      <div data-panel="empresas-cuenta" style={{ marginTop: 14 }}>
        {titulo}
        <div style={{ padding: "10px 8px", fontSize: 10.5, color: "var(--text3)" }}>{estado.fase === "cargando" ? "Cargando tus empresas…" : "No se pudieron leer las empresas de la cuenta."}</div>
      </div>
    );
  }

  const { empresas, multiempresa, puedeAgregar, cupo, enCuentaAjena } = estado;
  const cupoLleno = multiempresa && !puedeAgregar && !!cupo && cupo.activas >= cupo.incluidas;

  return (
    <div data-panel="empresas-cuenta" style={{ marginTop: 14 }}>
      {titulo}
      <div style={{ borderRadius: 12, border: "1px solid var(--border)", background: "var(--surface)", padding: 6, display: "flex", flexDirection: "column", gap: 2 }}>
        {empresas.map((e, i) => {
          const editando = enEdicion ? enEdicion === e.id : e.activaActual;
          return (
            <button key={e.id} type="button" onClick={() => onElegir(e.id)} data-empresa-row={e.id} aria-current={editando ? "true" : undefined}
              title={editando ? "Estás configurando esta empresa" : `Configurar ${e.nombre} (sin cambiar de mesa)`}
              style={{ display: "grid", gridTemplateColumns: "30px 1fr auto", alignItems: "center", gap: 10, width: "100%", minHeight: 44, padding: "6px 8px", borderRadius: 9, border: editando ? "1px solid rgba(232,85,62,.45)" : "1px solid transparent", background: editando ? "var(--accent-light)" : "transparent", color: "var(--text)", cursor: editando ? "default" : "pointer", textAlign: "left", fontFamily: "inherit" }}>
              <span style={{ width: 30, height: 30, borderRadius: 9, display: "grid", placeItems: "center", background: "var(--bg-muted)", color: editando ? "var(--accent)" : "var(--text2)", fontSize: 10, fontWeight: 900, flexShrink: 0 }}>{i + 1}</span>
              <span style={{ minWidth: 0 }}>
                <span style={{ display: "block", fontSize: 11, fontWeight: 800, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  <span style={{ color: "var(--text3)", fontWeight: 700 }}>Empresa {i + 1} · </span>{e.nombre}
                </span>
                <span style={{ display: "block", marginTop: 1, fontSize: 9, color: "var(--text2)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {e.rut ? formatRut(e.rut) : "Sin RUT"}{e.esPrincipal ? " · Principal" : ""}{e.activaActual ? " · En la mesa" : ""}
                </span>
              </span>
              <span style={{ fontSize: 9, fontWeight: 800, color: editando ? "var(--accent)" : "var(--text3)", whiteSpace: "nowrap" }}>{editando ? "Configurando" : "Configurar →"}</span>
            </button>
          );
        })}

        {!enCuentaAjena && multiempresa && puedeAgregar && (agregando ? (
          <div style={{ marginTop: 4, borderTop: "1px solid var(--border)" }}>
            <AgregarEmpresaForm onListo={(id) => { setAgregando(false); onCreada(id); }} onCancelar={() => setAgregando(false)}
              nota="Al crearla te quedas acá configurando sus datos; la mesa sigue en la empresa activa. El RUT queda fijo tras la primera boleta emitida." />
          </div>
        ) : (
          <button type="button" onClick={() => setAgregando(true)} data-accion="agregar-empresa"
            style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", marginTop: 4, padding: "9px 8px", borderRadius: 9, border: "1px dashed var(--border)", background: "transparent", color: "var(--text2)", fontSize: 11, fontWeight: 800, cursor: "pointer", textAlign: "left", fontFamily: "inherit" }}>
            <span style={{ width: 30, height: 30, borderRadius: 9, display: "grid", placeItems: "center", background: "var(--bg-muted)", fontSize: 15, fontWeight: 700 }}>+</span>
            Agregar empresa
          </button>
        ))}

        {!enCuentaAjena && cupoLleno && (
          <button type="button" onClick={onIrAFacturacion} data-accion="cupo-lleno"
            title="Tu plan ya tiene todas sus empresas. Mira tu plan en Facturación y uso."
            style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", marginTop: 4, padding: "9px 8px", borderRadius: 9, border: "1px dashed var(--border)", background: "transparent", color: "var(--text3)", fontSize: 11, fontWeight: 800, cursor: "pointer", textAlign: "left", fontFamily: "inherit" }}>
            <span style={{ width: 30, height: 30, borderRadius: 9, display: "grid", placeItems: "center", background: "var(--bg-muted)", fontSize: 15, fontWeight: 700 }}>+</span>
            <span style={{ flex: 1 }}>Agregar empresa <span style={{ color: "var(--text3)", fontWeight: 700 }}>· cupo lleno, {cupo!.activas} de {cupo!.incluidas}</span></span>
            <span style={{ fontSize: 9, color: "var(--accent)" }}>Ver plan →</span>
          </button>
        )}

        {!enCuentaAjena && !multiempresa && (
          <button type="button" onClick={onIrAFacturacion} data-accion="business-cta"
            style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", marginTop: 4, padding: "9px 8px", borderRadius: 9, border: "1px dashed var(--border)", background: "transparent", color: "var(--text3)", fontSize: 11, fontWeight: 800, cursor: "pointer", textAlign: "left", fontFamily: "inherit", opacity: .6 }}>
            <span style={{ width: 30, height: 30, borderRadius: 9, display: "grid", placeItems: "center", background: "var(--bg-muted)", fontSize: 15, fontWeight: 700 }}>+</span>
            <span style={{ flex: 1 }}>Agregar empresa <span style={{ fontWeight: 700 }}>· hasta 3 con Business</span></span>
            <span style={{ fontSize: 9, color: "var(--accent)" }}>Ver plan →</span>
          </button>
        )}
      </div>
    </div>
  );
}
