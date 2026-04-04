"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Tables } from "@/lib/database.types";
import { formatRut, validarRut } from "@/lib/rut";
import { crearCliente, editarCliente, eliminarCliente } from "./actions";

type Cliente = Tables<"clientes"> & {
  movimientos_count: number;
};

interface ClientesClientProps {
  clientes: Cliente[];
  empresaId: string;
}

const TRANSFER_WARNING = 40;
const TRANSFER_DANGER = 50;

function TransferBadge({ count }: { count: number }) {
  if (count === 0) return null;

  const color =
    count >= TRANSFER_DANGER
      ? "bg-[#FFF0EE] text-[#E8553E] font-semibold"
      : count >= TRANSFER_WARNING
        ? "bg-[#FFF8ED] text-[#F59E0B]"
        : "bg-[#F5F5F3] text-[#888]";

  return (
    <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${color}`}>
      {count} mov.
      {count >= TRANSFER_DANGER && " — LIMITE SII"}
      {count >= TRANSFER_WARNING && count < TRANSFER_DANGER && " — cerca del limite"}
    </span>
  );
}

function ClienteForm({
  empresaId,
  cliente,
  onClose,
}: {
  empresaId: string;
  cliente?: Cliente;
  onClose: () => void;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [nombre, setNombre] = useState(cliente?.nombre ?? "");
  const [rut, setRut] = useState(cliente?.rut ?? "");
  const [email, setEmail] = useState(cliente?.email ?? "");
  const [telefono, setTelefono] = useState(cliente?.telefono ?? "");
  const [notas, setNotas] = useState(cliente?.notas ?? "");

  const rutError = rut.trim() && !validarRut(rut) ? "RUT inválido" : "";

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    const result = cliente
      ? await editarCliente(cliente.id, { nombre, rut, email, telefono, notas })
      : await crearCliente({ empresa_id: empresaId, nombre, rut, email, telefono, notas });

    if ("error" in result && result.error) {
      setError(result.error);
      setLoading(false);
      return;
    }

    router.refresh();
    onClose();
    setLoading(false);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/30">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-lg bg-white rounded-t-[20px] sm:rounded-[20px] p-5 space-y-4 shadow-[0_-4px_24px_rgba(0,0,0,0.1)]"
      >
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold text-[#111]">
            {cliente ? "Editar cliente" : "Nuevo cliente"}
          </h2>
          <button type="button" onClick={onClose} className="text-[#AAA] hover:text-[#888] text-xl">
            ×
          </button>
        </div>

        {error && (
          <p className="text-xs text-[#E8553E] bg-[#FFF0EE] rounded-lg px-3 py-2">{error}</p>
        )}

        <input
          type="text"
          placeholder="Nombre *"
          value={nombre}
          onChange={(e) => setNombre(e.target.value)}
          required
          className="w-full rounded-xl bg-[#F5F5F3] border border-[#EEE] px-3 py-2.5 text-sm text-[#111] placeholder:text-[#AAA] focus:outline-none focus:border-[#E8553E]"
        />

        <div>
          <input
            type="text"
            placeholder="RUT (ej: 12.345.678-5)"
            value={rut}
            onChange={(e) => setRut(e.target.value)}
            onBlur={() => { if (rut.trim() && validarRut(rut)) setRut(formatRut(rut)); }}
            className={`w-full rounded-xl bg-[#F5F5F3] border px-3 py-2.5 text-sm text-[#111] placeholder:text-[#AAA] focus:outline-none focus:border-[#E8553E] ${
              rutError ? "border-[#E8553E]" : "border-[#EEE]"
            }`}
          />
          {rutError && <p className="text-[10px] text-[#E8553E] mt-1">{rutError}</p>}
        </div>

        <input type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)}
          className="w-full rounded-xl bg-[#F5F5F3] border border-[#EEE] px-3 py-2.5 text-sm text-[#111] placeholder:text-[#AAA] focus:outline-none focus:border-[#E8553E]" />

        <input type="tel" placeholder="Teléfono" value={telefono} onChange={(e) => setTelefono(e.target.value)}
          className="w-full rounded-xl bg-[#F5F5F3] border border-[#EEE] px-3 py-2.5 text-sm text-[#111] placeholder:text-[#AAA] focus:outline-none focus:border-[#E8553E]" />

        <textarea placeholder="Notas" value={notas} onChange={(e) => setNotas(e.target.value)} rows={2}
          className="w-full rounded-xl bg-[#F5F5F3] border border-[#EEE] px-3 py-2.5 text-sm text-[#111] placeholder:text-[#AAA] focus:outline-none focus:border-[#E8553E] resize-none" />

        <div className="flex gap-2">
          <button type="submit" disabled={loading || !!rutError}
            className="flex-1 rounded-xl bg-[#E8553E] hover:bg-[#d44a35] disabled:opacity-50 px-4 py-2.5 text-sm font-semibold text-white transition-colors">
            {loading ? "Guardando..." : cliente ? "Guardar" : "Crear"}
          </button>
          <button type="button" onClick={onClose}
            className="rounded-xl bg-[#F5F5F3] hover:bg-[#EEEEEE] px-4 py-2.5 text-sm text-[#888] transition-colors">
            Cancelar
          </button>
        </div>
      </form>
    </div>
  );
}

export default function ClientesClient({ clientes, empresaId }: ClientesClientProps) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [editingCliente, setEditingCliente] = useState<Cliente | undefined>();
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const filtered = clientes.filter((c) => {
    const q = search.toLowerCase();
    return c.nombre.toLowerCase().includes(q) || (c.rut && c.rut.toLowerCase().includes(q));
  });

  async function handleDelete(id: string) {
    setDeletingId(id);
    await eliminarCliente(id);
    router.refresh();
    setDeletingId(null);
  }

  return (
    <div className="flex-1 pb-20">
      <div className="max-w-lg mx-auto px-4 py-6 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-[#111]">Clientes</h1>
            <p className="text-sm text-[#888] mt-0.5">
              {clientes.length} cliente{clientes.length !== 1 ? "s" : ""}
            </p>
          </div>
          <button
            onClick={() => { setEditingCliente(undefined); setShowForm(true); }}
            className="rounded-xl bg-[#E8553E] hover:bg-[#d44a35] px-4 py-2.5 text-xs font-semibold text-white transition-colors">
            + Agregar
          </button>
        </div>

        <input type="text" placeholder="Buscar por nombre o RUT..." value={search} onChange={(e) => setSearch(e.target.value)}
          className="w-full rounded-xl bg-white border border-[#EEE] px-3 py-2.5 text-sm text-[#111] placeholder:text-[#AAA] focus:outline-none focus:border-[#E8553E] shadow-[0_2px_12px_rgba(0,0,0,0.06)]" />

        {filtered.length === 0 ? (
          <div className="text-center py-12 text-[#AAA]">
            <p className="text-3xl mb-2">👤</p>
            <p className="text-sm">{search ? "Sin resultados" : "No hay clientes aun"}</p>
          </div>
        ) : (
          <div className="rounded-[20px] bg-white shadow-[0_2px_12px_rgba(0,0,0,0.06)] divide-y divide-[#EEEEEE]">
            {filtered.map((c) => (
              <div key={c.id} className="px-4 py-3">
                <div className="flex items-start gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium text-[#111] truncate">{c.nombre}</p>
                      <TransferBadge count={c.movimientos_count} />
                    </div>
                    <div className="flex items-center gap-3 mt-1 text-xs text-[#AAA]">
                      {c.rut && <span>{c.rut}</span>}
                      {c.email && <span className="truncate">{c.email}</span>}
                      {c.telefono && <span>{c.telefono}</span>}
                    </div>
                    {c.notas && <p className="text-[10px] text-[#BBB] mt-1 truncate">{c.notas}</p>}
                  </div>
                  <div className="flex gap-1.5 shrink-0">
                    <button onClick={() => { setEditingCliente(c); setShowForm(true); }}
                      className="rounded-lg bg-[#F5F5F3] hover:bg-[#EEE] px-2.5 py-1.5 text-[10px] text-[#888] transition-colors">
                      Editar
                    </button>
                    <button onClick={() => handleDelete(c.id)} disabled={deletingId === c.id}
                      className="rounded-lg bg-[#FFF0EE] hover:bg-[#FFE4E0] disabled:opacity-50 px-2.5 py-1.5 text-[10px] text-[#E8553E] transition-colors">
                      {deletingId === c.id ? "..." : "Eliminar"}
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {showForm && (
          <ClienteForm empresaId={empresaId} cliente={editingCliente} onClose={() => setShowForm(false)} />
        )}
      </div>
    </div>
  );
}
