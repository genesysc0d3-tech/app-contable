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

  async function elegir(id: string) {
    if (cargando) return;
    if (id === (otra?.id ?? empresaId)) return;
    setError(null);
    // Guardar lo que hay antes de soltar el formulario actual.
    const submit = submitRef.current;
    if (submit && !(await submit())) return;
    if (id === empresaId) { setOtra(null); return; }
    setCargando(id);
    const r = await datosEmisorDeEmpresa(id);
    setCargando(null);
    if (!r.ok) { setError("No se pudo abrir esa empresa. Si el problema sigue, cámbiala desde el logo."); return; }
    setOtra({ id, datos: r.datos, nombre: r.razon_social });
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
      {otra && (
        <div data-aviso="editando-otra" style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10, padding: "8px 10px", borderRadius: 10, border: "1px solid rgba(232,85,62,.35)", background: "var(--accent-light)", fontSize: 10.5, color: "var(--text)", lineHeight: 1.4 }}>
          <span style={{ flex: 1, minWidth: 0 }}>
            Configurando <b>{otra.nombre}</b> · la mesa sigue en la empresa activa.
          </span>
          <button type="button" onClick={() => { void elegir(empresaId); }}
            style={{ flexShrink: 0, border: "1px solid var(--border)", borderRadius: 8, padding: "5px 9px", background: "var(--surface)", color: "var(--text2)", fontSize: 10, fontWeight: 800, cursor: "pointer", fontFamily: "inherit" }}>
            ← Volver a la activa
          </button>
        </div>
      )}
      {otra
        ? <EmisorForm key={otra.id} inicial={otra.datos} variant="popup" submitRef={submitRef} empresaId={otra.id} />
        : <EmisorForm key={empresaId} inicial={inicial} variant="popup" submitRef={submitRef} />}
      {error && <div style={{ margin: "8px 2px 0", color: "var(--red)", fontSize: 10, lineHeight: 1.4 }}>{error}</div>}
      <EmpresasCuentaPanel
        enEdicion={otra?.id ?? null}
        onElegir={(id) => { void elegir(id); }}
        onCreada={(id) => { setRefreshKey((k) => k + 1); void elegir(id); }}
        onIrAFacturacion={onIrAFacturacion}
        refreshKey={refreshKey}
        semilla={semillaEmpresas}
      />
      {cargando && <div style={{ margin: "6px 2px 0", fontSize: 10, color: "var(--text3)" }}>Abriendo la empresa…</div>}
    </div>
  );
}
