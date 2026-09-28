"use client";

import { useState } from "react";
import { useToast } from "@/components/Toast";
import { formatShortDateEsCl } from "@/lib/display-date";
import { fechaIsoValida, type ResumenCuadre } from "@/lib/cartola/cuadre-mesa";
import { fmt } from "./revisar-shared";
import { agregarFilasFaltantes } from "./cuadre-actions";

// CUADRE DE CARTOLA en el visor (pasos 2 y 3). Una línea cuando todo cuadra
// ("500 de 500 ✓"); cuando hay filas con plata que no llegaron a la mesa, un
// aviso ámbar con la lista y el botón "Agregarlos". Advertir sí, bloquear
// jamás: Aprobar sigue su camino con lo que ya está en la mesa.

const VISIBLES = 3;

export default function CuadreCartolaLinea({ documentoId, resumen, onAgregado }: {
  documentoId: string;
  resumen: ResumenCuadre;
  onAgregado?: () => void;
}) {
  const { toast } = useToast();
  const [agregando, setAgregando] = useState(false);
  const [verTodas, setVerTodas] = useState(false);
  const r = resumen;

  const agregar = async () => {
    if (agregando) return;
    setAgregando(true);
    try {
      const res = await agregarFilasFaltantes(documentoId);
      if (!res.ok) { toast(res.error, "error"); return; }
      toast(res.yaEstaban
        ? "Ya estaban agregadas"
        : `${res.agregadas === 1 ? "1 movimiento agregado" : `${res.agregadas} movimientos agregados`} — quedaron pendientes para revisar`);
      onAgregado?.();
    } catch {
      toast("Error de conexión — intenta de nuevo", "error");
    } finally {
      setAgregando(false);
    }
  };

  const otrasHojas = r.otrasHojas.length > 0 && (
    <div style={{ marginTop: "0.35em", fontSize: "0.8em", color: "var(--text3)", lineHeight: 1.4 }}>
      Tu archivo trae {r.otrasHojas.length === 1 ? "otra hoja" : "otras hojas"} con movimientos ({r.otrasHojas.join(", ")}) que no se {r.otrasHojas.length === 1 ? "leyó" : "leyeron"}.
    </div>
  );

  if (r.estado === "cuadra") {
    return (
      <>
        <div title={r.duplicadas > 0 ? `Incluye ${r.duplicadas} ${r.duplicadas === 1 ? "repetida que no se duplicó" : "repetidas que no se duplicaron"}` : "Toda fila con plata de tu cartola está en la mesa"}
          style={{ marginTop: "0.55em", display: "flex", alignItems: "baseline", gap: 6, fontSize: "0.85em", color: "var(--text3)" }}>
          <span>Cuadre</span>
          <b style={{ color: "var(--text2)" }}>{r.enSuLugar} de {r.esperadas}</b>
          <span style={{ color: "var(--green)", fontWeight: 800 }}>✓</span>
          {r.duplicadas > 0 && <span>· {r.duplicadas} {r.duplicadas === 1 ? "repetida" : "repetidas"}</span>}
        </div>
        {otrasHojas}
      </>
    );
  }

  if (r.estado === "no_calza") {
    return (
      <>
        <div style={{ marginTop: "0.55em", display: "flex", alignItems: "center", gap: 6, fontSize: "0.85em", color: "var(--text2)" }}>
          <span style={{ width: "0.5em", height: "0.5em", borderRadius: "50%", background: "var(--amber)", flexShrink: 0 }} />
          Lo guardado no calza con lo que leímos de tu archivo. Ya nos llegó el aviso.
        </div>
        {otrasHojas}
      </>
    );
  }

  const filas = verTodas ? r.filas : r.filas.slice(0, VISIBLES);
  const manuales = r.faltan - r.agregables;
  return (
    <>
      <div style={{ marginTop: "0.6em", padding: "0.55em 0.8em", borderRadius: 9, background: "color-mix(in srgb, var(--amber) 9%, transparent)", border: "1px solid color-mix(in srgb, var(--amber) 28%, transparent)", fontSize: "0.85em", lineHeight: 1.45, color: "var(--text)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ width: "0.5em", height: "0.5em", borderRadius: "50%", background: "var(--amber)", flexShrink: 0 }} />
          <span style={{ minWidth: 0 }}>
            <b style={{ color: "var(--amber)" }}>Faltan {r.faltan} por {fmt(r.montoFaltan)}</b>
            <span style={{ color: "var(--text3)" }}> · {r.enSuLugar} de {r.esperadas} en la mesa</span>
          </span>
          {r.agregables > 0 && (
            <button onClick={agregar} disabled={agregando}
              title="Las agrega a la mesa como pendientes, para que las revises en Editar"
              style={{ marginLeft: "auto", flexShrink: 0, border: "1px solid color-mix(in srgb, var(--amber) 45%, transparent)", borderRadius: 8, background: "color-mix(in srgb, var(--amber) 14%, transparent)", color: "var(--text)", fontSize: "0.95em", fontWeight: 700, padding: "0.3em 0.85em", cursor: agregando ? "default" : "pointer", opacity: agregando ? 0.6 : 1 }}>
              {agregando ? "Agregando…" : r.agregables === 1 ? "Agregarla" : "Agregarlos"}
            </button>
          )}
        </div>
        <div style={{ marginTop: "0.35em", display: "grid", gridTemplateColumns: "auto minmax(0,1fr) auto auto", columnGap: 10, rowGap: 2, fontSize: "0.94em" }}>
          {filas.map((f) => (
            <div key={f.idx} style={{ display: "contents" }}>
              <span style={{ color: "var(--text3)", whiteSpace: "nowrap" }}>{fechaIsoValida(f.fecha) ? formatShortDateEsCl(f.fecha) : "Sin fecha"}</span>
              <span title={f.excelRow != null ? `Fila ${f.excelRow} de tu archivo` : undefined} style={{ color: "var(--text2)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.glosa}</span>
              <b style={{ textAlign: "right", whiteSpace: "nowrap", color: f.tipoFlujo === "salida" ? "var(--text2)" : "var(--text)" }}>{f.tipoFlujo === "salida" ? "−" : ""}{fmt(f.monto)}</b>
              <span style={{ color: "var(--text3)", whiteSpace: "nowrap" }}>{f.motivo}</span>
            </div>
          ))}
        </div>
        {r.filas.length > VISIBLES && (
          <button onClick={() => setVerTodas((v) => !v)} style={{ marginTop: 2, border: "none", background: "transparent", padding: 0, color: "var(--text3)", fontSize: "0.94em", cursor: "pointer", textDecoration: "underline" }}>
            {verTodas ? "Ver menos" : `Ver las ${r.filas.length}`}
          </button>
        )}
        {manuales > 0 && (
          <div style={{ marginTop: 2, color: "var(--text3)", fontSize: "0.94em" }}>
            {manuales === r.faltan
              ? "No traen fecha o no se sabe si son abono o cargo: revísalas en tu archivo."
              : manuales === 1
                ? "1 no trae fecha o no se sabe si es abono o cargo: revísala en tu archivo."
                : `${manuales} no traen fecha o no se sabe si son abono o cargo: revísalas en tu archivo.`}
          </div>
        )}
      </div>
      {otrasHojas}
    </>
  );
}
