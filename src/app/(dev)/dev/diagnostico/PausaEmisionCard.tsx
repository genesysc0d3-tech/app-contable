"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { activarPausaEmision, levantarPausaEmision } from "../actions";
import { C } from "../colors";

/**
 * Tarjeta "Pausa de emisión" (kill switch, tanda 1 RPA 2026-09-10).
 *
 * Un carril por fila: boletas (39/41) y facturas (33/34). Cada fila dice si
 * está pausado, por qué, hasta cuándo y quién (o `auto` = el umbral de anclas
 * caídas en cambio-sii). Activar = 4 h con motivo obligatorio; Levantar =
 * apaga todas las pausas vivas del carril, incluidas las 'todo'.
 *
 * Datos ya vienen del servidor (page.tsx) — este componente solo dispara las
 * actions y refresca. Sin datos de clientes en pantalla: carril, motivo interno
 * del operador, fechas y correo del operador (o "auto").
 */
export interface PausaVista {
  id: string;
  carril: string;
  motivo_interno: string | null;
  hasta: string;
  origen: string;
  creado_por: string | null;
  created_at: string | null;
  activo: boolean;
}

const BTN_AMBAR = { border: "1px solid rgba(245,158,11,.45)", background: C.amberSoft, color: C.text } as const;
const BTN_ROJO = { border: "1px solid rgba(232,85,62,.6)", background: "rgba(232,85,62,.18)", color: C.accent } as const;
const BASE = { borderRadius: 7, padding: "7px 12px", fontSize: 11, fontWeight: 800, cursor: "pointer" } as const;

function fmt(iso: string | null | undefined) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("es-CL", { timeZone: "America/Santiago", hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" });
}

function CarrilRow({ carril, pausa, onCambio }: { carril: "boletas" | "facturas"; pausa: PausaVista | null; onCambio: () => void }) {
  const [motivo, setMotivo] = useState("");
  const [estado, setEstado] = useState<"idle" | "loading" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  async function correr(fn: () => Promise<{ error: string } | { ok: true }>) {
    if (estado === "loading") return;
    setEstado("loading");
    setError(null);
    const res = await fn();
    if ("error" in res) {
      setEstado("error");
      setError(res.error);
      return;
    }
    setEstado("idle");
    setMotivo("");
    onCambio();
  }

  const pausada = Boolean(pausa);
  const color = pausada ? C.accent : C.green;
  return (
    <div style={{ borderTop: `1px solid ${C.border}`, padding: "12px 0", display: "grid", gridTemplateColumns: "110px minmax(0, 1fr)", gap: 12, alignItems: "start" }}>
      <div>
        <div style={{ fontSize: 11, color: C.text3, textTransform: "uppercase", letterSpacing: ".07em", fontWeight: 800 }}>{carril}</div>
        <div style={{ marginTop: 4, color, fontSize: 13, fontWeight: 900 }}>{pausada ? "PAUSADA" : "emitiendo"}</div>
      </div>
      <div style={{ minWidth: 0 }}>
        {pausa ? (
          <>
            <div style={{ fontSize: 12, color: C.text, lineHeight: 1.5, overflowWrap: "anywhere" }}>
              {pausa.motivo_interno ?? "sin motivo"}
              {pausa.carril === "todo" ? <span style={{ color: C.text3 }}> · pausa de TODO</span> : null}
            </div>
            <div style={{ marginTop: 3, fontSize: 11, color: C.text3 }}>
              hasta {fmt(pausa.hasta)} · {pausa.origen === "auto" ? "auto (umbral cambio SII)" : `manual · ${pausa.creado_por ?? "operador"}`} · desde {fmt(pausa.created_at)}
            </div>
            <div style={{ marginTop: 8, display: "flex", gap: 8, alignItems: "center" }}>
              <button type="button" disabled={estado === "loading"} onClick={() => correr(() => levantarPausaEmision(carril))} style={{ ...BASE, ...BTN_AMBAR }}>
                {estado === "loading" ? "…" : "Levantar"}
              </button>
              <span style={{ fontSize: 11, color: C.text3 }}>Vuelve a emitir al tiro para todas las empresas.</span>
            </div>
          </>
        ) : (
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <input
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              placeholder="Motivo interno (obligatorio)"
              maxLength={300}
              style={{ flex: "1 1 220px", minWidth: 0, background: C.muted, border: `1px solid ${C.border}`, borderRadius: 7, padding: "7px 10px", color: C.text, fontSize: 12 }}
            />
            <button type="button" disabled={estado === "loading" || !motivo.trim()} onClick={() => correr(() => activarPausaEmision(carril, motivo))} style={{ ...BASE, ...BTN_ROJO, opacity: motivo.trim() ? 1 : 0.5 }}>
              {estado === "loading" ? "…" : "Activar 4 h"}
            </button>
          </div>
        )}
        {error ? <div style={{ marginTop: 6, fontSize: 11, color: C.accent }}>{error}</div> : null}
      </div>
    </div>
  );
}

export function PausaEmisionCard({ vivas, historial, errorLectura }: { vivas: PausaVista[]; historial: PausaVista[]; errorLectura: string | null }) {
  const router = useRouter();
  const onCambio = () => router.refresh();
  // "Viva" = está entre las vivas que calculó el SERVER (no Date.now() en el
  // render: el compilador de React lo marca impuro y además el reloj del
  // cliente no es el que manda en el gate).
  const vivasIds = new Set(vivas.map((p) => p.id));
  // Una pausa 'todo' cubre ambos carriles; una del carril, solo el suyo.
  const paraCarril = (c: "boletas" | "facturas") => vivas.find((p) => p.carril === c || p.carril === "todo") ?? null;
  return (
    <div>
      {errorLectura ? (
        <div style={{ color: C.accent, fontSize: 12, fontWeight: 800, marginBottom: 6 }}>
          No se pudo leer emision_pausas ({errorLectura}). OJO: el gate es fail-closed — si esta consulta falla en el server, NADIE emite.
        </div>
      ) : null}
      <CarrilRow carril="boletas" pausa={paraCarril("boletas")} onCambio={onCambio} />
      <CarrilRow carril="facturas" pausa={paraCarril("facturas")} onCambio={onCambio} />
      {historial.length > 0 ? (
        <div style={{ marginTop: 12, borderTop: `1px solid ${C.border}`, paddingTop: 10 }}>
          <div style={{ fontSize: 11, color: C.text3, textTransform: "uppercase", letterSpacing: ".07em", fontWeight: 900 }}>Historial</div>
          <div style={{ marginTop: 6, display: "flex", flexDirection: "column", gap: 4 }}>
            {historial.map((p) => {
              const vigente = vivasIds.has(p.id);
              return (
                <div key={p.id} style={{ fontSize: 11, color: vigente ? C.text : C.text3, display: "grid", gridTemplateColumns: "72px 60px minmax(0,1fr)", gap: 8 }}>
                  <span>{fmt(p.created_at)}</span>
                  <span style={{ fontWeight: 800 }}>{p.carril}</span>
                  <span style={{ overflowWrap: "anywhere" }}>
                    {vigente ? "VIVA" : p.activo ? "vencida" : "levantada"} · {p.origen} · {p.creado_por ?? "—"} · {p.motivo_interno ?? "sin motivo"}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}
