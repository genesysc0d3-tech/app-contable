"use client";

import { useState, useEffect } from "react";
import type { Tables } from "@/lib/database.types";
import { validarRut, formatRut } from "@/lib/rut";
import { CheckCircle, XCircle, PencilSimple, CurrencyBtc, CaretRight } from "@phosphor-icons/react";
import { useToast } from "@/components/Toast";
import { useAppStore } from "@/store/appStore";
import {
  aprobarPropuesta,
  descartarPropuesta,
  editarPropuesta,
  crearClienteDesdeRevisar,
  devolverAOmitidos,
} from "@/app/(app)/revisar/actions";

type Propuesta = Tables<"propuestas_ia"> & {
  movimientos_raw: Tables<"movimientos_raw">;
};

type ClienteResumen = { id: string; nombre: string; rut: string | null };

interface PropuestaCardProps {
  propuesta: Propuesta;
  clientes: ClienteResumen[];
  empresaId: string;
  onAction?: () => void;
  omitidosAnidados?: Propuesta[];
}

interface CategoriaConfig {
  label: string;
  tipoDb: string;
  tieneIva: boolean;
  tooltip: string;
  color: string;
}

const CATEGORIAS: CategoriaConfig[] = [
  { label: "Boleta de honorarios", tipoDb: "boleta", tieneIva: true, tooltip: "IVA 19%. Declara en F29 mensual.", color: "bg-[var(--accent-light)] text-[#E8553E]" },
  { label: "Factura afecta", tipoDb: "factura", tieneIva: true, tooltip: "IVA 19%. Declara en F29 mensual.", color: "bg-[#F3EEFF] dark:bg-[#7C3AED]/15 text-[#7C3AED]" },
  { label: "Compraventa crypto", tipoDb: "registro_crypto", tieneIva: false, tooltip: "Sin IVA (SII Oficio 963-2018). Mayor valor en F22.", color: "bg-[#FFF8ED] dark:bg-[#B45309]/15 text-[#B45309]" },
  { label: "Transferencia P2P", tipoDb: "transferencia_p2p", tieneIva: false, tooltip: "Sin IVA. Monitorear si supera 50 tx (Ley Cumplimiento 2024).", color: "bg-[#ECFEFF] dark:bg-[#0891B2]/15 text-[#0891B2]" },
  { label: "Operacion forex", tipoDb: "forex", tieneIva: false, tooltip: "Sin IVA. Diferencia de cambio en F22.", color: "bg-[#EEF2FF] dark:bg-[#4F46E5]/15 text-[#4F46E5]" },
  { label: "Gasto/egreso", tipoDb: "gasto", tieneIva: true, tooltip: "Gasto con factura recibida. IVA credito fiscal.", color: "bg-[#FFF7ED] dark:bg-[#C2410C]/15 text-[#C2410C]" },
  { label: "No comercial", tipoDb: "ignorar", tieneIva: false, tooltip: "Sin efecto tributario.", color: "bg-[var(--surface)] text-[var(--muted)]" },
];

function getCat(tipo: string) { return CATEGORIAS.find((c) => c.tipoDb === tipo) ?? CATEGORIAS[CATEGORIAS.length - 1]; }

const MONEDAS = ["CLP", "USD", "USDT", "BTC", "ETH", "Otro"];

function fmt(n: number | null): string {
  if (n === null) return "$0";
  return `$${Math.round(n).toLocaleString("es-CL")}`;
}

function recalcIva(total: number, tieneIva: boolean) {
  if (!tieneIva) return { neto: total, iva: 0 };
  const neto = Math.round(total / 1.19);
  return { neto, iva: total - neto };
}

function formatFecha(d: string): string {
  const dt = new Date(d);
  const meses = ["ene","feb","mar","abr","may","jun","jul","ago","sep","oct","nov","dic"];
  return `${dt.getDate()} ${meses[dt.getMonth()]}`;
}

export default function PropuestaCard({ propuesta, clientes, empresaId, onAction, omitidosAnidados = [] }: PropuestaCardProps) {
  const { toast } = useToast();
  const invalidateResumen = useAppStore((s) => s.invalidateResumen);
  const [editing, setEditing] = useState(false);
  const [loading, setLoading] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  const [tipoEdit, setTipoEdit] = useState(propuesta.tipo_propuesto);
  const [notas, setNotas] = useState(propuesta.notas || "");
  const [receptorNombre, setReceptorNombre] = useState(propuesta.receptor_nombre || "");
  const [receptorRut, setReceptorRut] = useState(propuesta.receptor_rut || "");
  const [monedaOrigen, setMonedaOrigen] = useState(propuesta.moneda_origen || "CLP");
  const [montoMonedaOrigen, setMontoMonedaOrigen] = useState(propuesta.monto_moneda_origen?.toString() || "");

  const cat = getCat(tipoEdit);
  const totalNum = Number(propuesta.total) || 0;
  const { neto: editNeto, iva: editIva } = recalcIva(totalNum, cat.tieneIva);

  useEffect(() => {
    if (!receptorRut.trim() || !validarRut(receptorRut)) return;
    const match = clientes.find((c) => c.rut === formatRut(receptorRut));
    if (match && !receptorNombre.trim()) setReceptorNombre(match.nombre);
  }, [receptorRut, clientes, receptorNombre]);

  const [selectedClienteId, setSelectedClienteId] = useState("");
  const [showNewCliente, setShowNewCliente] = useState(false);
  const [newClienteNombre, setNewClienteNombre] = useState(propuesta.receptor_nombre || "");
  const [newClienteRut, setNewClienteRut] = useState(propuesta.receptor_rut || "");

  const mov = propuesta.movimientos_raw;
  const displayCat = getCat(propuesta.tipo_propuesto);
  const isCrypto = propuesta.tipo_propuesto === "registro_crypto";
  const isLowConfidence = propuesta.confianza !== null && propuesta.confianza < 0.5;
  const isFromOmitidos = propuesta.notas?.startsWith("Agregado desde visor de omitidos");
  const confianzaPct = propuesta.confianza !== null ? Math.round(propuesta.confianza * 100) : null;
  const confianzaColor = confianzaPct !== null ? (confianzaPct >= 80 ? "text-[#22C55E]" : confianzaPct >= 60 ? "text-[#F59E0B]" : "text-[#E8553E]") : "";

  async function handleAprobar() {
    setLoading(true);
    let clienteId: string | null = selectedClienteId || null;
    if (showNewCliente && newClienteNombre.trim()) {
      const res = await crearClienteDesdeRevisar({ empresa_id: empresaId, nombre: newClienteNombre, rut: newClienteRut || undefined });
      if (res.ok && res.cliente) clienteId = res.cliente.id;
    }
    await aprobarPropuesta(propuesta.id, clienteId);
    invalidateResumen();
    toast("Aprobado");
    setDismissed(true);
    setTimeout(() => onAction?.(), 250);
    setLoading(false);
  }

  async function handleDescartar() {
    setLoading(true);
    await descartarPropuesta(propuesta.id);
    invalidateResumen();
    toast("Ignorado");
    setDismissed(true);
    setTimeout(() => onAction?.(), 250);
    setLoading(false);
  }

  async function handleGuardarEdicion() {
    setLoading(true);
    const rutValid = receptorRut.trim() && validarRut(receptorRut);
    await editarPropuesta(propuesta.id, {
      tipo_propuesto: tipoEdit,
      receptor_nombre: receptorNombre || null,
      receptor_rut: rutValid ? formatRut(receptorRut) : receptorRut || null,
      monto_neto: editNeto, iva: editIva, total: totalNum,
      notas: notas || null,
      moneda_origen: monedaOrigen !== "CLP" ? monedaOrigen : null,
      monto_moneda_origen: montoMonedaOrigen ? Number(montoMonedaOrigen) : null,
    });
    toast("Guardado");
    setEditing(false);
    onAction?.();
    setLoading(false);
  }

  const inputCls = "w-full rounded-xl bg-[var(--surface)] border border-[var(--border)] px-3 py-2 text-xs text-[var(--foreground)] placeholder:text-[var(--muted-light)] focus:outline-none focus:border-[#E8553E] transition-colors";

  return (
    <div className={`rounded-[20px] bg-white dark:bg-white/5 shadow-[var(--card-shadow)] dark:shadow-none p-5 space-y-3 transition-all duration-200 md:hover:-translate-y-0.5 md:hover:shadow-[0_4px_16px_rgba(0,0,0,0.1)] ${
      dismissed ? "animate-slide-out-right" : "animate-fade-in"
    } ${isLowConfidence ? "border border-[#E8553E]/30" : ""} ${omitidosAnidados.length > 0 ? "border-l-[3px] border-l-[#F59E0B]" : ""}`}>

      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${displayCat.color}`}>
            {isCrypto && <CurrencyBtc size={12} weight="bold" className="inline mr-1 -mt-0.5" />}
            {displayCat.label}
          </span>
          {isFromOmitidos && (
            <span className="text-[9px] px-2 py-0.5 rounded-full bg-[#FFF8ED] dark:bg-[#F59E0B]/10 text-[#F59E0B] font-medium">
              Desde omitidos
            </span>
          )}
        </div>
        {confianzaPct !== null && <span className={`text-xs font-mono tabular-nums ${confianzaColor}`}>{confianzaPct}%</span>}
      </div>

      {/* Movimiento */}
      <div>
        <p className="text-sm text-[var(--foreground)]">{mov.descripcion}</p>
        <div className="flex items-center gap-3 mt-1.5 text-xs text-[var(--muted)]">
          <span>{formatFecha(mov.fecha)}</span>
          <span className={`tabular-nums ${mov.tipo_flujo === "entrada" ? "text-[#22C55E]" : "text-[#E8553E]"}`}>
            {mov.tipo_flujo === "entrada" ? "+" : "-"}{fmt(mov.monto)}
          </span>
          {propuesta.receptor_nombre && <span className="truncate">{propuesta.receptor_nombre}</span>}
        </div>
      </div>

      {/* Desglose */}
      <div className="grid grid-cols-3 gap-2 text-center">
        {[
          { label: "Neto", val: editing ? editNeto : propuesta.monto_neto },
          { label: "IVA", val: editing ? editIva : propuesta.iva },
          { label: "Total", val: propuesta.total, bold: true },
        ].map(({ label, val, bold }) => (
          <div key={label} className="rounded-xl bg-[var(--surface)] px-2 py-1.5">
            <p className="text-[10px] text-[var(--muted-light)]">{label}</p>
            <p className={`text-xs tabular-nums ${bold ? "font-semibold" : "font-medium"} text-[var(--foreground)]`}>{fmt(val)}</p>
          </div>
        ))}
      </div>

      {/* Spread crypto */}
      {isCrypto && (propuesta.spread_compra || propuesta.spread_venta) && (
        <div className="grid grid-cols-3 gap-2 text-center">
          {[
            { label: "Compra", val: propuesta.spread_compra },
            { label: "Venta", val: propuesta.spread_venta },
            { label: "Ganancia", val: propuesta.spread_ganancia, green: true },
          ].map(({ label, val, green }) => (
            <div key={label} className="rounded-xl bg-[#FFF8ED] dark:bg-[#B45309]/10 px-2 py-1.5">
              <p className="text-[10px] text-[#B45309]/60">{label}</p>
              <p className={`text-xs font-medium tabular-nums ${green ? "text-[#22C55E]" : "text-[#B45309]"}`}>{fmt(val)}</p>
            </div>
          ))}
        </div>
      )}

      {!editing && propuesta.moneda_origen && propuesta.moneda_origen !== "CLP" && (
        <p className="text-[10px] text-[var(--muted-light)]">Moneda origen: {propuesta.monto_moneda_origen} {propuesta.moneda_origen}</p>
      )}

      {isLowConfidence && !editing && (
        <p className="text-xs text-[#E8553E] bg-[var(--accent-light)] rounded-lg px-3 py-1.5">Confianza baja — revisa antes de aprobar</p>
      )}

      {/* EDIT MODE */}
      {editing ? (
        <div className="space-y-2.5">
          <div>
            <label className="text-[10px] text-[var(--muted-light)] mb-1 block">Categoria tributaria</label>
            <select value={tipoEdit} onChange={(e) => setTipoEdit(e.target.value)} className={inputCls}>
              {CATEGORIAS.map((c) => <option key={c.tipoDb} value={c.tipoDb}>{c.label}</option>)}
            </select>
            <p className="text-[10px] text-[var(--muted-light)] mt-1">{cat.tooltip}</p>
          </div>
          <div className="flex gap-2 text-center">
            <div className="flex-1 rounded-lg bg-[var(--surface)] border border-[var(--border)] px-2 py-1.5">
              <p className="text-[9px] text-[var(--muted-light)]">Neto</p>
              <p className="text-[11px] font-medium tabular-nums text-[var(--foreground)]">{fmt(editNeto)}</p>
            </div>
            <div className="flex-1 rounded-lg bg-[var(--surface)] border border-[var(--border)] px-2 py-1.5">
              <p className="text-[9px] text-[var(--muted-light)]">IVA {cat.tieneIva ? "19%" : "exento"}</p>
              <p className="text-[11px] font-medium tabular-nums text-[var(--foreground)]">{fmt(editIva)}</p>
            </div>
          </div>
          <div>
            <label className="text-[10px] text-[var(--muted-light)] mb-1 block">Receptor / Pagador</label>
            <div className="flex gap-2">
              <input type="text" placeholder="Nombre" value={receptorNombre} onChange={(e) => setReceptorNombre(e.target.value)} className={`flex-1 ${inputCls}`} />
              <div className="w-32">
                <input type="text" placeholder="RUT" value={receptorRut} onChange={(e) => setReceptorRut(e.target.value)}
                  onBlur={() => { if (receptorRut.trim() && validarRut(receptorRut)) setReceptorRut(formatRut(receptorRut)); }}
                  className={`${inputCls} ${receptorRut.trim() && !validarRut(receptorRut) ? "!border-[#E8553E]" : ""}`} />
                {receptorRut.trim() && !validarRut(receptorRut) && <p className="text-[9px] text-[#E8553E] mt-0.5">RUT invalido</p>}
              </div>
            </div>
          </div>
          {(cat.tipoDb === "registro_crypto" || cat.tipoDb === "forex" || cat.tipoDb === "transferencia_p2p") && (
            <div>
              <label className="text-[10px] text-[var(--muted-light)] mb-1 block">Moneda origen</label>
              <div className="flex gap-2">
                <select value={monedaOrigen} onChange={(e) => setMonedaOrigen(e.target.value)} className={`w-24 ${inputCls}`}>
                  {MONEDAS.map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
                {monedaOrigen !== "CLP" && (
                  <input type="number" placeholder={`Monto en ${monedaOrigen}`} value={montoMonedaOrigen} onChange={(e) => setMontoMonedaOrigen(e.target.value)} className={`flex-1 ${inputCls}`} />
                )}
              </div>
            </div>
          )}
          <textarea value={notas} onChange={(e) => setNotas(e.target.value)} placeholder="Notas..." rows={2} className={`${inputCls} resize-none`} />
          <div className="flex gap-2">
            <button onClick={handleGuardarEdicion} disabled={loading}
              className="btn-press flex-1 rounded-xl bg-[#E8553E] hover:bg-[var(--accent-hover)] disabled:opacity-50 px-3 py-2 text-xs font-semibold text-white transition-all duration-150">Guardar</button>
            <button onClick={() => setEditing(false)}
              className="btn-press rounded-xl bg-[var(--surface)] hover:bg-[var(--border)] px-3 py-2 text-xs text-[var(--muted)] transition-all duration-150">Cancelar</button>
          </div>
        </div>
      ) : (
        <>
          {propuesta.notas && <p className="text-xs text-[var(--muted)] italic">{propuesta.notas}</p>}

          {/* Client selector */}
          <div className="space-y-2">
            <select
              value={showNewCliente ? "__new__" : selectedClienteId}
              onChange={(e) => {
                if (e.target.value === "__new__") { setShowNewCliente(true); setSelectedClienteId(""); }
                else { setShowNewCliente(false); setSelectedClienteId(e.target.value); }
              }}
              className={inputCls}
            >
              <option value="">Sin cliente asignado</option>
              {clientes.map((c) => <option key={c.id} value={c.id}>{c.nombre}{c.rut ? ` (${c.rut})` : ""}</option>)}
              <option value="__new__">+ Crear cliente nuevo</option>
            </select>
            {showNewCliente && (
              <div className="flex gap-2">
                <input type="text" placeholder="Nombre *" value={newClienteNombre} onChange={(e) => setNewClienteNombre(e.target.value)} className={`flex-1 ${inputCls}`} />
                <input type="text" placeholder="RUT" value={newClienteRut} onChange={(e) => setNewClienteRut(e.target.value)} className={`w-28 ${inputCls}`} />
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="flex gap-2">
            <button onClick={handleAprobar} disabled={loading}
              className="btn-press flex-1 flex items-center justify-center gap-1.5 rounded-xl bg-[#E8553E] hover:bg-[var(--accent-hover)] disabled:opacity-50 px-3 py-2.5 text-xs font-semibold text-white transition-all duration-150">
              <CheckCircle size={16} weight="bold" /> Aprobar
            </button>
            <button onClick={() => setEditing(true)} disabled={loading}
              className="btn-press flex-1 flex items-center justify-center gap-1.5 rounded-xl border border-[#E8553E] bg-transparent hover:bg-[var(--accent-light)] disabled:opacity-50 px-3 py-2.5 text-xs font-medium text-[#E8553E] transition-all duration-150">
              <PencilSimple size={16} /> Editar
            </button>
            <button onClick={handleDescartar} disabled={loading}
              className="btn-press flex-1 flex items-center justify-center gap-1.5 rounded-xl bg-[var(--surface)] hover:bg-[var(--border)] disabled:opacity-50 px-3 py-2.5 text-xs font-medium text-[var(--muted)] transition-all duration-150">
              <XCircle size={16} /> Ignorar
            </button>
          </div>

          {/* Omitidos anidados */}
          {omitidosAnidados.length > 0 && (
            <OmitidosAnidados omitidos={omitidosAnidados} onAction={onAction} />
          )}
        </>
      )}
    </div>
  );
}

function OmitidosAnidados({ omitidos, onAction }: { omitidos: Propuesta[]; onAction?: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const { toast } = useToast();

  function formatFecha(d: string) {
    const dt = new Date(d);
    const meses = ["ene","feb","mar","abr","may","jun","jul","ago","sep","oct","nov","dic"];
    return `${dt.getDate()} ${meses[dt.getMonth()]}`;
  }

  async function handleAprobar(id: string) {
    setLoadingId(id);
    await aprobarPropuesta(id);
    toast("Aprobado"); onAction?.(); setLoadingId(null);
  }

  async function handleIgnorar(id: string) {
    setLoadingId(id);
    await descartarPropuesta(id);
    toast("Ignorado"); onAction?.(); setLoadingId(null);
  }

  async function handleDevolver(id: string) {
    setLoadingId(id);
    const result = await devolverAOmitidos(id);
    if (result.ok) toast("Devuelto a omitidos");
    else toast("Error al devolver", "error");
    onAction?.(); setLoadingId(null);
  }

  return (
    <div className="rounded-xl bg-[#FFF8ED] dark:bg-[#F59E0B]/5 border border-[#F59E0B]/20 p-2.5 space-y-2">
      <button onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1.5 text-[10px] text-[#F59E0B] font-medium w-full text-left">
        <CaretRight size={10} weight="bold" className={`transition-transform duration-200 ${expanded ? "rotate-90" : ""}`} />
        {omitidos.length} posible{omitidos.length !== 1 ? "s" : ""} duplicado{omitidos.length !== 1 ? "s" : ""} desde omitidos
      </button>

      {expanded && (
        <div className="space-y-2 animate-fade-in">
          {omitidos.map((o) => {
            const mov = o.movimientos_raw;
            const isLoading = loadingId === o.id;
            return (
              <div key={o.id} className="rounded-lg bg-white dark:bg-white/5 px-3 py-2 text-[10px] space-y-1.5">
                <div>
                  <p className="text-[var(--foreground)] truncate">{mov.descripcion}</p>
                  <div className="flex items-center gap-2 text-[var(--muted-light)] mt-0.5">
                    <span>{formatFecha(mov.fecha)}</span>
                    <span className={`tabular-nums ${mov.tipo_flujo === "entrada" ? "text-[#22C55E]" : "text-[#E8553E]"}`}>
                      {mov.tipo_flujo === "entrada" ? "+" : "-"}${Math.round(mov.monto).toLocaleString("es-CL")}
                    </span>
                  </div>
                </div>
                <div className="flex gap-1.5">
                  <button onClick={() => handleAprobar(o.id)} disabled={isLoading}
                    className="btn-press flex-1 rounded-lg bg-[#E8553E] hover:bg-[var(--accent-hover)] disabled:opacity-50 px-2 py-1.5 text-[9px] font-semibold text-white transition-all duration-150">
                    Aprobar
                  </button>
                  <button onClick={() => handleIgnorar(o.id)} disabled={isLoading}
                    className="btn-press flex-1 rounded-lg bg-[var(--surface)] hover:bg-[var(--border)] disabled:opacity-50 px-2 py-1.5 text-[9px] text-[var(--muted)] transition-all duration-150">
                    Ignorar
                  </button>
                  <button onClick={() => handleDevolver(o.id)} disabled={isLoading}
                    className="btn-press flex-1 rounded-lg bg-[#FFF8ED] dark:bg-[#F59E0B]/10 hover:bg-[#FFF0D4] disabled:opacity-50 px-2 py-1.5 text-[9px] text-[#F59E0B] transition-all duration-150">
                    Devolver
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
