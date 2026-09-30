"use client";

import { useState } from "react";
import { useToast } from "@/components/Toast";
import { formatShortDateEsCl } from "@/lib/display-date";
import { fechaIsoValida } from "@/lib/cartola/cuadre-mesa";
import { seVeBienPermitido } from "@/lib/cartola/verificacion";
import type { CuadreCartola } from "@/lib/cartola/cuadre";
import { fmt } from "./revisar-shared";
import { confirmarLecturaCartola } from "./lectura-actions";

// "ASÍ LA LEÍMOS" (lector con juez, 2026-09-30). Cuando una cartola no trae con
// qué comprobarse (sin saldo ni totales del banco) o su formato es nuevo, el
// visor muestra 3 movimientos tal como los leímos y deja que el cliente lo
// confirme con un toque, corrija las columnas o escriba el saldo final que ve
// en su banco. Advertir sí, bloquear jamás: Aprobar sigue su camino.

const campo = {
  width: "100%", minWidth: 0, boxSizing: "border-box" as const, padding: "0.45em 0.7em", borderRadius: 8,
  border: "1px solid var(--border)", background: "var(--surface2, transparent)", color: "var(--text)", fontSize: "0.95em",
};
const boton = (primario: boolean) => ({
  border: `1px solid ${primario ? "color-mix(in srgb, var(--green) 45%, transparent)" : "var(--border)"}`,
  borderRadius: 8,
  background: primario ? "color-mix(in srgb, var(--green) 14%, transparent)" : "transparent",
  color: "var(--text)", fontSize: "0.95em", fontWeight: 700, padding: "0.35em 0.9em", cursor: "pointer",
});

/** "$ 1.234.567" / "1234567" / "1.234.567" → número (CLP, sin decimales). */
function leerPesos(s: string): number | null {
  const limpio = s.replace(/[$\s.]/g, "").replace(/,\d{1,2}$/, "");
  if (!/^-?\d+$/.test(limpio)) return null;
  return parseInt(limpio, 10);
}

export default function LecturaMuestra({ documentoId, cuadre, onCorregirColumnas, onConfirmado }: {
  documentoId: string;
  cuadre: CuadreCartola;
  /** Abre el mapeador de columnas (FieldMapper) que ya existe. */
  onCorregirColumnas?: () => void;
  onConfirmado?: () => void;
}) {
  const { toast } = useToast();
  const [ocupado, setOcupado] = useState(false);
  const [saldoFinal, setSaldoFinal] = useState("");
  const [saldoInicial, setSaldoInicial] = useState("");
  const [pedirInicial, setPedirInicial] = useState(cuadre.saldo_inicial == null && !cuadre.cuenta);
  const [error, setError] = useState<string | null>(null);
  const muestra = cuadre.muestra ?? [];
  const alerta = cuadre.verificacion?.alerta === true;
  // Con alerta o filas perdidas, 3 filas de muestra no prueban nada: sin "Se ve bien".
  const puedeSeVeBien = seVeBienPermitido(cuadre).ok;
  const cambio = cuadre.mapa?.cambio_formato;

  const enviar = async (input: Parameters<typeof confirmarLecturaCartola>[1]) => {
    if (ocupado) return;
    setOcupado(true);
    setError(null);
    try {
      const r = await confirmarLecturaCartola(documentoId, input);
      if (!r.ok) {
        if (r.necesitaSaldoInicial) setPedirInicial(true);
        setError(r.error);
        return;
      }
      toast(r.mensaje);
      onConfirmado?.();
    } catch {
      setError("Error de conexión — intenta de nuevo");
    } finally {
      setOcupado(false);
    }
  };

  const comprobar = () => {
    const f = leerPesos(saldoFinal);
    if (f == null) { setError("Escribe el saldo final como número, por ejemplo 1.234.567"); return; }
    const i = saldoInicial.trim() ? leerPesos(saldoInicial) : null;
    if (saldoInicial.trim() && i == null) { setError("El saldo al inicio tiene que ser un número"); return; }
    void enviar({ accion: "saldo", saldoFinal: f, saldoInicial: i });
  };

  return (
    <div data-testid="lectura-muestra" style={{ marginTop: "0.6em", padding: "0.6em 0.8em", borderRadius: 9, background: "color-mix(in srgb, var(--amber) 8%, transparent)", border: "1px solid color-mix(in srgb, var(--amber) 26%, transparent)", fontSize: "0.85em", lineHeight: 1.45, color: "var(--text)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ width: "0.5em", height: "0.5em", borderRadius: "50%", background: "var(--amber)", flexShrink: 0 }} />
        <b>Revisa cómo leímos tu cartola</b>
      </div>
      <div style={{ marginTop: 2, color: "var(--text3)" }}>
        {cambio
          ? "Tu banco cambió el formato del archivo. Mira si estos movimientos quedaron bien."
          : alerta
            ? "Algo no nos calzó al leerla. Mira si estos movimientos quedaron bien."
            : "No trae saldo ni totales del banco, así que no pudimos comprobarla solos."}
      </div>

      {muestra.length > 0 && (
        <>
          <div style={{ marginTop: "0.45em", color: "var(--text2)", fontWeight: 700 }}>Así la leímos</div>
          <div style={{ marginTop: 2, display: "grid", gridTemplateColumns: "auto minmax(0,1fr) auto", columnGap: 10, rowGap: 2 }}>
            {muestra.map((m, i) => (
              <div key={`${m.excel_row ?? i}`} style={{ display: "contents" }}>
                <span style={{ color: "var(--text3)", whiteSpace: "nowrap" }}>{fechaIsoValida(m.fecha) ? formatShortDateEsCl(m.fecha) : m.fecha}</span>
                <span title={m.excel_row != null ? `Fila ${m.excel_row} de tu archivo` : undefined} style={{ color: "var(--text2)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.descripcion || "(sin glosa)"}</span>
                <b style={{ textAlign: "right", whiteSpace: "nowrap", color: m.tipo_flujo === "entrada" ? "var(--green)" : "var(--text2)" }}>
                  {m.tipo_flujo === "entrada" ? "+" : "−"}{fmt(m.monto)}
                </b>
              </div>
            ))}
          </div>
          <div style={{ marginTop: 2, color: "var(--text3)", fontSize: "0.94em" }}>En verde lo que entró a tu cuenta; lo otro, lo que salió.</div>
        </>
      )}

      <div style={{ marginTop: "0.55em", display: "flex", flexWrap: "wrap", gap: 8 }}>
        {puedeSeVeBien && (
          <button onClick={() => void enviar({ accion: "se_ve_bien" })} disabled={ocupado} style={{ ...boton(true), opacity: ocupado ? 0.6 : 1 }}>
            Se ve bien
          </button>
        )}
        {onCorregirColumnas && (
          <button onClick={onCorregirColumnas} disabled={ocupado} style={boton(false)}>
            Corregir columnas
          </button>
        )}
      </div>

      <div style={{ marginTop: "0.6em", borderTop: "1px solid var(--border)", paddingTop: "0.5em" }}>
        <label htmlFor={`saldo-final-${documentoId}`} style={{ display: "block", color: "var(--text2)" }}>
          Saldo final en tu portal del banco <span style={{ color: "var(--text3)" }}>(opcional)</span>
        </label>
        <div style={{ marginTop: 4, display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
          <input id={`saldo-final-${documentoId}`} inputMode="numeric" placeholder="$ 1.234.567" value={saldoFinal}
            onChange={(e) => setSaldoFinal(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") comprobar(); }}
            style={{ ...campo, flex: "1 1 9em" }} />
          {pedirInicial && (
            <input aria-label="Saldo al inicio del período" inputMode="numeric" placeholder="Saldo al inicio" value={saldoInicial}
              onChange={(e) => setSaldoInicial(e.target.value)} style={{ ...campo, flex: "1 1 9em" }} />
          )}
          <button onClick={comprobar} disabled={ocupado || !saldoFinal.trim()} style={{ ...boton(false), opacity: ocupado || !saldoFinal.trim() ? 0.6 : 1 }}>
            {ocupado ? "Revisando…" : "Comprobar"}
          </button>
        </div>
        {pedirInicial && (
          <div style={{ marginTop: 2, color: "var(--text3)", fontSize: "0.94em" }}>
            Si no sabes el saldo al inicio, déjalo en blanco: usamos el final de tu cartola anterior de la misma cuenta.
          </div>
        )}
        {error && <div role="alert" style={{ marginTop: 4, color: "var(--amber)" }}>{error}</div>}
      </div>
    </div>
  );
}
