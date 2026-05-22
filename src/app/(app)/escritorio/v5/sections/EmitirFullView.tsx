"use client";

import { useEffect, useState, useMemo, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/Toast";
import { validarRut } from "@/lib/sii/validation";
import { generarBoletaPDF, type BoletaPDFData } from "@/lib/pdf/boleta-pdf";

interface EmitItem {
  id: string; descripcion: string; fecha: string;
  receptor_nombre: string | null; receptor_rut: string | null;
  monto_total: number; listo_emitir: boolean;
  motivo_no_listo: string | null; tipo_sugerido: number | null;
  documento_id: string | null; documento_nombre: string | null;
  documento_created_at: string | null;
}

function fmt(n: number) { return `$${Math.round(n).toLocaleString("es-CL")}`; }

function dayLabel(s: string) {
  const d = new Date(s + "T12:00:00");
  const hoy = new Date(); hoy.setHours(12, 0, 0, 0);
  const diff = Math.round((hoy.getTime() - d.getTime()) / 86400000);
  if (diff === 0) return "Hoy";
  if (diff === 1) return "Ayer";
  const ms = ["ene","feb","mar","abr","may","jun","jul","ago","sep","oct","nov","dic"];
  return `${ms[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

const TIPO_BADGE: Record<number, { label: string; color: string }> = {
  39: { label: "AFECTA", color: "#E8553E" },
  41: { label: "EXENTA", color: "#3B82F6" },
  61: { label: "NC", color: "#7C3AED" },
};

export default function EmitirFullView({ empresaId, tipoContribuyente }: { empresaId: string; tipoContribuyente?: string | null }) {
  const [items, setItems] = useState<EmitItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [emitiendo, setEmitiendo] = useState<Set<string>>(new Set());
  const [emitiendoTodas, setEmitiendoTodas] = useState(false);
  const [emitidas, setEmitidas] = useState<Set<string>>(new Set());
  const { toast } = useToast();
  const router = useRouter();

  // DTE form state
  const esExento = tipoContribuyente === "exento";
  const [mode, setMode] = useState<"massdte" | "dte">("massdte");
  const [dteMonto, setDteMonto] = useState("");
  const [dteTipo, setDteTipo] = useState<39 | 41>(esExento ? 41 : 39);
  const [dteReceptorOn, setDteReceptorOn] = useState(false);
  const [dteRut, setDteRut] = useState("");
  const [dteNombre, setDteNombre] = useState("");
  const [dteEmail, setDteEmail] = useState("");
  const [dteDetalleOn, setDteDetalleOn] = useState(false);
  const [dteGlosa, setDteGlosa] = useState("");
  const [dteEmitting, setDteEmitting] = useState(false);
  const [dteEmitida, setDteEmitida] = useState(false);
  const [dteBoletaId, setDteBoletaId] = useState<string | null>(null);
  const [rutError, setRutError] = useState(false);

  // Validar RUT en tiempo real
  function validarRutInput(rut: string) {
    setDteRut(rut);
    if (rut.trim() && rut.length >= 7) {
      setRutError(!validarRut(rut));
    } else {
      setRutError(false);
    }
  }

  // Listen for go-to-tab with mode
  useEffect(() => {
    function handler(e: CustomEvent) {
      const detail = e.detail as { tab?: string; mode?: string };
      if (detail.tab === "emitir" && detail.mode === "dte") {
        setMode("dte");
      }
    }
    window.addEventListener("go-to-tab" as any, handler as any);
    return () => window.removeEventListener("go-to-tab" as any, handler as any);
  }, []);

  useEffect(() => {
    fetch("/api/intermediaria/pendientes-emision")
      .then(r => r.json())
      .then(d => { if (d.ok) setItems(d.items); })
      .catch(() => toast("Error al cargar", "error"))
      .finally(() => setLoading(false));
  }, []);

  const byDateDoc = useMemo(() => {
    const dateMap = new Map<string, Map<string, { docName: string; items: EmitItem[] }>>();
    for (const i of items) {
      const uploadDate = (i.documento_created_at ?? i.fecha).slice(0, 10);
      const docId = i.documento_id ?? "__sin__";
      const docName = i.documento_nombre ?? "Sin documento";
      if (!dateMap.has(uploadDate)) dateMap.set(uploadDate, new Map());
      const docMap = dateMap.get(uploadDate)!;
      if (!docMap.has(docId)) docMap.set(docId, { docName, items: [] });
      docMap.get(docId)!.items.push(i);
    }
    return Array.from(dateMap.entries()).sort(([a], [b]) => b.localeCompare(a))
      .map(([date, docMap]) => ({ date, docs: Array.from(docMap.values()) }));
  }, [items]);

  async function handleEmitir(item: EmitItem) {
    setEmitiendo(p => new Set(p).add(item.id));
    try {
      const res = await fetch("/api/intermediaria/emitir-boleta", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tipo_dte: item.tipo_sugerido ?? 39,
          receptor_rut: item.receptor_rut || undefined,
          receptor_razon_social: item.receptor_nombre || undefined,
          monto_total: item.monto_total,
          detalles: [{ nombre: item.descripcion, monto: item.monto_total }],
        }),
      });
      const data = await res.json();
      if (data.ok) {
        setEmitidas(prev => new Set(prev).add(item.id));
        toast(`Boleta #${data.folio} emitida`);
      } else {
        toast(data.error ?? "Error al emitir", "error");
        setEmitiendo(p => { const n = new Set(p); n.delete(item.id); return n; });
        return;
      }
    } catch {
      toast("Error de red", "error");
      setEmitiendo(p => { const n = new Set(p); n.delete(item.id); return n; });
      return;
    }
    setEmitiendo(p => { const n = new Set(p); n.delete(item.id); return n; });
  }

  function goToVisualizar() {
    window.dispatchEvent(new CustomEvent("go-to-tab", { detail: { tab: "visualizar" } }));
  }

  function goToPanel() {
    window.dispatchEvent(new CustomEvent("go-to-tab", { detail: { tab: "dashboard" } }));
  }

  async function handleEmitirTodas() {
    const listos = items.filter(i => i.listo_emitir);
    if (!listos.length) return;
    setEmitiendoTodas(true);
    let ok = 0, fail = 0;
    for (const item of listos) {
      try {
        setEmitiendo(p => new Set(p).add(item.id));
        const res = await fetch("/api/intermediaria/emitir-boleta", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            tipo_dte: item.tipo_sugerido ?? 39,
            receptor_rut: item.receptor_rut || undefined,
            receptor_razon_social: item.receptor_nombre || undefined,
            monto_total: item.monto_total,
            detalles: [{ nombre: item.descripcion, monto: item.monto_total }],
          }),
        });
        const data = await res.json();
        if (data.ok) { ok++; setEmitidas(prev => new Set(prev).add(item.id)); }
        else fail++;
      } catch { fail++; }
      setEmitiendo(p => { const n = new Set(p); n.delete(item.id); return n; });
    }
    setEmitiendoTodas(false);
    if (ok > 0) toast(`${ok} boleta${ok > 1 ? "s" : ""} emitida${ok > 1 ? "s" : ""}`);
    if (fail > 0) toast(`${fail} fallaron`, "error");
  }

  async function handleDteEmitir() {
    const montoNum = parseInt(dteMonto.replace(/\D/g, ""), 10) || 0;
    if (montoNum <= 0) { toast("Ingresa un monto válido", "error"); return; }
    if (dteReceptorOn && dteRut.trim() && !validarRut(dteRut)) { toast("El RUT no existe o es inválido", "error"); return; }
    setDteEmitting(true);
    try {
      const res = await fetch("/api/intermediaria/emitir-boleta", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tipo_dte: dteTipo,
          receptor_rut: dteReceptorOn ? (dteRut || undefined) : undefined,
          receptor_razon_social: dteReceptorOn ? (dteNombre || undefined) : undefined,
          monto_total: montoNum,
          detalles: [{ nombre: dteDetalleOn && dteGlosa ? dteGlosa : `Boleta ${dteTipo === 39 ? "Afecta" : "Exenta"}`, monto: montoNum }],
        }),
      });
      const data = await res.json();
      if (data.ok) {
        setDteEmitida(true);
        setDteBoletaId(data.boleta_id ?? null);
        toast(`Boleta #${data.folio} emitida`);
      } else {
        if (data.errores?.some((e: any) => e.code === "RUT_INVALIDO")) {
          toast("El RUT no existe o es inválido", "error");
        } else if (data.errores?.length) {
          toast(data.errores[0].message, "error");
        } else {
          toast(data.error ?? "Error al emitir", "error");
        }
      }
    } catch {
      toast("Error de red", "error");
    }
    setDteEmitting(false);
  }

  async function handleVerBoleta() {
    if (!dteBoletaId) return;
    try {
      const res = await fetch(`/api/intermediaria/boleta/${dteBoletaId}`, { cache: "no-store" });
      const j = await res.json();
      if (!res.ok || !j.ok) { toast(j.error ?? "Error al cargar", "error"); return; }
      const b = j.boleta;
      const data: BoletaPDFData = {
        folio: b.folio, tipo_dte: b.tipo_dte, fecha_emision: b.fecha_emision,
        emisor: { rut: b.emisor_rut, razon_social: b.emisor_razon_social, giro: b.emisor_giro, direccion: b.emisor_direccion, comuna: b.emisor_comuna },
        receptor: b.receptor_rut || b.receptor_razon_social ? { rut: b.receptor_rut, razon_social: b.receptor_razon_social, direccion: b.receptor_direccion, comuna: b.receptor_comuna } : undefined,
        detalles: (Array.isArray(b.detalles) ? b.detalles : []).map((d: any) => ({ nombre: d.nombre ?? "Item", cantidad: d.cantidad, precio: d.precio_unitario, monto: d.monto ?? 0 })),
        totales: { neto: b.monto_neto, exento: b.monto_exento, iva: b.iva, total: b.monto_total },
        ted: b.ted, track_id: b.track_id, estado: b.estado,
      };
      const blobUrl = await generarBoletaPDF(data, "view");
      window.open(blobUrl, "_blank");
    } catch { toast("Error al generar PDF", "error"); }
  }

  if (loading) {
    return (
      <div style={{ textAlign: "center", padding: "80px 20px" }}>
        <span style={{ width: 20, height: 20, border: "2px solid rgba(255,255,255,.1)", borderTopColor: "var(--accent)", borderRadius: "50%", animation: "sp .5s linear infinite", display: "inline-block" }} />
      </div>
    );
  }

  const todasEmitidas = items.length > 0 && emitidas.size === items.length;

  if (items.length === 0 || todasEmitidas) {
    return (
      <div style={{ textAlign: "center", padding: "80px 20px" }}>
        <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="var(--green)" strokeWidth="2" style={{ display: "block", margin: "0 auto 14px" }}>
          <path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>
        </svg>
        <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text)", marginBottom: 4 }}>Todo emitido</div>
        <div style={{ fontSize: 10, color: "var(--text2)", marginBottom: 24 }}>
          {items.length} boleta{items.length !== 1 ? "s" : ""} emitida{items.length !== 1 ? "s" : ""} correctamente
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8, maxWidth: 260, margin: "0 auto" }}>
          <button onClick={goToVisualizar}
            style={{
              width: "100%", padding: "10px 24px", borderRadius: 8, border: "none",
              background: "#E8553E", color: "#fff", fontSize: 12, fontWeight: 600, cursor: "pointer",
              display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6,
            }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
            Ver boletas emitidas
          </button>
          <button onClick={() => window.dispatchEvent(new CustomEvent("go-to-tab", { detail: { tab: "subir" } }))}
            style={{
              width: "100%", padding: "10px 24px", borderRadius: 8, border: "none",
              background: "#E8553E", color: "#fff", fontSize: 12, fontWeight: 600, cursor: "pointer",
              display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6,
            }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 5v14M5 12h14"/></svg>
            Nueva carga
          </button>
          <button onClick={goToPanel}
            style={{
              width: "100%", padding: "10px 24px", borderRadius: 8, border: "1px solid rgba(255,255,255,.12)",
              background: "transparent", color: "var(--text2)", fontSize: 12, fontWeight: 500, cursor: "pointer",
              display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6,
            }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/></svg>
            Volver al Panel
          </button>
        </div>
      </div>
    );
  }

  const listos = items.filter(i => i.listo_emitir);
  const bloqueados = items.filter(i => !i.listo_emitir);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {/* Toggle: EMITIR DTE / EMITIR MASSDTE */}
      <div style={{ display: "flex", gap: 6 }}>
        <button onClick={() => setMode("dte")}
          style={{
            flex: 1, padding: "8px 12px", borderRadius: 8, border: "none", cursor: "pointer",
            fontSize: 10, fontWeight: 700,
            background: mode === "dte" ? "rgba(232,85,62,.1)" : "transparent",
            color: mode === "dte" ? "#E8553E" : "var(--text2)",
            transition: "all .15s",
          }}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ display: "block", margin: "0 auto 3px" }}>
            <circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>
          </svg>
          EMITIR DTE
        </button>
        <button onClick={() => { window.dispatchEvent(new CustomEvent("go-to-tab", { detail: { tab: "subir" } })); }}
          style={{
            flex: 1, padding: "8px 12px", borderRadius: 8, border: "none", cursor: "pointer",
            fontSize: 10, fontWeight: 700,
            background: mode === "massdte" ? "rgba(232,85,62,.1)" : "transparent",
            color: mode === "massdte" ? "#E8553E" : "var(--text2)",
            transition: "all .15s",
          }}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ display: "block", margin: "0 auto 3px" }}>
            <path d="M13 10V3L4 14h7v7l9-11h-7z"/>
          </svg>
          EMITIR MASSDTE
        </button>
      </div>

      {mode === "dte" ? (
        /* ═══ EMITIR DTE — formulario individual ═══ */
        <div style={{ maxWidth: 480, margin: "0 auto", width: "100%", display: "flex", flexDirection: "column", gap: 16 }}>
          {/* Monto — card destacado */}
          <div style={{
            background: "var(--surface)", borderRadius: 12, border: "1px solid var(--border)",
            padding: "18px 20px", boxShadow: "inset 0 1px 0 var(--border),0 4px 16px var(--shadow)",
          }}>
            <div style={{ fontSize: 10, color: "var(--text2)", fontWeight: 500, marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.04em" }}>Monto de la boleta</div>
            <div style={{ position: "relative" }}>
              <span style={{ position: "absolute", left: 14, top: "50%", transform: "translateY(-50%)", fontSize: 16, fontWeight: 700, color: "var(--text3)", pointerEvents: "none" }}>$</span>
              <input value={dteMonto ? Number(dteMonto.replace(/\D/g, "")).toLocaleString("es-CL") : ""} onChange={e => setDteMonto(e.target.value.replace(/\D/g, ""))}
                placeholder="0"
                style={{
                  width: "100%", padding: "14px 14px 14px 34px", borderRadius: 10,
                  border: "1px solid var(--border)", background: "var(--bg-muted)",
                  color: "var(--text)", fontSize: 22, fontWeight: 700, textAlign: "right",
                  fontVariantNumeric: "tabular-nums", outline: "none",
                }} />
            </div>
            {dteMonto && (
              <div style={{ fontSize: 9, color: "var(--text2)", marginTop: 4, textAlign: "right" }}>
                {fmt(parseInt(dteMonto.replace(/\D/g, ""), 10) || 0)}
              </div>
            )}
          </div>

          {/* Tipo + Opciones — card agrupado */}
          <div style={{
            background: "var(--surface)", borderRadius: 12, border: "1px solid var(--border)",
            overflow: "hidden", boxShadow: "inset 0 1px 0 var(--border),0 4px 16px var(--shadow)",
          }}>
            {/* Tipo DTE */}
            <div style={{ padding: "14px 16px" }}>
              <div style={{ fontSize: 10, color: "var(--text2)", fontWeight: 500, marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.04em" }}>Tipo DTE</div>
              <div style={{
                padding: "9px 14px", borderRadius: 8,
                background: esExento ? "rgba(59,130,246,.08)" : "rgba(232,85,62,.08)",
                color: esExento ? "#3B82F6" : "#E8553E",
                fontSize: 11, fontWeight: 700,
                display: "flex", alignItems: "center", gap: 8,
              }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/>
                </svg>
                {esExento ? "Boleta Exenta" : "Boleta Afecta"}
              </div>
            </div>

            <div style={{ height: 1, background: "var(--border)" }} />

            {/* Receptor toggle */}
            <div style={{ padding: "14px 16px" }}>
              <button onClick={() => setDteReceptorOn(o => !o)}
                style={{
                  width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between",
                  padding: "4px 0", border: "none", background: "none", cursor: "pointer",
                  fontSize: 11, fontWeight: 600, color: dteReceptorOn ? "#E8553E" : "var(--text2)",
                }}>
                <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/>
                  </svg>
                  Receptor
                </span>
                <div style={{
                  width: 36, height: 20, borderRadius: 10,
                  background: dteReceptorOn ? "#E8553E" : "var(--bg-muted)",
                  position: "relative", transition: "all .2s",
                }}>
                  <div style={{
                    width: 16, height: 16, borderRadius: "50%", background: "#fff",
                    position: "absolute", top: 2, left: dteReceptorOn ? 18 : 2,
                    transition: "all .2s",
                  }} />
                </div>
              </button>
              {dteReceptorOn && (
                <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 10 }}>
                  <input value={dteRut} onChange={e => validarRutInput(e.target.value)}
                    placeholder="RUT (ej: 12.345.678-9)"
                    style={{
                      padding: "8px 10px", borderRadius: 6, border: `1px solid ${rutError ? "#ef4444" : "var(--border)"}`,
                      background: rutError ? "rgba(239,68,68,.04)" : "var(--bg-muted)",
                      color: "var(--text)", fontSize: 10, outline: "none",
                    }} />
                  <input value={dteNombre} onChange={e => setDteNombre(e.target.value)}
                    placeholder="Nombre o razón social"
                    style={{ padding: "8px 10px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--bg-muted)", color: "var(--text)", fontSize: 10, outline: "none" }} />
                  <input value={dteEmail} onChange={e => setDteEmail(e.target.value)}
                    placeholder="Email (opcional)"
                    style={{ padding: "8px 10px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--bg-muted)", color: "var(--text)", fontSize: 10, outline: "none" }} />
                </div>
              )}
            </div>

            <div style={{ height: 1, background: "var(--border)" }} />

            {/* Detalle toggle */}
            <div style={{ padding: "14px 16px" }}>
              <button onClick={() => setDteDetalleOn(o => !o)}
                style={{
                  width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between",
                  padding: "4px 0", border: "none", background: "none", cursor: "pointer",
                  fontSize: 11, fontWeight: 600, color: dteDetalleOn ? "#E8553E" : "var(--text2)",
                }}>
                <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/>
                  </svg>
                  Detalle
                </span>
                <div style={{
                  width: 36, height: 20, borderRadius: 10,
                  background: dteDetalleOn ? "#E8553E" : "var(--bg-muted)",
                  position: "relative", transition: "all .2s",
                }}>
                  <div style={{
                    width: 16, height: 16, borderRadius: "50%", background: "#fff",
                    position: "absolute", top: 2, left: dteDetalleOn ? 18 : 2,
                    transition: "all .2s",
                  }} />
                </div>
              </button>
              {dteDetalleOn && (
                <div style={{ marginTop: 10 }}>
                  <input value={dteGlosa} onChange={e => setDteGlosa(e.target.value)}
                    placeholder="Glosa o descripción de la boleta"
                    style={{ width: "100%", padding: "8px 10px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--bg-muted)", color: "var(--text)", fontSize: 10, outline: "none" }} />
                </div>
              )}
            </div>
          </div>

          {/* Emit button + Visualizar */}
          <button onClick={handleDteEmitir} disabled={dteEmitting || dteEmitida}
            style={{
              width: "100%", padding: "12px 0", borderRadius: 8, border: "none",
              cursor: dteEmitting || dteEmitida ? "not-allowed" : "pointer",
              fontSize: 12, fontWeight: 700,
              background: dteEmitida ? "rgba(34,197,94,.12)" : dteEmitting ? "#E8553E" : "#E8553E",
              color: dteEmitida ? "var(--green)" : "#fff",
              display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
              opacity: dteEmitting ? .6 : 1, transition: "all .3s",
            }}>
            {dteEmitida ? (
              <>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>
                </svg>
                EMITIDA
              </>
            ) : dteEmitting ? (
              <>
                <span style={{ width: 14, height: 14, border: "2px solid rgba(255,255,255,.3)", borderTopColor: "#fff", borderRadius: "50%", animation: "sp .5s linear infinite" }} />
                <span>Emitiendo<span className="dots-anim" /></span>
              </>
            ) : (
              <>EMITIR BOLETA</>
            )}
          </button>

          {dteEmitida && (
            <button onClick={handleVerBoleta}
              style={{
                width: "100%", padding: "10px 0", borderRadius: 8, border: "1px solid var(--border)",
                background: "transparent", color: "var(--text2)", cursor: "pointer",
                fontSize: 11, fontWeight: 600,
                display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
                transition: "all .15s",
              }}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>
              </svg>
              Visualizar / Descargar
            </button>
          )}
        </div>
      ) : (
        /* ═══ EMITIR MASSDTE — contenido actual intacto ═══ */
        <>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div>
              <span style={{ fontSize: 15, fontWeight: 700 }}>Emitir documentos</span>
              <span style={{ color: "var(--text2)", fontSize: 11, marginLeft: 8 }}>
                {items.length} pendiente{items.length !== 1 ? "s" : ""}
              </span>
            </div>
            <div style={{ display: "flex", gap: 10, fontSize: 10 }}>
              <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
                <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--green)", boxShadow: "0 0 4px rgba(34,197,94,.4)" }} />
                {listos.length} listo{listos.length !== 1 ? "s" : ""}
              </span>
              {bloqueados.length > 0 && (
                <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
                  <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--amber)" }} />
                  {bloqueados.length} bloqueado{bloqueados.length !== 1 ? "s" : ""}
                </span>
              )}
            </div>
          </div>

          {byDateDoc.map(({ date, docs }) => (
            <div key={date} style={{ background: "var(--surface)", borderRadius: 12, border: "1px solid var(--border)", overflow: "hidden" }}>
              <div style={{
                padding: "10px 14px", borderBottom: "1px solid var(--border)",
                display: "flex", alignItems: "center", gap: 8, fontSize: 11, fontWeight: 600, color: "var(--text2)",
              }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>
                </svg>
                {dayLabel(date)}
              </div>

              <div style={{ padding: 8 }}>
                {docs.map((doc, di) => (
                  <div key={di}>
                    {di > 0 && <div style={{ height: 1, background: "var(--border)", margin: "4px 6px" }} />}
                    <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "4px 6px 8px", fontSize: 10, color: "var(--text2)" }}>
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                        <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/>
                      </svg>
                      <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontWeight: 500 }}>{doc.docName}</span>
                        {listos.length > 0 && emitidas.size < items.length && (
                          <button onClick={handleEmitirTodas} disabled={emitiendoTodas}
                            style={{
                              padding: "3px 10px", borderRadius: 5, border: "none", cursor: emitiendoTodas ? "not-allowed" : "pointer",
                              fontSize: 9, fontWeight: 700, background: "#E8553E", color: "#fff",
                              display: "flex", alignItems: "center", gap: 4, opacity: emitiendoTodas ? .6 : 1,
                            }}>
                            {emitiendoTodas ? (
                              <span style={{ width: 10, height: 10, border: "2px solid rgba(255,255,255,.3)", borderTopColor: "#fff", borderRadius: "50%", animation: "sp .5s linear infinite" }} />
                            ) : (
                              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M5 13l4 4L19 7"/></svg>
                            )}
                            {emitiendoTodas ? "..." : `Emitir todas (${listos.length})`}
                          </button>
                        )}
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 4, padding: "0 6px 6px" }}>
                      {doc.items.map(item => {
                        const ready = item.listo_emitir;
                        const isProcessing = emitiendo.has(item.id);
                        const badge = item.tipo_sugerido ? TIPO_BADGE[item.tipo_sugerido] : null;
                        return (
                          <div key={item.id} style={{
                            padding: "10px 12px", borderRadius: 8,
                            background: "rgba(255,255,255,.02)", border: "1px solid var(--border)",
                            opacity: ready ? 1 : .6, transition: "all .15s",
                          }}>
                            <div style={{ display: "flex", alignItems: "flex-start", gap: 8, marginBottom: 6 }}>
                              <div style={{
                                width: 28, height: 28, borderRadius: 6, flexShrink: 0,
                                background: ready ? "rgba(34,197,94,.08)" : "rgba(245,158,11,.08)",
                                color: ready ? "var(--green)" : "var(--amber)",
                                display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13,
                              }}>
                                {ready ? (
                                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M20 6L9 17l-5-5"/></svg>
                                ) : (
                                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                                )}
                              </div>
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ fontSize: 11, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--text)", marginBottom: 2 }}>
                                  {item.descripcion}
                                </div>
                                <div style={{ fontSize: 9, color: "var(--text2)", display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                                  {badge && (
                                    <span style={{
                                      fontSize: 7, padding: "1px 5px", borderRadius: 3, fontWeight: 700,
                                      background: badge.color + "18", color: badge.color,
                                    }}>
                                      {badge.label}
                                    </span>
                                  )}
                                  <span>{item.fecha.slice(5)}</span>
                                  {item.receptor_nombre && (
                                    <>
                                      <span style={{ color: "var(--text3)" }}>·</span>
                                      <span>{item.receptor_nombre}</span>
                                    </>
                                  )}
                                </div>
                              </div>
                              <div style={{ textAlign: "right", flexShrink: 0 }}>
                                <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text)", fontVariantNumeric: "tabular-nums" }}>
                                  {fmt(item.monto_total)}
                                </div>
                              </div>
                            </div>

                            {!ready && item.motivo_no_listo && (
                              <div style={{ fontSize: 9, color: "var(--amber)", marginBottom: 8, padding: "4px 8px", borderRadius: 4, background: "rgba(245,158,11,.04)", border: "1px solid rgba(245,158,11,.08)" }}>
                                {item.motivo_no_listo}
                              </div>
                            )}

                            {ready && (
                              <button onClick={() => handleEmitir(item)} disabled={isProcessing || emitidas.has(item.id)}
                                style={{
                                  width: "100%", padding: "7px 0", borderRadius: 6, border: "none",
                                  cursor: isProcessing ? "not-allowed" : "pointer", fontSize: 10, fontWeight: 600,
                                  background: emitidas.has(item.id) ? "rgba(34,197,94,.12)" : isProcessing ? "#E8553E" : "#E8553E",
                                  color: emitidas.has(item.id) ? "var(--green)" : "#fff",
                                  display: "flex", alignItems: "center", justifyContent: "center", gap: 5,
                                  opacity: isProcessing ? .6 : 1, transition: "all .3s",
                                }}>
                                {emitidas.has(item.id) ? (
                                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                                    <path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>
                                  </svg>
                                ) : isProcessing ? (
                                  <span style={{ width: 12, height: 12, border: "2px solid rgba(255,255,255,.3)", borderTopColor: "#fff", borderRadius: "50%", animation: "sp .5s linear infinite" }} />
                                ) : (
                                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                                    <path d="M5 13l4 4L19 7"/>
                                  </svg>
                                )}
                                {emitidas.has(item.id) ? "EMITIDA" : isProcessing ? (
                                  <span>Emitiendo<span className="dots-anim" /></span>
                                ) : "EMITIR BOLETA"}
                              </button>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </>
      )}
    </div>
  );
}
