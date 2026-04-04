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
    color: "bg-blue-500/20 text-blue-300",
  },
  {
    label: "Factura afecta",
    tipoDb: "factura",
    tieneIva: true,
    tooltip: "IVA 19%. Declara en F29 mensual.",
    color: "bg-purple-500/20 text-purple-300",
  },
  {
    label: "Compraventa crypto/activo digital",
    tipoDb: "registro_crypto",
    tieneIva: false,
    tooltip: "Sin IVA (SII Oficio 963-2018). Declara mayor valor en F22 anual.",
    color: "bg-yellow-500/20 text-yellow-300",
  },
  {
    label: "Transferencia P2P",
    tipoDb: "transferencia_p2p",
    tieneIva: false,
    tooltip: "Sin IVA. Puede generar obligacion F22 si supera 50 tx/mes (Ley Cumplimiento 2024).",
    color: "bg-cyan-500/20 text-cyan-300",
  },
  {
    label: "Operacion forex/divisa",
    tipoDb: "forex",
    tieneIva: false,
    tooltip: "Sin IVA. Declara diferencia de cambio en F22 anual.",
    color: "bg-indigo-500/20 text-indigo-300",
  },
  {
    label: "Gasto/egreso",
    tipoDb: "gasto",
    tieneIva: true,
    tooltip: "Gasto con factura recibida. IVA credito fiscal.",
    color: "bg-orange-500/20 text-orange-300",
  },
  {
    label: "No comercial / personal",
    tipoDb: "ignorar",
    tieneIva: false,
    tooltip: "Sin efecto tributario. Se ignora para F29 y F22.",
    color: "bg-white/10 text-white/40",
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
      ? "text-emerald-400"
      : pct >= 60
        ? "text-yellow-400"
        : "text-red-400";
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
      className={`rounded-2xl bg-white/5 backdrop-blur-sm border p-4 space-y-3 ${
        isLowConfidence ? "border-red-500/30" : "border-white/10"
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
        <p className="text-sm text-white/90">{mov.descripcion}</p>
        <div className="flex items-center gap-3 mt-1.5 text-xs text-white/50">
          <span>{mov.fecha}</span>
          <span className={mov.tipo_flujo === "entrada" ? "text-emerald-400" : "text-red-400"}>
            {mov.tipo_flujo === "entrada" ? "+" : "-"}{formatMonto(mov.monto)}
          </span>
          {propuesta.receptor_nombre && (
            <span className="truncate">{propuesta.receptor_nombre}</span>
          )}
        </div>
      </div>

      {/* Desglose montos */}
      <div className="grid grid-cols-3 gap-2 text-center">
        <div className="rounded-xl bg-white/5 px-2 py-1.5">
          <p className="text-[10px] text-white/40">Neto</p>
          <p className="text-xs font-medium">
            {editing ? formatMonto(editNeto) : formatMonto(propuesta.monto_neto)}
          </p>
        </div>
        <div className="rounded-xl bg-white/5 px-2 py-1.5">
          <p className="text-[10px] text-white/40">IVA</p>
          <p className="text-xs font-medium">
            {editing ? formatMonto(editIva) : formatMonto(propuesta.iva)}
          </p>
        </div>
        <div className="rounded-xl bg-white/5 px-2 py-1.5">
          <p className="text-[10px] text-white/40">Total</p>
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
            <p className="text-xs font-semibold text-emerald-400">{formatMonto(propuesta.spread_ganancia)}</p>
          </div>
        </div>
      )}

      {/* Moneda origen (display) */}
      {!editing && propuesta.moneda_origen && propuesta.moneda_origen !== "CLP" && (
        <p className="text-[10px] text-white/30">
          Moneda origen: {propuesta.monto_moneda_origen} {propuesta.moneda_origen}
        </p>
      )}

      {/* Low confidence warning */}
      {isLowConfidence && !editing && (
        <p className="text-xs text-red-400/80 bg-red-500/10 rounded-lg px-3 py-1.5">
          Confianza baja — revisa antes de aprobar
        </p>
      )}

      {/* EDIT MODE */}
      {editing ? (
        <div className="space-y-2.5">
          {/* Categoria tributaria */}
          <div>
            <label className="text-[10px] text-white/40 mb-1 block">Categoria tributaria</label>
            <select
              value={tipoEdit}
              onChange={(e) => setTipoEdit(e.target.value)}
              className="w-full rounded-xl bg-white/5 border border-white/10 px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-400/50"
            >
              {CATEGORIAS.map((c) => (
                <option key={c.tipoDb} value={c.tipoDb}>{c.label}</option>
              ))}
            </select>
            {/* Tooltip */}
            <p className="text-[10px] text-white/25 mt-1">{cat.tooltip}</p>
          </div>

          {/* Live IVA preview */}
          <div className="flex gap-2 text-center">
            <div className="flex-1 rounded-lg bg-white/[0.03] border border-white/5 px-2 py-1.5">
              <p className="text-[9px] text-white/30">Neto</p>
              <p className="text-[11px] font-medium text-white/70">{formatMonto(editNeto)}</p>
            </div>
            <div className="flex-1 rounded-lg bg-white/[0.03] border border-white/5 px-2 py-1.5">
              <p className="text-[9px] text-white/30">IVA {cat.tieneIva ? "19%" : "exento"}</p>
              <p className="text-[11px] font-medium text-white/70">{formatMonto(editIva)}</p>
            </div>
          </div>

          {/* Receptor/Pagador */}
          <div>
            <label className="text-[10px] text-white/40 mb-1 block">Receptor / Pagador</label>
            <div className="flex gap-2">
              <input
                type="text"
                placeholder="Nombre"
                value={receptorNombre}
                onChange={(e) => setReceptorNombre(e.target.value)}
                className="flex-1 rounded-xl bg-white/5 border border-white/10 px-3 py-2 text-xs text-white placeholder:text-white/30 focus:outline-none focus:border-blue-400/50"
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
                  className={`w-full rounded-xl bg-white/5 border px-3 py-2 text-xs text-white placeholder:text-white/30 focus:outline-none focus:border-blue-400/50 ${
                    receptorRut.trim() && !validarRut(receptorRut)
                      ? "border-red-500/50"
                      : "border-white/10"
                  }`}
                />
                {receptorRut.trim() && !validarRut(receptorRut) && (
                  <p className="text-[9px] text-red-400 mt-0.5">RUT invalido</p>
                )}
              </div>
            </div>
          </div>

          {/* Moneda origen (for crypto/forex/p2p) */}
          {(cat.tipoDb === "registro_crypto" || cat.tipoDb === "forex" || cat.tipoDb === "transferencia_p2p") && (
            <div>
              <label className="text-[10px] text-white/40 mb-1 block">Moneda origen (opcional)</label>
              <div className="flex gap-2">
                <select
                  value={monedaOrigen}
                  onChange={(e) => setMonedaOrigen(e.target.value)}
                  className="w-24 rounded-xl bg-white/5 border border-white/10 px-3 py-2 text-xs text-white focus:outline-none focus:border-blue-400/50"
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
                    className="flex-1 rounded-xl bg-white/5 border border-white/10 px-3 py-2 text-xs text-white placeholder:text-white/30 focus:outline-none focus:border-blue-400/50"
                  />
                )}
              </div>
              {monedaOrigen !== "CLP" && montoMonedaOrigen && totalNum > 0 && (
                <p className="text-[9px] text-white/25 mt-1">
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
            className="w-full rounded-xl bg-white/5 border border-white/10 px-3 py-2 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-blue-400/50 resize-none"
          />

          {/* Save / Cancel */}
          <div className="flex gap-2">
            <button
              onClick={handleGuardarEdicion}
              disabled={loading}
              className="flex-1 rounded-xl bg-blue-500 hover:bg-blue-600 disabled:opacity-50 px-3 py-2 text-xs font-semibold text-white transition-colors"
            >
              Guardar
            </button>
            <button
              onClick={() => setEditing(false)}
              className="rounded-xl bg-white/10 hover:bg-white/15 px-3 py-2 text-xs text-white/70 transition-colors"
            >
              Cancelar
            </button>
          </div>
        </div>
      ) : (
        <>
          {propuesta.notas && (
            <p className="text-xs text-white/40 italic">{propuesta.notas}</p>
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
                className="flex-1 rounded-xl bg-white/5 border border-white/10 px-3 py-2 text-xs text-white focus:outline-none focus:border-blue-400/50"
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
                  className="flex-1 rounded-xl bg-white/5 border border-white/10 px-3 py-2 text-xs text-white placeholder:text-white/30 focus:outline-none focus:border-blue-400/50"
                />
                <input
                  type="text"
                  placeholder="RUT"
                  value={newClienteRut}
                  onChange={(e) => setNewClienteRut(e.target.value)}
                  className="w-28 rounded-xl bg-white/5 border border-white/10 px-3 py-2 text-xs text-white placeholder:text-white/30 focus:outline-none focus:border-blue-400/50"
                />
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="flex gap-2">
            <button
              onClick={handleAprobar}
              disabled={loading}
              className="flex-1 rounded-xl bg-emerald-500/20 hover:bg-emerald-500/30 disabled:opacity-50 px-3 py-2.5 text-xs font-semibold text-emerald-300 transition-colors"
            >
              Aprobar
            </button>
            <button
              onClick={() => setEditing(true)}
              disabled={loading}
              className="flex-1 rounded-xl bg-white/10 hover:bg-white/15 disabled:opacity-50 px-3 py-2.5 text-xs font-medium text-white/70 transition-colors"
            >
              Editar
            </button>
            <button
              onClick={handleDescartar}
              disabled={loading}
              className="flex-1 rounded-xl bg-red-500/10 hover:bg-red-500/20 disabled:opacity-50 px-3 py-2.5 text-xs font-medium text-red-300/70 transition-colors"
            >
              Ignorar
            </button>
          </div>
        </>
      )}
    </div>
  );
}
