"use client";

import { useState } from "react";
import EmisorForm from "@/app/(app)/empresa/EmisorForm";
import { datosEmisorDeEmpresa, type DatosEmisor } from "@/app/(app)/empresa/actions";
import EmpresasCuentaPanel from "./EmpresasCuentaPanel";
import type { EmpresasSelectorResult } from "./actions";

/**
 * Paso Emisor del wizard (fundador 2026-09-07): arriba el formulario del
 * emisor; abajo las empresas de la cuenta. Elegir otra empresa abre SU
 * emisor acá mismo — es configuración, no cambia la mesa. Al cambiar de
 * empresa se guarda lo pendiente primero (el mismo auto-guardado awaitable
 * que usa el popup al cambiar de paso), y si la validación falla no se cambia.
 */
export default function EmisorStep({ inicial, empresaId, submitRef, onIrAFacturacion, semillaEmpresas = null }: {
  inicial: DatosEmisor;
  /** La empresa activa (la de la mesa). */
  empresaId: string;
  submitRef: React.MutableRefObject<(() => Promise<boolean>) | null>;
  onIrAFacturacion: () => void;
  /** Selector ya cargado por la página: la lista aparece al tiro, sin fetch. */
  semillaEmpresas?: EmpresasSelectorResult | null;
}) {
  const [otra, setOtra] = useState<{ id: string; datos: DatosEmisor; nombre: string } | null>(null);
  const [cargando, setCargando] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  // "+ Agregar": el mismo formulario, vacío; se crea al guardar.
  const [nueva, setNueva] = useState(false);
  const vacio: DatosEmisor = { rut: null, razon_social: "", giro: "", direccion: "", comuna: "", email_sii: "", tipo_contribuyente: "auto", operacion_hint_default: null };

  async function elegir(id: string) {
    if (cargando) return;
    if (!nueva && id === (otra?.id ?? empresaId)) return;
    setError(null);
    // Guardar lo que hay antes de soltar el formulario actual.
    const submit = submitRef.current;
    if (submit && !(await submit())) return;
    setNueva(false);
    if (id === empresaId) { setOtra(null); return; }
    setCargando(id);
    const r = await datosEmisorDeEmpresa(id);
    setCargando(null);
    if (!r.ok) { setError("No se pudo abrir esa empresa. Si el problema sigue, cámbiala desde el logo."); return; }
    setOtra({ id, datos: r.datos, nombre: r.razon_social });
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
      {/* Selector ARRIBA (segunda vuelta del fundador): eliges la empresa y el
          formulario de abajo es el suyo. Solo Business; si no, no se pinta. */}
      <EmpresasCuentaPanel
        enEdicion={otra?.id ?? null}
        nuevaActiva={nueva}
        onElegir={(id) => { void elegir(id); }}
        onAgregar={async () => {
          if (nueva) return;
          // Guardar lo pendiente de la empresa actual antes de abrir la nueva.
          const submit = submitRef.current;
          if (submit && !(await submit())) return;
          setNueva(true);
        }}
        onIrAFacturacion={onIrAFacturacion}
        refreshKey={refreshKey}
        semilla={semillaEmpresas}
      />
      {nueva && (
        <div data-aviso="nueva-empresa" style={{ display: "flex", alignItems: "center", gap: 8, margin: "0 2px 10px", fontSize: 10.5, color: "var(--text2)", lineHeight: 1.4 }}>
          <span style={{ flex: 1, minWidth: 0 }}><b style={{ color: "var(--text)" }}>Empresa nueva</b> · llena sus datos; se crea al guardar. La mesa sigue en la activa.</span>
          <button type="button" onClick={() => { setNueva(false); }}
            style={{ flexShrink: 0, border: "none", background: "transparent", color: "var(--accent)", fontSize: 10, fontWeight: 800, cursor: "pointer", fontFamily: "inherit", padding: 0 }}>
            Cancelar
          </button>
        </div>
      )}
      {!nueva && otra && (
        <div data-aviso="editando-otra" style={{ display: "flex", alignItems: "center", gap: 8, margin: "0 2px 10px", fontSize: 10.5, color: "var(--text2)", lineHeight: 1.4 }}>
          <span style={{ flex: 1, minWidth: 0 }}>Configurando <b style={{ color: "var(--text)" }}>{otra.nombre}</b> · la mesa sigue en la empresa activa.</span>
          <button type="button" onClick={() => { void elegir(empresaId); }}
            style={{ flexShrink: 0, border: "none", background: "transparent", color: "var(--accent)", fontSize: 10, fontWeight: 800, cursor: "pointer", fontFamily: "inherit", padding: 0 }}>
            ← Volver a la activa
          </button>
        </div>
      )}
      {cargando && <div style={{ margin: "0 2px 8px", fontSize: 10, color: "var(--text3)" }}>Abriendo la empresa…</div>}
      {error && <div style={{ margin: "0 2px 8px", color: "var(--red)", fontSize: 10, lineHeight: 1.4 }}>{error}</div>}
      {nueva
        ? <EmisorForm key="nueva" inicial={vacio} variant="popup" submitRef={submitRef} modo="crear" onCreada={(id) => { setNueva(false); setRefreshKey((k) => k + 1); void elegir(id); }} />
        : otra
          ? <EmisorForm key={otra.id} inicial={otra.datos} variant="popup" submitRef={submitRef} empresaId={otra.id} />
          : <EmisorForm key={empresaId} inicial={inicial} variant="popup" submitRef={submitRef} />}
    </div>
  );
}
