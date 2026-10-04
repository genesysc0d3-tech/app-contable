"use client";

// Pantalla "Preguntas" del popup Editar (Check agrupado, Fase 4 del plan del
// clasificador): en vez de 60 páginas fila por fila, hasta 3 preguntas en el idioma de
// la clienta ("¿Les vendiste algo a estas personas?"). El motor es puro
// (./preguntas-grupo.ts) y corre sobre lo que la mesa ya trae: cero pedidos extra para
// armar las preguntas. Responder llama a UNA server action (responderGrupo); cada
// respuesta se puede deshacer mientras el popup siga abierto.
//
// Piel: la misma de las filas del editor (.ce-row, ./cartola-piel). Botones de igual
// peso (ninguna respuesta "empujada"). En móvil (<480px) se apilan a 44px.

import { useEffect, useMemo, useState } from "react";
import { useToast } from "@/components/Toast";
import { responderGrupo, deshacerGrupo, ultimoGrupo } from "../../revisar/actions";
import { CE_CSS } from "./cartola-piel";
import {
  armarPreguntas, filaDePropuesta, MAX_TARJETAS_VISIBLES, noAbreLista,
  type AccionRespuesta, type Persona, type PropuestaParaPreguntas, type Tarjeta,
} from "./preguntas-grupo";

// Mismo formato que fmt de ./revisar-shared, sin arrastrar ese módulo (editor completo).
const fmt = (n: number | null | undefined) => `$${Math.round(n ?? 0).toLocaleString("es-CL")}`;

type Iva = "afecta" | "exenta" | "depende";
type Item = { ids: string[]; venta: boolean; tocada: boolean };

type Fase =
  | { fase: "pregunta" }
  | { fase: "lista_personas"; venta: Record<string, boolean>; filas: Record<string, boolean>; tocadas: string[]; abiertas: string[]; buscar: string; marcar?: boolean }
  | { fase: "pregunta_iva"; items: Item[]; volver: Fase }
  | { fase: "aplicando" }
  | { fase: "error"; mensaje: string; items: Item[]; iva: Iva | null; grupoId: string };

type Hecha = { id: string; titulo: string; texto: string; grupoId: string | null; estado: "hecha" | "deshaciendo" | "deshecha" };

const CSS = `
.pg-wrap{flex:1;min-height:0;overflow-y:auto;scrollbar-width:thin;padding:6px 0 16px;}
.pg-card{flex-direction:column;align-items:stretch;gap:12px;padding:16px 18px;margin:10px 18px 0;cursor:default;}
.pg-card:hover{transform:none;}
.pg-head{display:flex;align-items:flex-start;gap:12px;}
.pg-tit{font-size:14px;font-weight:700;letter-spacing:-.01em;color:var(--text);line-height:1.3;}
.pg-sub{font-size:11.5px;color:var(--text2);margin-top:3px;line-height:1.35;}
.pg-monto{margin-left:auto;flex-shrink:0;font-size:14px;font-weight:750;font-variant-numeric:tabular-nums;color:var(--text);}
.pg-preg{font-size:15px;font-weight:700;letter-spacing:-.01em;color:var(--text);}
.pg-btns{display:flex;gap:8px;flex-wrap:wrap;}
.pg-btn{flex:1 1 0;min-width:0;min-height:38px;font-size:12.5px;font-weight:700;padding:8px 12px;border-radius:11px;
  border:1px solid color-mix(in srgb, var(--text) 14%, transparent);background:var(--surface2, var(--bg-muted));color:var(--text);cursor:pointer;
  transition:border-color .15s, background .15s;}
.pg-btn:hover:not(:disabled){border-color:color-mix(in srgb, var(--text) 30%, transparent);background:color-mix(in srgb, var(--text) 7%, var(--surface));}
.pg-btn:disabled{opacity:.55;cursor:default;}
.pg-btn.pg-pri{background:var(--accent);border-color:var(--accent);color:#fff;}
.pg-link{border:none;background:transparent;color:var(--text2);font-size:11.5px;font-weight:650;cursor:pointer;padding:4px 2px;text-decoration:underline;text-underline-offset:2px;}
.pg-per{display:flex;align-items:center;gap:10px;padding:9px 12px;border-radius:10px;border:1px solid color-mix(in srgb, var(--text) 8%, transparent);}
.pg-per + .pg-per{margin-top:6px;}
.pg-sw{flex-shrink:0;display:inline-flex;align-items:center;gap:6px;min-width:118px;justify-content:center;font-size:11.5px;font-weight:700;padding:6px 11px;border-radius:99px;cursor:pointer;
  border:1px solid color-mix(in srgb, var(--text) 14%, transparent);background:transparent;color:var(--text2);}
.pg-sw[aria-checked="true"]{border-color:color-mix(in srgb, var(--green) 45%, transparent);background:color-mix(in srgb, var(--green) 12%, transparent);color:var(--green);}
.pg-dot{width:7px;height:7px;border-radius:50%;background:currentColor;opacity:.9;}
.pg-in{width:100%;font-size:12.5px;padding:8px 11px;border-radius:9px;border:1px solid var(--border);background:var(--surface);color:var(--text);}
.pg-hecha{display:flex;align-items:center;gap:10px;padding:11px 14px;margin:10px 18px 0;border-radius:12px;font-size:12.5px;color:var(--text2);
  border:1px dashed color-mix(in srgb, var(--text) 14%, transparent);}
@media (max-width:480px){
  .pg-card{margin:10px 10px 0;padding:14px;}
  .pg-btns{flex-direction:column;}
  .pg-btn{min-height:44px;width:100%;flex:none;}
  .pg-sw{min-height:44px;}
  .pg-hecha{margin:10px 10px 0;flex-wrap:wrap;}
}
`;

export default function PreguntasGrupo({
  propuestas, historial, documentoId, truncada, carril, marca, razonSocial, rutEmpresa = null, aMediasIds, onAction, onUnaPorUna,
}: {
  propuestas: PropuestaParaPreguntas[];
  /** Todas las filas de la mesa (otras cartolas): de ahí sale "¿Sigue igual?". */
  historial: PropuestaParaPreguntas[];
  documentoId: string;
  truncada: boolean;
  carril: string | null;
  marca: string | null;
  razonSocial: string | null;
  rutEmpresa?: string | null;
  aMediasIds: ReadonlySet<string>;
  onAction: () => void;
  onUnaPorUna: () => void;
}) {
  const { toast } = useToast();
  // Filas ya respondidas: fuera de las preguntas hasta que la mesa recargue (no se
  // vuelve a mostrar la misma tarjeta con los mismos ids mientras llega el reload).
  const [respondidas, setRespondidas] = useState<{ base: PropuestaParaPreguntas[]; ids: ReadonlySet<string> }>({ base: propuestas, ids: new Set() });
  const yaRespondidas = respondidas.base === propuestas ? respondidas.ids : null;
  const res = useMemo(() => armarPreguntas(
    propuestas.filter((p) => !yaRespondidas?.has(p.id)).map((p) => filaDePropuesta(p, aMediasIds)),
    { mesa: "boleta", truncada, carril, marca, razonSocial, rutEmpresa, historial: historial.map((p) => filaDePropuesta(p, aMediasIds)) },
  ), [propuestas, yaRespondidas, historial, aMediasIds, truncada, carril, marca, razonSocial, rutEmpresa]);
  const [fases, setFases] = useState<Record<string, Fase>>({});
  const [hechas, setHechas] = useState<Hecha[]>([]);
  const faseDe = (id: string): Fase => fases[id] ?? { fase: "pregunta" };
  const poner = (id: string, f: Fase | null) => setFases((prev) => {
    const n = { ...prev };
    if (f) n[id] = f; else delete n[id];
    return n;
  });

  // Deshacer sobrevive a una recarga: la última respuesta en grupo de esta cartola que
  // todavía se puede deshacer (una lectura al abrir la pantalla).
  useEffect(() => {
    let vivo = true;
    ultimoGrupo(documentoId).then((u) => {
      if (!vivo || !u.grupoId) return;
      setHechas((prev) => prev.some((h) => h.grupoId === u.grupoId) ? prev : [...prev, {
        id: `ultimo-${u.grupoId}`, titulo: "Tu última respuesta en grupo",
        texto: u.filas === 1 ? "Cambió 1 movimiento." : `Cambió ${u.filas} movimientos.`, grupoId: u.grupoId!, estado: "hecha",
      }]);
    }).catch(() => { /* sin Deshacer previo: no pasa nada */ });
    return () => { vivo = false; };
  }, [documentoId]);

  async function enviar(t: Tarjeta, items: Item[], iva: Iva | null, grupoPrevio?: string) {
    // El grupo nace ACÁ: si se corta la conexión a mitad de una respuesta grande, lo que
    // alcanzó a guardarse igual se puede deshacer (y Reintentar reusa el mismo grupo).
    const grupoId = grupoPrevio ?? globalThis.crypto.randomUUID();
    poner(t.id, { fase: "aplicando" });
    try {
      const r = await responderGrupo({ documentoId, items, iva, grupoId });
      if (r.error && r.ventas + r.noVentas === 0) { poner(t.id, { fase: "error", mensaje: r.error, items, iva, grupoId }); return; }
      const partes: string[] = [];
      if (r.ventas > 0) partes.push(`${r.ventas === 1 ? "1 quedó lista" : `${r.ventas} quedaron listas`} para boleta`);
      if (r.noVentas > 0) partes.push(`${r.noVentas} sin boleta`);
      let texto = partes.length > 0 ? `${partes.join(" y ")}.` : "No cambió nada.";
      if (r.quedan > 0) texto += ` ${r.quedan === 1 ? "1 queda" : `${r.quedan} quedan`} para mirar una por una.`;
      if (r.reglas > 0) texto += ` La próxima vez ${r.reglas === 1 ? "esa persona va" : "esas personas van"} directo.`;
      if (r.error) toast(r.error, "error");
      setHechas((prev) => [{ id: `${t.id}-${Date.now()}`, titulo: t.titulo, texto, grupoId: r.grupoId ?? grupoId, estado: "hecha" }, ...prev.filter((h) => h.grupoId !== grupoId)]);
      setRespondidas((prev) => ({ base: propuestas, ids: new Set([...(prev.base === propuestas ? prev.ids : []), ...items.flatMap((i) => i.ids)]) }));
      poner(t.id, null);
      onAction();
    } catch {
      poner(t.id, { fase: "error", mensaje: "Se cortó la conexión. Puede que una parte se haya guardado: reintenta o deshazlo.", items, iva, grupoId });
    }
  }

  async function deshacerError(t: Tarjeta, grupoId: string) {
    try {
      const r = await deshacerGrupo(grupoId);
      // "No encontramos esa respuesta" = no alcanzó a guardarse nada: no hay qué deshacer.
      toast(r.error ? "No se había guardado nada: quedó como antes." : "Deshecho: quedó como antes.");
      poner(t.id, null);
      onAction();
    } catch {
      toast("Error de conexión. Intenta de nuevo.", "error");
    }
  }

  async function deshacer(h: Hecha) {
    if (!h.grupoId || h.estado !== "hecha") return;
    setHechas((prev) => prev.map((x) => (x.id === h.id ? { ...x, estado: "deshaciendo" } : x)));
    try {
      const r = await deshacerGrupo(h.grupoId);
      if (r.error) {
        toast(r.error, "error");
        setHechas((prev) => prev.map((x) => (x.id === h.id ? { ...x, estado: "hecha" } : x)));
        return;
      }
      toast(r.sinTocar > 0 ? `Deshecho. ${r.sinTocar} ya habían cambiado y se quedaron como estaban.` : "Deshecho: quedó como antes.");
      setHechas((prev) => prev.map((x) => (x.id === h.id ? { ...x, estado: "deshecha" } : x)));
      onAction();
    } catch {
      toast("Error de conexión. Intenta de nuevo.", "error");
      setHechas((prev) => prev.map((x) => (x.id === h.id ? { ...x, estado: "hecha" } : x)));
    }
  }

  function responder(t: Tarjeta, accion: AccionRespuesta) {
    if (accion === "mirar") { onUnaPorUna(); return; }
    if (accion === "algunas") {
      const venta: Record<string, boolean> = {};
      for (const p of t.personas) venta[p.clave] = p.antesNoVenta ? false : t.ventaPorDefecto;
      poner(t.id, { fase: "lista_personas", venta, filas: {}, tocadas: [], abiertas: [], buscar: "" });
      return;
    }
    if (accion === "no_venta" && noAbreLista(t)) {
      // Muchas personas: "No" no rechaza todo de un toque; abre la lista sin ninguna marcada.
      const venta: Record<string, boolean> = {};
      for (const p of t.personas) venta[p.clave] = false;
      poner(t.id, { fase: "lista_personas", venta, filas: {}, tocadas: [], abiertas: [], buscar: "", marcar: true });
      return;
    }
    const items: Item[] = [{ ids: t.ids, venta: accion === "venta", tocada: false }];
    if (accion === "venta" && t.preguntaIva) { poner(t.id, { fase: "pregunta_iva", items, volver: { fase: "pregunta" } }); return; }
    void enviar(t, items, null);
  }

  /** "Algunas" → items: por persona (o por fila, si abrió "Ver sus N" y cambió alguna). */
  function itemsDeLista(t: Tarjeta, f: Extract<Fase, { fase: "lista_personas" }>): Item[] {
    const grupos = new Map<string, Item>();
    const meter = (id: string, venta: boolean, tocada: boolean) => {
      const k = `${venta}|${tocada}`;
      const it = grupos.get(k) ?? { ids: [], venta, tocada };
      it.ids.push(id);
      grupos.set(k, it);
    };
    for (const p of t.personas) {
      const vp = f.venta[p.clave] ?? t.ventaPorDefecto;
      const tocadaP = f.tocadas.includes(p.clave);
      for (const id of p.ids) {
        const vf = f.filas[id];
        meter(id, vf ?? vp, tocadaP || vf !== undefined);
      }
    }
    return [...grupos.values()];
  }

  const visibles = res.tarjetas.slice(0, MAX_TARJETAS_VISIBLES);
  const ocultas = res.tarjetas.length - visibles.length;

  return (
    <div className="pg-wrap" data-testid="preguntas-grupo">
      <style>{CE_CSS + CSS}</style>

      {hechas.map((h) => (
        <div key={h.id} className="pg-hecha" role="status">
          <span style={{ color: h.estado === "deshecha" ? "var(--text3)" : "var(--green)", flexShrink: 0 }}>{h.estado === "deshecha" ? "↩" : "✓"}</span>
          <span style={{ flex: 1, minWidth: 0 }}>
            <b style={{ color: "var(--text)", fontWeight: 650 }}>{h.titulo}.</b>{" "}
            {h.estado === "deshecha" ? "Lo deshiciste: quedó como antes." : h.texto}
          </span>
          {h.grupoId && h.estado !== "deshecha" && (
            <button className="pg-link" onClick={() => deshacer(h)} disabled={h.estado === "deshaciendo"}>
              {h.estado === "deshaciendo" ? "Deshaciendo…" : "Deshacer"}
            </button>
          )}
        </div>
      ))}

      {res.apagado === "truncada" ? (
        <Vacio texto="Esta vista no trae todos tus movimientos del período, así que no te pregunto en grupo. Acota el rango (día o semana) o míralos uno por uno." onUnaPorUna={onUnaPorUna} />
      ) : visibles.length === 0 ? (
        <Vacio
          texto={res.sueltas > 0
            ? `No tengo más preguntas. ${res.sueltas === 1 ? "Queda 1 movimiento" : `Quedan ${res.sueltas} movimientos`} para mirar uno por uno.`
            : hechas.length > 0 ? "Listo, no tengo más preguntas para esta cartola." : "No tengo preguntas para esta cartola."}
          onUnaPorUna={onUnaPorUna}
        />
      ) : (
        <>
          {visibles.map((t) => (
            <TarjetaPregunta
              key={t.id}
              t={t}
              f={faseDe(t.id)}
              onResponder={(a) => responder(t, a)}
              onFase={(f) => poner(t.id, f)}
              onListo={(f) => {
                const items = itemsDeLista(t, f);
                if (t.preguntaIva && items.some((i) => i.venta)) poner(t.id, { fase: "pregunta_iva", items, volver: f });
                else void enviar(t, items, null);
              }}
              onIva={(items, iva) => void enviar(t, items, iva)}
              onReintentar={(items, iva, grupoId) => void enviar(t, items, iva, grupoId)}
              onDeshacerError={(grupoId) => void deshacerError(t, grupoId)}
            />
          ))}
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", padding: "14px 22px 0", fontSize: 11.5, color: "var(--text3)" }}>
            {ocultas > 0 && <span>Después de estas, {ocultas === 1 ? "te queda 1 pregunta más" : `te quedan ${ocultas} preguntas más`}.</span>}
            {res.sueltas > 0 && <span>{res.sueltas === 1 ? "1 movimiento se mira" : `${res.sueltas} movimientos se miran`} uno por uno.</span>}
            <button className="pg-link" style={{ marginLeft: "auto" }} onClick={onUnaPorUna}>Prefiero verlas una por una</button>
          </div>
        </>
      )}
    </div>
  );
}

function Vacio({ texto, onUnaPorUna }: { texto: string; onUnaPorUna: () => void }) {
  return (
    <div style={{ display: "grid", placeItems: "center", padding: "48px 24px", textAlign: "center" }}>
      <div style={{ maxWidth: 360 }}>
        <div style={{ fontSize: 13.5, fontWeight: 650, color: "var(--text)", lineHeight: 1.45 }}>{texto}</div>
        <button className="pg-btn" style={{ marginTop: 16, flex: "none", padding: "9px 18px" }} onClick={onUnaPorUna}>Ver una por una</button>
      </div>
    </div>
  );
}

function TarjetaPregunta({ t, f, onResponder, onFase, onListo, onIva, onReintentar, onDeshacerError }: {
  t: Tarjeta;
  f: Fase;
  onResponder: (a: AccionRespuesta) => void;
  onFase: (f: Fase | null) => void;
  onListo: (f: Extract<Fase, { fase: "lista_personas" }>) => void;
  onIva: (items: Item[], iva: Iva) => void;
  onReintentar: (items: Item[], iva: Iva | null, grupoId: string) => void;
  onDeshacerError: (grupoId: string) => void;
}) {
  const riesgo = t.kind === "propia" || t.kind === "no_venta_probable" || t.kind === "sigue_igual";
  return (
    <section className="ce-row pg-card" aria-label={t.titulo}>
      <div className="pg-head">
        <span aria-hidden style={{ width: 8, height: 8, borderRadius: "50%", marginTop: 6, flexShrink: 0, background: riesgo ? "var(--amber)" : "var(--text3)" }} />
        <div style={{ minWidth: 0 }}>
          <div className="pg-tit">{t.titulo}</div>
          {t.muestra && <div className="pg-sub">{t.muestra}</div>}
        </div>
        <div className="pg-monto">{fmt(t.total)}</div>
      </div>

      {f.fase === "pregunta" && (
        <>
          <div className="pg-preg">{t.pregunta}</div>
          <div className="pg-btns">
            {t.respuestas.map((r) => (
              <button key={r.accion} className="pg-btn" onClick={() => onResponder(r.accion)}>{r.texto}</button>
            ))}
          </div>
        </>
      )}

      {f.fase === "lista_personas" && <ListaPersonas t={t} f={f} onFase={onFase} onListo={onListo} />}

      {f.fase === "pregunta_iva" && (
        <>
          <div className="pg-preg">¿Lo que vendes lleva IVA?</div>
          <div className="pg-btns">
            <button className="pg-btn" onClick={() => onIva(f.items, "afecta")}>Sí, lleva IVA</button>
            <button className="pg-btn" onClick={() => onIva(f.items, "exenta")}>No, es sin IVA</button>
            <button className="pg-btn" onClick={() => onIva(f.items, "depende")}>Depende de la venta</button>
          </div>
          <button className="pg-link" style={{ alignSelf: "flex-start" }} onClick={() => onFase(f.volver)}>Volver</button>
        </>
      )}

      {f.fase === "aplicando" && (
        <div className="pg-sub" role="status" style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5 }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ animation: "vcart-spin .8s linear infinite" }}><path d="M21 12a9 9 0 1 1-6.2-8.56" /></svg>
          Guardando tu respuesta…
          <style>{"@keyframes vcart-spin{to{transform:rotate(360deg)}}"}</style>
        </div>
      )}

      {f.fase === "error" && (
        <>
          <div role="alert" style={{ fontSize: 12.5, color: "var(--red)", fontWeight: 600 }}>{f.mensaje}</div>
          <div className="pg-btns">
            <button className="pg-btn" onClick={() => onReintentar(f.items, f.iva, f.grupoId)}>Reintentar</button>
            <button className="pg-btn" onClick={() => onDeshacerError(f.grupoId)}>Deshacer</button>
          </div>
        </>
      )}
    </section>
  );
}

function ListaPersonas({ t, f, onFase, onListo }: {
  t: Tarjeta;
  f: Extract<Fase, { fase: "lista_personas" }>;
  onFase: (f: Fase | null) => void;
  onListo: (f: Extract<Fase, { fase: "lista_personas" }>) => void;
}) {
  const q = f.buscar.trim().toLowerCase();
  const lista = q ? t.personas.filter((p) => p.etiqueta.toLowerCase().includes(q)) : t.personas;
  const ventaDe = (p: Persona) => f.venta[p.clave] ?? t.ventaPorDefecto;
  const nVenta = t.personas.filter(ventaDe).length;
  // Con filas cambiadas una por una ("Ver sus N"), el contador cuenta movimientos, no personas.
  const mixtas = Object.keys(f.filas).length > 0;
  const nFilasVenta = t.personas.reduce((s, p) => s + p.ids.filter((id) => f.filas[id] ?? ventaDe(p)).length, 0);
  const set = (patch: Partial<Extract<Fase, { fase: "lista_personas" }>>) => onFase({ ...f, ...patch });
  const quien = t.kind === "canal" ? "pagos" : "personas";
  return (
    <>
      <div className="pg-preg" style={{ fontSize: 13.5 }}>
        {t.ventaPorDefecto && !f.marcar ? "Desmarca las que NO fueron venta." : "Marca las que SÍ fueron venta."}
      </div>
      {t.personas.length > 15 && (
        <input className="pg-in" type="search" placeholder="Buscar por nombre" value={f.buscar} onChange={(e) => set({ buscar: e.target.value })} aria-label="Buscar persona" />
      )}
      <div style={{ maxHeight: 340, overflowY: "auto", scrollbarWidth: "thin" }}>
        {lista.map((p) => {
          const venta = ventaDe(p);
          const abierta = f.abiertas.includes(p.clave);
          return (
            <div key={p.clave}>
              <div className="pg-per">
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 650, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.etiqueta}</div>
                  <div className="pg-sub" style={{ marginTop: 1 }}>
                    {p.ids.length === 1 ? "1 movimiento" : `${p.ids.length} movimientos`} · {fmt(p.total)}
                    {p.antesNoVenta && <> · <span style={{ color: "var(--amber)" }}>la otra vez no era venta</span></>}
                    {p.ids.length > 1 && (
                      <> · <button className="pg-link" style={{ fontSize: 11 }} onClick={() => set({ abiertas: abierta ? f.abiertas.filter((c) => c !== p.clave) : [...f.abiertas, p.clave] })}>
                        {abierta ? "Ocultar" : `Ver sus ${p.ids.length}`}
                      </button></>
                    )}
                  </div>
                </div>
                <Interruptor
                  on={venta}
                  onClick={() => {
                    // Cambiar a la persona entera borra lo que hubiera elegido fila por fila.
                    const filas = { ...f.filas };
                    for (const id of p.ids) delete filas[id];
                    set({ venta: { ...f.venta, [p.clave]: !venta }, filas, tocadas: f.tocadas.includes(p.clave) ? f.tocadas : [...f.tocadas, p.clave] });
                  }}
                />
              </div>
              {abierta && p.filas.map((m) => {
                const vf = f.filas[m.id] ?? venta;
                return (
                  <div key={m.id} className="pg-per" style={{ marginLeft: 22, marginTop: 4, padding: "6px 10px" }}>
                    <span className="pg-sub" style={{ flex: 1, marginTop: 0 }}>{m.fecha || "Sin fecha"}</span>
                    <span style={{ fontSize: 12.5, fontWeight: 700, fontVariantNumeric: "tabular-nums", color: "var(--text)" }}>{fmt(m.total)}</span>
                    <Interruptor on={vf} onClick={() => set({ filas: { ...f.filas, [m.id]: !vf } })} />
                  </div>
                );
              })}
            </div>
          );
        })}
        {lista.length === 0 && <div className="pg-sub" style={{ padding: 10 }}>Nadie con ese nombre.</div>}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <span className="pg-sub" style={{ marginTop: 0 }}>
          {mixtas
            ? <>{nFilasVenta} de {t.ids.length} movimientos {nFilasVenta === 1 ? "es venta" : "son venta"}</>
            : <>{nVenta} de {t.personas.length} {quien} {nVenta === 1 ? "es venta" : "son venta"}</>}
        </span>
        <span className="pg-btns" style={{ marginLeft: "auto", flex: "1 1 260px", maxWidth: 360 }}>
          <button className="pg-btn" onClick={() => onFase(null)}>Volver</button>
          <button className="pg-btn pg-pri" onClick={() => onListo(f)}>Listo</button>
        </span>
      </div>
    </>
  );
}

function Interruptor({ on, onClick }: { on: boolean; onClick: () => void }) {
  return (
    <button type="button" role="switch" aria-checked={on} className="pg-sw" onClick={onClick}>
      <span className="pg-dot" />{on ? "Me compró" : "No es venta"}
    </button>
  );
}
