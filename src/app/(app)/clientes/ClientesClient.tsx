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
      ? "bg-red-500/20 text-red-300"
      : count >= TRANSFER_WARNING
        ? "bg-yellow-500/20 text-yellow-300"
        : "bg-white/10 text-white/50";

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
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-lg bg-[#1c1c1e] border border-white/10 rounded-t-2xl sm:rounded-2xl p-5 space-y-4"
      >
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold text-white">
            {cliente ? "Editar cliente" : "Nuevo cliente"}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="text-white/40 hover:text-white/70 text-xl"
          >
            ×
          </button>
        </div>

        {error && (
          <p className="text-xs text-red-400 bg-red-500/10 rounded-lg px-3 py-2">
            {error}
          </p>
        )}

        <input
          type="text"
          placeholder="Nombre *"
          value={nombre}
          onChange={(e) => setNombre(e.target.value)}
          required
          className="w-full rounded-xl bg-white/5 border border-white/10 px-3 py-2.5 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-blue-400/50"
        />

        <div>
          <input
            type="text"
            placeholder="RUT (ej: 12.345.678-5)"
            value={rut}
            onChange={(e) => setRut(e.target.value)}
            onBlur={() => {
              if (rut.trim() && validarRut(rut)) setRut(formatRut(rut));
            }}
            className={`w-full rounded-xl bg-white/5 border px-3 py-2.5 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-blue-400/50 ${
              rutError ? "border-red-500/50" : "border-white/10"
            }`}
          />
          {rutError && (
            <p className="text-[10px] text-red-400 mt-1">{rutError}</p>
          )}
        </div>

        <input
          type="email"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full rounded-xl bg-white/5 border border-white/10 px-3 py-2.5 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-blue-400/50"
        />

        <input
          type="tel"
          placeholder="Teléfono"
          value={telefono}
          onChange={(e) => setTelefono(e.target.value)}
          className="w-full rounded-xl bg-white/5 border border-white/10 px-3 py-2.5 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-blue-400/50"
        />

        <textarea
          placeholder="Notas"
          value={notas}
          onChange={(e) => setNotas(e.target.value)}
          rows={2}
          className="w-full rounded-xl bg-white/5 border border-white/10 px-3 py-2.5 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-blue-400/50 resize-none"
        />

        <div className="flex gap-2">
          <button
            type="submit"
            disabled={loading || !!rutError}
            className="flex-1 rounded-xl bg-blue-500 hover:bg-blue-600 disabled:opacity-50 px-4 py-2.5 text-sm font-semibold text-white transition-colors"
          >
            {loading ? "Guardando..." : cliente ? "Guardar" : "Crear"}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl bg-white/10 hover:bg-white/15 px-4 py-2.5 text-sm text-white/70 transition-colors"
          >
            Cancelar
          </button>
        </div>
      </form>
    </div>
  );
}

export default function ClientesClient({
  clientes,
  empresaId,
}: ClientesClientProps) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [editingCliente, setEditingCliente] = useState<Cliente | undefined>();
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const filtered = clientes.filter((c) => {
    const q = search.toLowerCase();
    return (
      c.nombre.toLowerCase().includes(q) ||
      (c.rut && c.rut.toLowerCase().includes(q))
    );
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
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-white">Clientes</h1>
            <p className="text-sm text-white/50 mt-0.5">
              {clientes.length} cliente{clientes.length !== 1 ? "s" : ""}
            </p>
          </div>
          <button
            onClick={() => {
              setEditingCliente(undefined);
              setShowForm(true);
            }}
            className="rounded-xl bg-blue-500 hover:bg-blue-600 px-4 py-2.5 text-xs font-semibold text-white transition-colors"
          >
            + Agregar
          </button>
        </div>

        {/* Search */}
        <input
          type="text"
          placeholder="Buscar por nombre o RUT..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full rounded-xl bg-white/5 border border-white/10 px-3 py-2.5 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-blue-400/50"
        />

        {/* List */}
        {filtered.length === 0 ? (
          <div className="text-center py-12 text-white/40">
            <p className="text-3xl mb-2">👤</p>
            <p className="text-sm">
              {search ? "Sin resultados" : "No hay clientes aun"}
            </p>
          </div>
        ) : (
          <div className="rounded-2xl bg-white/5 backdrop-blur-sm border border-white/10 divide-y divide-white/10">
            {filtered.map((c) => (
              <div key={c.id} className="px-4 py-3">
                <div className="flex items-start gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium text-white/90 truncate">
                        {c.nombre}
                      </p>
                      <TransferBadge count={c.movimientos_count} />
                    </div>
                    <div className="flex items-center gap-3 mt-1 text-xs text-white/40">
                      {c.rut && <span>{c.rut}</span>}
                      {c.email && <span className="truncate">{c.email}</span>}
                      {c.telefono && <span>{c.telefono}</span>}
                    </div>
                    {c.notas && (
                      <p className="text-[10px] text-white/30 mt-1 truncate">
                        {c.notas}
                      </p>
                    )}
                  </div>
                  <div className="flex gap-1.5 shrink-0">
                    <button
                      onClick={() => {
                        setEditingCliente(c);
                        setShowForm(true);
                      }}
                      className="rounded-lg bg-white/5 hover:bg-white/10 px-2.5 py-1.5 text-[10px] text-white/50 transition-colors"
                    >
                      Editar
                    </button>
                    <button
                      onClick={() => handleDelete(c.id)}
                      disabled={deletingId === c.id}
                      className="rounded-lg bg-red-500/10 hover:bg-red-500/20 disabled:opacity-50 px-2.5 py-1.5 text-[10px] text-red-300/70 transition-colors"
                    >
                      {deletingId === c.id ? "..." : "Eliminar"}
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Modal form */}
        {showForm && (
          <ClienteForm
            empresaId={empresaId}
            cliente={editingCliente}
            onClose={() => setShowForm(false)}
          />
        )}
      </div>
    </div>
  );
}
