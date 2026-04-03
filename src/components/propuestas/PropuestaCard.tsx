"use client";

import { useState } from "react";
import type { Tables } from "@/lib/database.types";
import {
  aprobarPropuesta,
  descartarPropuesta,
  editarPropuesta,
} from "@/app/(app)/revisar/actions";

type Propuesta = Tables<"propuestas_ia"> & {
  movimientos_raw: Tables<"movimientos_raw">;
};

interface PropuestaCardProps {
  propuesta: Propuesta;
  onAction?: () => void;
}

const TIPO_LABEL: Record<string, { label: string; color: string }> = {
  boleta: { label: "Boleta", color: "bg-blue-500/20 text-blue-300" },
  factura: { label: "Factura", color: "bg-purple-500/20 text-purple-300" },
  gasto: { label: "Gasto", color: "bg-orange-500/20 text-orange-300" },
  registro_crypto: { label: "Crypto", color: "bg-yellow-500/20 text-yellow-300" },
  ignorar: { label: "Ignorar", color: "bg-white/10 text-white/40" },
};

function formatMonto(monto: number | null): string {
  if (monto === null) return "$0";
  return `$${Math.round(monto).toLocaleString("es-CL")}`;
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

export default function PropuestaCard({
  propuesta,
  onAction,
}: PropuestaCardProps) {
  const [editing, setEditing] = useState(false);
  const [loading, setLoading] = useState(false);
  const [notas, setNotas] = useState(propuesta.notas || "");
  const [tipoEdit, setTipoEdit] = useState(propuesta.tipo_propuesto);

  const mov = propuesta.movimientos_raw;
  const tipo = TIPO_LABEL[propuesta.tipo_propuesto] ?? TIPO_LABEL.ignorar;
  const isCrypto = propuesta.tipo_propuesto === "registro_crypto";
  const isLowConfidence =
    propuesta.confianza !== null && propuesta.confianza < 0.6;

  async function handleAprobar() {
    setLoading(true);
    await aprobarPropuesta(propuesta.id);
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
    await editarPropuesta(propuesta.id, {
      tipo_propuesto: tipoEdit,
      notas: notas || null,
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
        <span
          className={`text-xs px-2.5 py-1 rounded-full font-medium ${tipo.color}`}
        >
          {tipo.label}
        </span>
        <ConfianzaBadge confianza={propuesta.confianza} />
      </div>

      {/* Movimiento info */}
      <div>
        <p className="text-sm text-white/90">{mov.descripcion}</p>
        <div className="flex items-center gap-3 mt-1.5 text-xs text-white/50">
          <span>{mov.fecha}</span>
          <span
            className={
              mov.tipo_flujo === "entrada" ? "text-emerald-400" : "text-red-400"
            }
          >
            {mov.tipo_flujo === "entrada" ? "+" : "-"}
            {formatMonto(mov.monto)}
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
          <p className="text-xs font-medium">{formatMonto(propuesta.monto_neto)}</p>
        </div>
        <div className="rounded-xl bg-white/5 px-2 py-1.5">
          <p className="text-[10px] text-white/40">IVA</p>
          <p className="text-xs font-medium">{formatMonto(propuesta.iva)}</p>
        </div>
        <div className="rounded-xl bg-white/5 px-2 py-1.5">
          <p className="text-[10px] text-white/40">Total</p>
          <p className="text-xs font-semibold">{formatMonto(propuesta.total)}</p>
        </div>
      </div>

      {/* Spread crypto */}
      {isCrypto &&
        (propuesta.spread_compra || propuesta.spread_venta) && (
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="rounded-xl bg-yellow-500/5 px-2 py-1.5">
              <p className="text-[10px] text-yellow-400/60">Compra</p>
              <p className="text-xs font-medium text-yellow-300">
                {formatMonto(propuesta.spread_compra)}
              </p>
            </div>
            <div className="rounded-xl bg-yellow-500/5 px-2 py-1.5">
              <p className="text-[10px] text-yellow-400/60">Venta</p>
              <p className="text-xs font-medium text-yellow-300">
                {formatMonto(propuesta.spread_venta)}
              </p>
            </div>
            <div className="rounded-xl bg-yellow-500/5 px-2 py-1.5">
              <p className="text-[10px] text-yellow-400/60">Ganancia</p>
              <p className="text-xs font-semibold text-emerald-400">
                {formatMonto(propuesta.spread_ganancia)}
              </p>
            </div>
          </div>
        )}

      {/* Low confidence warning */}
      {isLowConfidence && (
        <p className="text-xs text-red-400/80 bg-red-500/10 rounded-lg px-3 py-1.5">
          Confianza baja — revisa antes de aprobar
        </p>
      )}

      {/* Notas / edicion */}
      {editing ? (
        <div className="space-y-2">
          <select
            value={tipoEdit}
            onChange={(e) => setTipoEdit(e.target.value)}
            className="w-full rounded-xl bg-white/5 border border-white/10 px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-400/50"
          >
            <option value="boleta">Boleta</option>
            <option value="factura">Factura</option>
            <option value="gasto">Gasto</option>
            <option value="registro_crypto">Crypto</option>
            <option value="ignorar">Ignorar</option>
          </select>
          <textarea
            value={notas}
            onChange={(e) => setNotas(e.target.value)}
            placeholder="Notas..."
            rows={2}
            className="w-full rounded-xl bg-white/5 border border-white/10 px-3 py-2 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-blue-400/50 resize-none"
          />
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
