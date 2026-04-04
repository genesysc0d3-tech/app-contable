"use client";

import { useState, useEffect } from "react";
import type { Tables } from "@/lib/database.types";
import { validarRut, formatRut } from "@/lib/rut";
import {
  aprobarPropuesta,
  descartarPropuesta,
  editarPropuesta,
  crearClienteDesdeRevisar,
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
}

// --- Category config ---

interface CategoriaConfig {
  label: string;
  tipoDb: string;
  tieneIva: boolean;
  tooltip: string;
  color: string;
}

const CATEGORIAS: CategoriaConfig[] = [
  {
    label: "Boleta de honorarios",
    tipoDb: "boleta",
    tieneIva: true,
    tooltip: "IVA 19%. Declara en F29 mensual.",
    color: "bg-[#FFF0EE] text-[#E8553E]",
  },
  {
    label: "Factura afecta",
    tipoDb: "factura",
    tieneIva: true,
    tooltip: "IVA 19%. Declara en F29 mensual.",
    color: "bg-[#F3EEFF] text-[#7C3AED]",
  },
  {
    label: "Compraventa crypto/activo digital",
    tipoDb: "registro_crypto",
    tieneIva: false,
    tooltip: "Sin IVA (SII Oficio 963-2018). Declara mayor valor en F22 anual.",
    color: "bg-[#FFF8ED] text-[#B45309]",
  },
  {
    label: "Transferencia P2P",
    tipoDb: "transferencia_p2p",
    tieneIva: false,
    tooltip: "Sin IVA. Puede generar obligacion F22 si supera 50 tx/mes (Ley Cumplimiento 2024).",
    color: "bg-[#ECFEFF] text-[#0891B2]",
  },
  {
    label: "Operacion forex/divisa",
    tipoDb: "forex",
    tieneIva: false,
    tooltip: "Sin IVA. Declara diferencia de cambio en F22 anual.",
    color: "bg-[#EEF2FF] text-[#4F46E5]",
  },
  {
    label: "Gasto/egreso",
    tipoDb: "gasto",
    tieneIva: true,
    tooltip: "Gasto con factura recibida. IVA credito fiscal.",
    color: "bg-[#FFF7ED] text-[#C2410C]",
  },
  {
    label: "No comercial / personal",
    tipoDb: "ignorar",
    tieneIva: false,
    tooltip: "Sin efecto tributario. Se ignora para F29 y F22.",
    color: "bg-[#F5F5F3] text-[#888]",
  },
];

function getCategoriaByTipo(tipo: string): CategoriaConfig {
  return CATEGORIAS.find((c) => c.tipoDb === tipo) ?? CATEGORIAS[CATEGORIAS.length - 1];
}

const MONEDAS = ["CLP", "USD", "USDT", "BTC", "ETH", "Otro"];

// --- Helpers ---

function formatMonto(monto: number | null): string {
  if (monto === null) return "$0";
  return `$${Math.round(monto).toLocaleString("es-CL")}`;
}

function recalcIva(total: number, tieneIva: boolean) {
  if (!tieneIva) return { neto: total, iva: 0 };
  const neto = Math.round(total / 1.19);
  return { neto, iva: total - neto };
}

function ConfianzaBadge({ confianza }: { confianza: number | null }) {
  if (confianza === null) return null;
  const pct = Math.round(confianza * 100);
  const color =
    pct >= 80
      ? "text-[#22C55E]"
      : pct >= 60
        ? "text-[#F59E0B]"
        : "text-[#E8553E]";
  return <span className={`text-xs font-mono ${color}`}>{pct}%</span>;
}

// --- Main ---

export default function PropuestaCard({
  propuesta,
  clientes,
  empresaId,
  onAction,
}: PropuestaCardProps) {
  const [editing, setEditing] = useState(false);
  const [loading, setLoading] = useState(false);

  // Edit state
  const [tipoEdit, setTipoEdit] = useState(propuesta.tipo_propuesto);
  const [notas, setNotas] = useState(propuesta.notas || "");
  const [receptorNombre, setReceptorNombre] = useState(propuesta.receptor_nombre || "");
  const [receptorRut, setReceptorRut] = useState(propuesta.receptor_rut || "");
  const [monedaOrigen, setMonedaOrigen] = useState(propuesta.moneda_origen || "CLP");
  const [montoMonedaOrigen, setMontoMonedaOrigen] = useState<string>(
    propuesta.monto_moneda_origen?.toString() || ""
  );

  // IVA recalculation
  const cat = getCategoriaByTipo(tipoEdit);
  const totalNum = Number(propuesta.total) || 0;
  const { neto: editNeto, iva: editIva } = recalcIva(totalNum, cat.tieneIva);

  // Auto-complete receptor name from RUT
  useEffect(() => {
    if (!receptorRut.trim() || !validarRut(receptorRut)) return;
    const formatted = formatRut(receptorRut);
    const match = clientes.find((c) => c.rut === formatted);
    if (match && !receptorNombre.trim()) {
      setReceptorNombre(match.nombre);
    }
  }, [receptorRut, clientes, receptorNombre]);

  // Approve state
  const [selectedClienteId, setSelectedClienteId] = useState<string>("");
  const [showNewCliente, setShowNewCliente] = useState(false);
  const [newClienteNombre, setNewClienteNombre] = useState(propuesta.receptor_nombre || "");
  const [newClienteRut, setNewClienteRut] = useState(propuesta.receptor_rut || "");

  const mov = propuesta.movimientos_raw;
  const displayCat = getCategoriaByTipo(propuesta.tipo_propuesto);
  const isCrypto = propuesta.tipo_propuesto === "registro_crypto";
  const isLowConfidence = propuesta.confianza !== null && propuesta.confianza < 0.5;

  async function handleAprobar() {
    setLoading(true);
    let clienteId: string | null = selectedClienteId || null;

    if (showNewCliente && newClienteNombre.trim()) {
      const res = await crearClienteDesdeRevisar({
        empresa_id: empresaId,
        nombre: newClienteNombre,
        rut: newClienteRut || undefined,
      });
      if (res.ok && res.cliente) clienteId = res.cliente.id;
    }

    await aprobarPropuesta(propuesta.id, clienteId);
    onAction?.();
    setLoading(false);
  }

  async function handleDescartar() {
    setLoading(true);
    await descartarPropuesta(propuesta.id);
    onAction?.();
    setLoading(false);
  }

  async function handleGuardarEdicion() {
    setLoading(true);
    const rutValid = receptorRut.trim() && validarRut(receptorRut);
    await editarPropuesta(propuesta.id, {
      tipo_propuesto: tipoEdit,
      receptor_nombre: receptorNombre || null,
      receptor_rut: rutValid ? formatRut(receptorRut) : receptorRut || null,
      monto_neto: editNeto,
      iva: editIva,
      total: totalNum,
      notas: notas || null,
      moneda_origen: monedaOrigen !== "CLP" ? monedaOrigen : null,
      monto_moneda_origen: montoMonedaOrigen ? Number(montoMonedaOrigen) : null,
    });
    setEditing(false);
    onAction?.();
    setLoading(false);
  }

  return (
    <div
      className={`rounded-[20px] bg-white shadow-[0_2px_12px_rgba(0,0,0,0.06)] p-4 space-y-3 ${
        isLowConfidence ? "border border-[#E8553E]/30" : ""
      }`}
    >
      {/* Header: tipo + confianza */}
      <div className="flex items-center justify-between">
        <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${displayCat.color}`}>
          {displayCat.label}
        </span>
        <ConfianzaBadge confianza={propuesta.confianza} />
      </div>

      {/* Movimiento info */}
      <div>
        <p className="text-sm text-[#111]">{mov.descripcion}</p>
        <div className="flex items-center gap-3 mt-1.5 text-xs text-[#888]">
          <span>{mov.fecha}</span>
          <span className={mov.tipo_flujo === "entrada" ? "text-[#22C55E]" : "text-[#E8553E]"}>
            {mov.tipo_flujo === "entrada" ? "+" : "-"}{formatMonto(mov.monto)}
          </span>
          {propuesta.receptor_nombre && (
            <span className="truncate">{propuesta.receptor_nombre}</span>
          )}
        </div>
      </div>

      {/* Desglose montos */}
      <div className="grid grid-cols-3 gap-2 text-center">
        <div className="rounded-xl bg-[#F5F5F3] px-2 py-1.5">
          <p className="text-[10px] text-[#AAA]">Neto</p>
          <p className="text-xs font-medium">
            {editing ? formatMonto(editNeto) : formatMonto(propuesta.monto_neto)}
          </p>
        </div>
        <div className="rounded-xl bg-[#F5F5F3] px-2 py-1.5">
          <p className="text-[10px] text-[#AAA]">IVA</p>
          <p className="text-xs font-medium">
            {editing ? formatMonto(editIva) : formatMonto(propuesta.iva)}
          </p>
        </div>
        <div className="rounded-xl bg-[#F5F5F3] px-2 py-1.5">
          <p className="text-[10px] text-[#AAA]">Total</p>
          <p className="text-xs font-semibold">{formatMonto(propuesta.total)}</p>
        </div>
      </div>

      {/* Spread crypto */}
      {isCrypto && (propuesta.spread_compra || propuesta.spread_venta) && (
        <div className="grid grid-cols-3 gap-2 text-center">
          <div className="rounded-xl bg-yellow-500/5 px-2 py-1.5">
            <p className="text-[10px] text-yellow-400/60">Compra</p>
            <p className="text-xs font-medium text-yellow-300">{formatMonto(propuesta.spread_compra)}</p>
          </div>
          <div className="rounded-xl bg-yellow-500/5 px-2 py-1.5">
            <p className="text-[10px] text-yellow-400/60">Venta</p>
            <p className="text-xs font-medium text-yellow-300">{formatMonto(propuesta.spread_venta)}</p>
          </div>
          <div className="rounded-xl bg-yellow-500/5 px-2 py-1.5">
            <p className="text-[10px] text-yellow-400/60">Ganancia</p>
            <p className="text-xs font-semibold text-[#22C55E]">{formatMonto(propuesta.spread_ganancia)}</p>
          </div>
        </div>
      )}

      {/* Moneda origen (display) */}
      {!editing && propuesta.moneda_origen && propuesta.moneda_origen !== "CLP" && (
        <p className="text-[10px] text-[#BBB]">
          Moneda origen: {propuesta.monto_moneda_origen} {propuesta.moneda_origen}
        </p>
      )}

      {/* Low confidence warning */}
      {isLowConfidence && !editing && (
        <p className="text-xs text-[#E8553E]/80 bg-[#FFF0EE] rounded-lg px-3 py-1.5">
          Confianza baja — revisa antes de aprobar
        </p>
      )}

      {/* EDIT MODE */}
      {editing ? (
        <div className="space-y-2.5">
          {/* Categoria tributaria */}
          <div>
            <label className="text-[10px] text-[#AAA] mb-1 block">Categoria tributaria</label>
            <select
              value={tipoEdit}
              onChange={(e) => setTipoEdit(e.target.value)}
              className="w-full rounded-xl bg-[#F5F5F3] border border-[#EEE] px-3 py-2 text-sm text-[#111] focus:outline-none focus:border-[#E8553E]"
            >
              {CATEGORIAS.map((c) => (
                <option key={c.tipoDb} value={c.tipoDb}>{c.label}</option>
              ))}
            </select>
            {/* Tooltip */}
            <p className="text-[10px] text-[#BBB] mt-1">{cat.tooltip}</p>
          </div>

          {/* Live IVA preview */}
          <div className="flex gap-2 text-center">
            <div className="flex-1 rounded-lg bg-[#F5F5F3] border border-[#EEE] px-2 py-1.5">
              <p className="text-[9px] text-[#BBB]">Neto</p>
              <p className="text-[11px] font-medium text-[#555]">{formatMonto(editNeto)}</p>
            </div>
            <div className="flex-1 rounded-lg bg-[#F5F5F3] border border-[#EEE] px-2 py-1.5">
              <p className="text-[9px] text-[#BBB]">IVA {cat.tieneIva ? "19%" : "exento"}</p>
              <p className="text-[11px] font-medium text-[#555]">{formatMonto(editIva)}</p>
            </div>
          </div>

          {/* Receptor/Pagador */}
          <div>
            <label className="text-[10px] text-[#AAA] mb-1 block">Receptor / Pagador</label>
            <div className="flex gap-2">
              <input
                type="text"
                placeholder="Nombre"
                value={receptorNombre}
                onChange={(e) => setReceptorNombre(e.target.value)}
                className="flex-1 rounded-xl bg-[#F5F5F3] border border-[#EEE] px-3 py-2 text-xs text-[#111] placeholder:text-[#AAA] focus:outline-none focus:border-[#E8553E]"
              />
              <div className="w-32">
                <input
                  type="text"
                  placeholder="RUT"
                  value={receptorRut}
                  onChange={(e) => setReceptorRut(e.target.value)}
                  onBlur={() => {
                    if (receptorRut.trim() && validarRut(receptorRut))
                      setReceptorRut(formatRut(receptorRut));
                  }}
                  className={`w-full rounded-xl bg-[#F5F5F3] border px-3 py-2 text-xs text-[#111] placeholder:text-[#AAA] focus:outline-none focus:border-[#E8553E] ${
                    receptorRut.trim() && !validarRut(receptorRut)
                      ? "border-[#E8553E]"
                      : "border-[#EEE]"
                  }`}
                />
                {receptorRut.trim() && !validarRut(receptorRut) && (
                  <p className="text-[9px] text-[#E8553E] mt-0.5">RUT invalido</p>
                )}
              </div>
            </div>
          </div>

          {/* Moneda origen (for crypto/forex/p2p) */}
          {(cat.tipoDb === "registro_crypto" || cat.tipoDb === "forex" || cat.tipoDb === "transferencia_p2p") && (
            <div>
              <label className="text-[10px] text-[#AAA] mb-1 block">Moneda origen (opcional)</label>
              <div className="flex gap-2">
                <select
                  value={monedaOrigen}
                  onChange={(e) => setMonedaOrigen(e.target.value)}
                  className="w-24 rounded-xl bg-[#F5F5F3] border border-[#EEE] px-3 py-2 text-xs text-[#111] focus:outline-none focus:border-[#E8553E]"
                >
                  {MONEDAS.map((m) => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>
                {monedaOrigen !== "CLP" && (
                  <input
                    type="number"
                    placeholder={`Monto en ${monedaOrigen}`}
                    value={montoMonedaOrigen}
                    onChange={(e) => setMontoMonedaOrigen(e.target.value)}
                    className="flex-1 rounded-xl bg-[#F5F5F3] border border-[#EEE] px-3 py-2 text-xs text-[#111] placeholder:text-[#AAA] focus:outline-none focus:border-[#E8553E]"
                  />
                )}
              </div>
              {monedaOrigen !== "CLP" && montoMonedaOrigen && totalNum > 0 && (
                <p className="text-[9px] text-[#BBB] mt-1">
                  {formatMonto(totalNum)} CLP = {montoMonedaOrigen} {monedaOrigen}
                </p>
              )}
            </div>
          )}

          {/* Notas */}
          <textarea
            value={notas}
            onChange={(e) => setNotas(e.target.value)}
            placeholder="Notas..."
            rows={2}
            className="w-full rounded-xl bg-white/5 border border-[#EEE] px-3 py-2 text-sm text-white placeholder:text-[#BBB] focus:outline-none focus:border-blue-400/50 resize-none"
          />

          {/* Save / Cancel */}
          <div className="flex gap-2">
            <button
              onClick={handleGuardarEdicion}
              disabled={loading}
              className="flex-1 rounded-xl bg-[#E8553E] hover:bg-[#d44a35] disabled:opacity-50 px-3 py-2 text-xs font-semibold text-white transition-colors"
            >
              Guardar
            </button>
            <button
              onClick={() => setEditing(false)}
              className="rounded-xl bg-[#F5F5F3] hover:bg-[#EEE] px-3 py-2 text-xs text-[#555] transition-colors"
            >
              Cancelar
            </button>
          </div>
        </div>
      ) : (
        <>
          {propuesta.notas && (
            <p className="text-xs text-[#AAA] italic">{propuesta.notas}</p>
          )}

          {/* Client selector */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <select
                value={showNewCliente ? "__new__" : selectedClienteId}
                onChange={(e) => {
                  if (e.target.value === "__new__") {
                    setShowNewCliente(true);
                    setSelectedClienteId("");
                  } else {
                    setShowNewCliente(false);
                    setSelectedClienteId(e.target.value);
                  }
                }}
                className="flex-1 rounded-xl bg-[#F5F5F3] border border-[#EEE] px-3 py-2 text-xs text-[#111] focus:outline-none focus:border-[#E8553E]"
              >
                <option value="">Sin cliente asignado</option>
                {clientes.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.nombre}{c.rut ? ` (${c.rut})` : ""}
                  </option>
                ))}
                <option value="__new__">+ Crear cliente nuevo</option>
              </select>
            </div>

            {showNewCliente && (
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="Nombre *"
                  value={newClienteNombre}
                  onChange={(e) => setNewClienteNombre(e.target.value)}
                  className="flex-1 rounded-xl bg-[#F5F5F3] border border-[#EEE] px-3 py-2 text-xs text-[#111] placeholder:text-[#AAA] focus:outline-none focus:border-[#E8553E]"
                />
                <input
                  type="text"
                  placeholder="RUT"
                  value={newClienteRut}
                  onChange={(e) => setNewClienteRut(e.target.value)}
                  className="w-28 rounded-xl bg-[#F5F5F3] border border-[#EEE] px-3 py-2 text-xs text-[#111] placeholder:text-[#AAA] focus:outline-none focus:border-[#E8553E]"
                />
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="flex gap-2">
            <button
              onClick={handleAprobar}
              disabled={loading}
              className="flex-1 rounded-xl bg-[#E8553E] hover:bg-[#d44a35] disabled:opacity-50 px-3 py-2.5 text-xs font-semibold text-white transition-colors"
            >
              Aprobar
            </button>
            <button
              onClick={() => setEditing(true)}
              disabled={loading}
              className="flex-1 rounded-xl bg-[#F5F5F3] hover:bg-[#EEE] disabled:opacity-50 px-3 py-2.5 text-xs font-medium text-[#555] transition-colors"
            >
              Editar
            </button>
            <button
              onClick={handleDescartar}
              disabled={loading}
              className="flex-1 rounded-xl bg-[#F5F5F3] hover:bg-[#EEE] disabled:opacity-50 px-3 py-2.5 text-xs font-medium text-[#888] transition-colors"
            >
              Ignorar
            </button>
          </div>
        </>
      )}
    </div>
  );
}
