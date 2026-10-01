"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AvisoVista } from "@/components/AvisoVista";
import { avisoVigente, CUERPO_MAX, TITULO_MAX, validarAvisoInput, type AvisoApp, type AvisoInput, type FormatoAviso, type TipoAviso } from "@/lib/avisos/reglas";
import { C } from "../colors";
import { desactivarAviso, guardarAviso } from "./actions";
import { horaChileAIso, isoAHoraChile } from "./fechas";

export type AvisoFila = AvisoApp & { empresa_ids: string[] | null; activo: boolean; creado_por: string | null; vistos: number };

type Form = {
  tipo: TipoAviso;
  formato: FormatoAviso;
  titulo: string;
  cuerpo: string;
  /** "YYYY-MM-DDTHH:mm" hora de Chile. */
  desde: string;
  hasta: string;
  empresas: string;
  mesa: "" | "boletas" | "facturas";
  versionMin: string;
};

const DIA_MS = 24 * 60 * 60 * 1000;
const TIPO_LABEL: Record<TipoAviso, string> = { novedad: "Novedad", mantencion: "Mantención", urgente: "Urgente" };
const FORMATO_LABEL: Record<FormatoAviso, string> = { toast: "Toast (8 s, abajo a la izquierda)", tarjeta: "Tarjeta (esquina, «Entendido»)", popup: "Popup centrado (solo urgentes)" };

function formVacio(ahoraIso: string): Form {
  const ahora = Date.parse(ahoraIso);
  return {
    tipo: "novedad",
    formato: "toast",
    titulo: "",
    cuerpo: "",
    desde: isoAHoraChile(new Date(ahora).toISOString()),
    hasta: isoAHoraChile(new Date(ahora + 7 * DIA_MS).toISOString()),
    empresas: "",
    mesa: "",
    versionMin: "",
  };
}

function formDe(a: AvisoFila): Form {
  return {
    tipo: a.tipo,
    formato: a.formato,
    titulo: a.titulo,
    cuerpo: a.cuerpo,
    desde: isoAHoraChile(a.desde),
    hasta: isoAHoraChile(a.hasta),
    empresas: (a.empresa_ids ?? []).join("\n"),
    mesa: a.mesa ?? "",
    versionMin: a.version_min ?? "",
  };
}

function aInput(f: Form): AvisoInput {
  return {
    tipo: f.tipo,
    formato: f.formato,
    titulo: f.titulo,
    cuerpo: f.cuerpo,
    desde: horaChileAIso(f.desde),
    hasta: horaChileAIso(f.hasta),
    empresaIds: f.empresas.split(/[\s,;]+/).map((x) => x.trim()).filter(Boolean),
    mesa: f.mesa || null,
    versionMin: f.versionMin,
  };
}

function fmt(iso: string | null | undefined) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("es-CL", { timeZone: "America/Santiago", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

const INPUT = { width: "100%", minWidth: 0, background: C.muted, border: `1px solid ${C.border}`, borderRadius: 7, padding: "7px 10px", color: C.text, fontSize: 12, fontFamily: "inherit" } as const;
const LABEL = { display: "flex", flexDirection: "column", gap: 4, fontSize: 10.5, color: C.text3, textTransform: "uppercase", letterSpacing: ".06em", fontWeight: 800 } as const;
const BASE = { borderRadius: 7, padding: "7px 12px", fontSize: 11, fontWeight: 800, cursor: "pointer" } as const;
const BTN_ROJO = { ...BASE, border: "1px solid rgba(232,85,62,.6)", background: "rgba(232,85,62,.18)", color: C.accent } as const;
const BTN_GRIS = { ...BASE, border: `1px solid ${C.border}`, background: C.muted, color: C.text2 } as const;

export function AvisosEditor({
  avisos,
  ahoraIso,
  versionActual,
  commitActual,
  deshabilitado,
}: {
  avisos: AvisoFila[];
  ahoraIso: string;
  versionActual: string;
  /** Fecha del commit publicado (null si el build no la supo: se propone el SHA exacto). */
  commitActual: string | null;
  deshabilitado: boolean;
}) {
  const router = useRouter();
  const [form, setForm] = useState<Form>(() => formVacio(ahoraIso));
  const [editando, setEditando] = useState<string | null>(null);
  const [estado, setEstado] = useState<"idle" | "loading">("idle");
  const [mensaje, setMensaje] = useState<{ tono: "ok" | "error"; texto: string } | null>(null);

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => {
    const n = { ...f, [k]: v };
    // Popup solo urgente: cambiar a urgente sugiere popup; dejar de ser urgente lo baja.
    if (k === "tipo") n.formato = v === "urgente" ? "popup" : f.formato === "popup" ? "toast" : f.formato;
    return n;
  });

  const input = aInput(form);
  const validacion = validarAvisoInput(input);
  const previa: AvisoApp = useMemo(() => ({
    id: "vista-previa",
    tipo: form.tipo,
    formato: form.formato,
    titulo: form.titulo.trim() || "Título del aviso",
    cuerpo: form.cuerpo,
    desde: input.desde,
    hasta: input.hasta,
    mesa: null,
    version_min: form.versionMin.trim() || null,
    created_at: null,
  }), [form, input.desde, input.hasta]);

  async function guardar() {
    if (estado === "loading" || !validacion.ok) return;
    // Un aviso URGENTE a TODAS las empresas (cualquier formato) le llega a todas las
    // clientas: confirmación explícita (el server también la exige).
    const paraTodas = validacion.fila.tipo === "urgente" && validacion.fila.empresa_ids === null;
    if (paraTodas && !window.confirm(`Vas a mostrar un AVISO URGENTE (${validacion.fila.formato}) a TODAS las empresas:\n\n«${validacion.fila.titulo}»\n\n¿Publicar?`)) return;
    setEstado("loading");
    setMensaje(null);
    const r = await guardarAviso(editando, input, { confirmadoParaTodas: paraTodas });
    setEstado("idle");
    if ("error" in r) { setMensaje({ tono: "error", texto: r.error }); return; }
    setMensaje({ tono: "ok", texto: editando ? "Aviso actualizado." : "Aviso creado. Sale en la próxima carga de la mesa (≤ 1 min)." });
    setEditando(null);
    setForm(formVacio(new Date().toISOString()));
    router.refresh();
  }

  async function desactivar(id: string) {
    if (estado === "loading") return;
    setEstado("loading");
    const r = await desactivarAviso(id);
    setEstado("idle");
    if ("error" in r) { setMensaje({ tono: "error", texto: r.error }); return; }
    setMensaje({ tono: "ok", texto: "Aviso desactivado." });
    if (editando === id) { setEditando(null); setForm(formVacio(new Date().toISOString())); }
    router.refresh();
  }

  const ahoraMs = Date.parse(ahoraIso);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 16, alignItems: "start" }}>
        {/* Formulario */}
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ fontSize: 12, fontWeight: 900, color: editando ? C.amber : C.text }}>{editando ? "Editando aviso" : "Nuevo aviso"}</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <label style={LABEL}>Tipo
              <select value={form.tipo} onChange={(e) => set("tipo", e.target.value as TipoAviso)} style={INPUT}>
                {(Object.keys(TIPO_LABEL) as TipoAviso[]).map((t) => <option key={t} value={t}>{TIPO_LABEL[t]}</option>)}
              </select>
            </label>
            <label style={LABEL}>Formato
              <select value={form.formato} onChange={(e) => set("formato", e.target.value as FormatoAviso)} style={INPUT}>
                {(Object.keys(FORMATO_LABEL) as FormatoAviso[]).map((f) => (
                  <option key={f} value={f} disabled={f === "popup" && form.tipo !== "urgente"}>{FORMATO_LABEL[f]}</option>
                ))}
              </select>
            </label>
          </div>
          <label style={LABEL}>Título ({form.titulo.trim().length}/{TITULO_MAX})
            <input value={form.titulo} maxLength={TITULO_MAX} onChange={(e) => set("titulo", e.target.value)} placeholder="Ej: El SII está con problemas" style={INPUT} />
          </label>
          <label style={LABEL}>Texto ({form.cuerpo.length}/{CUERPO_MAX}) · **negrita** y [link](https://…)
            <textarea value={form.cuerpo} maxLength={CUERPO_MAX} rows={4} onChange={(e) => set("cuerpo", e.target.value)} placeholder="Ej: Espera un rato antes de emitir. Tus boletas quedan listas y no se pierde nada." style={{ ...INPUT, resize: "vertical", lineHeight: 1.5 }} />
          </label>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <label style={LABEL}>Desde (hora Chile)
              <input type="datetime-local" value={form.desde} onChange={(e) => set("desde", e.target.value)} style={INPUT} />
            </label>
            <label style={LABEL}>Hasta (hora Chile)
              <input type="datetime-local" value={form.hasta} onChange={(e) => set("hasta", e.target.value)} style={INPUT} />
            </label>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <label style={LABEL}>Mesa
              <select value={form.mesa} onChange={(e) => set("mesa", e.target.value as Form["mesa"])} style={INPUT}>
                <option value="">En cualquier parte</option>
                <option value="boletas">Solo mirando Boletas</option>
                <option value="facturas">Solo mirando Facturas</option>
              </select>
            </label>
            <label style={LABEL}>Versión mínima (opcional)
              <input value={form.versionMin} onChange={(e) => set("versionMin", e.target.value)} placeholder="vacío = cualquier versión" style={INPUT} />
            </label>
          </div>
          <div style={{ fontSize: 11, color: C.text3, lineHeight: 1.5 }}>
            Publicada ahora: <b style={{ color: C.text2 }}>{versionActual}</b>{commitActual ? <> · commit del {fmt(commitActual)}</> : null}.{" "}
            {commitActual || /^[0-9a-f]{7,}$/i.test(versionActual) ? (
              <button type="button" onClick={() => set("versionMin", commitActual ?? versionActual)} style={{ ...BTN_GRIS, padding: "3px 8px", fontSize: 10.5 }}>
                Usar esta versión
              </button>
            ) : null}{" "}
            Con versión mínima solo lo ven las pestañas que ya corren esa versión: con fecha de commit, esa o una más nueva; con SHA, solo esa exacta («Novedades de esta versión»).
          </div>
          <label style={LABEL}>Empresas (IDs, uno por línea · vacío = todas)
            <textarea value={form.empresas} rows={2} onChange={(e) => set("empresas", e.target.value)} placeholder="vacío = todas las empresas" style={{ ...INPUT, fontFamily: "ui-monospace, monospace", fontSize: 11 }} />
          </label>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <button type="button" onClick={guardar} disabled={deshabilitado || estado === "loading" || !validacion.ok} style={{ ...BTN_ROJO, opacity: deshabilitado || !validacion.ok ? 0.5 : 1 }}>
              {estado === "loading" ? "…" : editando ? "Guardar cambios" : "Publicar aviso"}
            </button>
            {editando ? (
              <button type="button" onClick={() => { setEditando(null); setForm(formVacio(new Date().toISOString())); }} style={BTN_GRIS}>Cancelar edición</button>
            ) : null}
            {!validacion.ok && form.titulo.trim() ? <span style={{ fontSize: 11, color: C.amber }}>{validacion.error}</span> : null}
            {mensaje ? <span style={{ fontSize: 11, color: mensaje.tono === "ok" ? C.green : C.accent }}>{mensaje.texto}</span> : null}
          </div>
        </div>

        {/* Vista previa en vivo */}
        <div style={{ display: "flex", flexDirection: "column", gap: 8, minWidth: 0 }}>
          <div style={{ fontSize: 12, fontWeight: 900, color: C.text }}>Así lo verá la clienta</div>
          <div
            style={{
              position: "relative",
              minHeight: 260,
              borderRadius: 12,
              border: `1px dashed ${C.border}`,
              background: form.formato === "popup" ? "rgba(0,0,0,.5)" : "var(--background, #18181B)",
              display: "flex",
              alignItems: form.formato === "popup" ? "center" : "flex-end",
              justifyContent: form.formato === "tarjeta" ? "flex-end" : form.formato === "toast" ? "flex-start" : "center",
              padding: 16,
            }}
          >
            <AvisoVista key={`${form.formato}-${form.tipo}`} aviso={previa} onCerrar={() => {}} vistaPrevia />
          </div>
          <div style={{ fontSize: 11, color: C.text3, lineHeight: 1.5 }}>
            {form.formato === "toast" ? "Se cierra solo a los 8 s (o con ✕). Cerrar = visto." : form.formato === "tarjeta" ? "Queda en la esquina hasta que toque «Entendido»." : "Modal centrado: no se cierra tocando fuera; «Entendido» o Esc."}
          </div>
        </div>
      </div>

      {/* Lista */}
      <div style={{ borderTop: `1px solid ${C.border}`, paddingTop: 10 }}>
        <div style={{ fontSize: 11, color: C.text3, textTransform: "uppercase", letterSpacing: ".07em", fontWeight: 900 }}>Avisos ({avisos.length})</div>
        {avisos.length === 0 ? (
          <div style={{ marginTop: 8, fontSize: 12, color: C.text3 }}>Todavía no hay avisos.</div>
        ) : (
          <div style={{ marginTop: 6, display: "flex", flexDirection: "column" }}>
            {avisos.map((a) => {
              const vigente = a.activo && avisoVigente(a, ahoraMs);
              const programado = a.activo && Date.parse(a.desde) > ahoraMs;
              const est = !a.activo ? { t: "apagado", c: C.text3 } : vigente ? { t: "VIGENTE", c: C.green } : programado ? { t: "programado", c: C.amber } : { t: "vencido", c: C.text3 };
              return (
                <div key={a.id} style={{ borderTop: `1px solid ${C.border}`, padding: "9px 0", display: "grid", gridTemplateColumns: "84px minmax(0,1fr) auto", gap: 10, alignItems: "center", opacity: a.activo ? 1 : 0.6 }}>
                  <div>
                    <div style={{ fontSize: 10.5, fontWeight: 900, color: est.c }}>{est.t}</div>
                    <div style={{ fontSize: 10.5, color: C.text3 }}>{TIPO_LABEL[a.tipo]} · {a.formato}</div>
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 12.5, fontWeight: 800, color: C.text, overflowWrap: "anywhere" }}>{a.titulo}</div>
                    <div style={{ fontSize: 11, color: C.text3, overflowWrap: "anywhere" }}>
                      {fmt(a.desde)} → {fmt(a.hasta)} · {a.empresa_ids ? `${a.empresa_ids.length} empresa(s)` : "todas"}{a.mesa ? ` · mesa ${a.mesa}` : ""}{a.version_min ? ` · desde versión ${a.version_min.length > 16 ? fmt(a.version_min) : a.version_min}` : ""} · <b style={{ color: C.text2 }}>{a.vistos} {a.vistos === 1 ? "persona lo vio" : "personas lo vieron"}</b> · {a.creado_por ?? "—"}
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 6 }}>
                    <button type="button" onClick={() => { setEditando(a.id); setForm(formDe(a)); setMensaje(null); }} style={BTN_GRIS}>Editar</button>
                    {a.activo ? <button type="button" disabled={estado === "loading"} onClick={() => desactivar(a.id)} style={BTN_GRIS}>Desactivar</button> : null}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
