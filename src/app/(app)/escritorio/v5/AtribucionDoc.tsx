"use client";

import { useEffect, useState } from "react";
import { atribucionDeDoc, type AtribucionDoc as Atribucion } from "./actions";
import { colorDeMiembro } from "./team-colores";

function haceCuanto(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.round(ms / 60_000);
  if (min < 1) return "recién";
  if (min < 60) return `hace ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `hace ${h} h`;
  const d = Math.round(h / 24);
  return `hace ${d} día${d === 1 ? "" : "s"}`;
}

/**
 * "Enviada a emitir por Matías · hace 2 h" sobre el visor del Check. Lee la
 * auditoría existente; solo aparece con equipo y si hay algo que decir. Si la
 * consulta falla, no aparece nada (modo de falla: nada visible).
 */
export default function AtribucionDoc({ documentoId, indiceColor = 0 }: { documentoId: string; indiceColor?: number }) {
  const [a, setA] = useState<Atribucion | null>(null);

  useEffect(() => {
    let vivo = true;
    void atribucionDeDoc(documentoId).then((r) => { if (vivo) setA(r); });
    return () => { vivo = false; };
  }, [documentoId]);

  if (!a) return null;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 16px 0", fontSize: 9.5, color: "var(--text3)", flexShrink: 0 }} title={new Date(a.at).toLocaleString("es-CL")}>
      <span aria-hidden style={{ width: 14, height: 14, borderRadius: 4, display: "grid", placeItems: "center", background: colorDeMiembro(indiceColor), color: "#fff", fontSize: 7, fontWeight: 900 }}>{a.iniciales}</span>
      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {a.accion} por <strong style={{ color: "var(--text2)", fontWeight: 700 }}>{a.nombre}</strong> · {haceCuanto(a.at)}
      </span>
    </div>
  );
}
