"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Tables } from "@/lib/database.types";
import { formatRut, validarRut } from "@/lib/rut";
import { crearCliente, editarCliente, eliminarCliente } from "./actions";
import { PencilSimple, Trash, Plus, Users } from "@phosphor-icons/react";

type Cliente = Tables<"clientes"> & { movimientos_count: number };

interface ClientesClientProps {
  clientes: Cliente[];
  empresaId: string;
}

const TRANSFER_WARNING = 40;
const TRANSFER_DANGER = 50;

function Avatar({ nombre }: { nombre: string }) {
  const initials = nombre.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase();
  return (
    <div className="w-9 h-9 rounded-full bg-[var(--accent-light)] flex items-center justify-center shrink-0">
      <span className="text-xs font-bold text-[#E8553E]">{initials}</span>
    </div>
  );
}

function TransferBadge({ count }: { count: number }) {
  if (count === 0) return null;
  const color =
    count >= TRANSFER_DANGER ? "bg-[var(--accent-light)] text-[#E8553E] font-semibold"
    : count >= TRANSFER_WARNING ? "bg-[#FFF8ED] dark:bg-[#F59E0B]/15 text-[#F59E0B]"
    : "bg-[var(--surface)] text-[var(--muted)]";
  return (
    <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${color} tabular-nums`}>
      {count} mov.{count >= TRANSFER_DANGER && " — LIMITE SII"}{count >= TRANSFER_WARNING && count < TRANSFER_DANGER && " — cerca"}
    </span>
  );
}

function ClienteForm({ empresaId, cliente, onClose }: { empresaId: string; cliente?: Cliente; onClose: () => void }) {
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
    e.preventDefault(); setError(""); setLoading(true);
    const result = cliente
      ? await editarCliente(cliente.id, { nombre, rut, email, telefono, notas })
      : await crearCliente({ empresa_id: empresaId, nombre, rut, email, telefono, notas });
    if ("error" in result && result.error) { setError(result.error); setLoading(false); return; }
    router.refresh(); onClose(); setLoading(false);
  }

  const inputCls = "w-full rounded-xl bg-[var(--surface)] border border-[var(--border)] px-3 py-2.5 text-sm text-[var(--foreground)] placeholder:text-[var(--muted-light)] focus:outline-none focus:border-[#E8553E] transition-colors";

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/30 dark:bg-black/60 animate-fade-in">
      <form onSubmit={handleSubmit} className="w-full max-w-lg bg-white dark:bg-[#1c1c1e] rounded-t-[20px] sm:rounded-[20px] p-5 space-y-4 shadow-[0_-4px_24px_rgba(0,0,0,0.1)] animate-fade-in-up">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold text-[var(--foreground)]">{cliente ? "Editar cliente" : "Nuevo cliente"}</h2>
          <button type="button" onClick={onClose} className="text-[var(--muted-light)] hover:text-[var(--muted)] text-xl">×</button>
        </div>
        {error && <p className="text-xs text-[#E8553E] bg-[var(--accent-light)] rounded-lg px-3 py-2">{error}</p>}
        <input type="text" placeholder="Nombre *" value={nombre} onChange={(e) => setNombre(e.target.value)} required className={inputCls} />
        <div>
          <input type="text" placeholder="RUT (ej: 12.345.678-5)" value={rut} onChange={(e) => setRut(e.target.value)}
            onBlur={() => { if (rut.trim() && validarRut(rut)) setRut(formatRut(rut)); }}
            className={`${inputCls} ${rutError ? "!border-[#E8553E]" : ""}`} />
          {rutError && <p className="text-[10px] text-[#E8553E] mt-1">{rutError}</p>}
        </div>
        <input type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} className={inputCls} />
        <input type="tel" placeholder="Teléfono" value={telefono} onChange={(e) => setTelefono(e.target.value)} className={inputCls} />
        <textarea placeholder="Notas" value={notas} onChange={(e) => setNotas(e.target.value)} rows={2} className={`${inputCls} resize-none`} />
        <div className="flex gap-2">
          <button type="submit" disabled={loading || !!rutError}
            className="btn-press flex-1 rounded-xl bg-[#E8553E] hover:bg-[var(--accent-hover)] disabled:opacity-50 px-4 py-2.5 text-sm font-semibold text-white transition-all duration-150">
            {loading ? "Guardando..." : cliente ? "Guardar" : "Crear"}
          </button>
          <button type="button" onClick={onClose}
            className="btn-press rounded-xl bg-[var(--surface)] hover:bg-[var(--border)] px-4 py-2.5 text-sm text-[var(--muted)] transition-all duration-150">Cancelar</button>
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
    setDeletingId(id); await eliminarCliente(id); router.refresh(); setDeletingId(null);
  }

  return (
    <div className="flex-1 pb-24">
      <div className="max-w-lg mx-auto px-4 py-6 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-[28px] font-extrabold text-[var(--foreground)]">Clientes</h1>
            <p className="text-sm text-[var(--muted)] mt-0.5">{clientes.length} cliente{clientes.length !== 1 ? "s" : ""}</p>
          </div>
          <button onClick={() => { setEditingCliente(undefined); setShowForm(true); }}
            className="btn-press flex items-center gap-1.5 rounded-xl bg-[#E8553E] hover:bg-[var(--accent-hover)] px-4 py-2.5 text-xs font-semibold text-white transition-all duration-150">
            <Plus size={16} weight="bold" /> Agregar
          </button>
        </div>

        <input type="text" placeholder="Buscar por nombre o RUT..." value={search} onChange={(e) => setSearch(e.target.value)}
          className="w-full rounded-xl bg-white dark:bg-white/5 border border-[var(--border)] px-3 py-2.5 text-sm text-[var(--foreground)] placeholder:text-[var(--muted-light)] focus:outline-none focus:border-[#E8553E] shadow-[var(--card-shadow)] dark:shadow-none transition-colors" />

        {filtered.length === 0 ? (
          <div className="text-center py-12 text-[var(--muted-light)]">
            <Users size={48} weight="light" className="mx-auto mb-3 text-[var(--border)]" />
            <p className="text-sm">{search ? "Sin resultados" : "No hay clientes aun"}</p>
          </div>
        ) : (
          <div className="rounded-[20px] bg-white dark:bg-white/5 shadow-[var(--card-shadow)] dark:shadow-none divide-y divide-[var(--border)]">
            {filtered.map((c) => (
              <div key={c.id} className="px-4 py-3 animate-fade-in">
                <div className="flex items-start gap-3">
                  <Avatar nombre={c.nombre} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium text-[var(--foreground)] truncate">{c.nombre}</p>
                      <TransferBadge count={c.movimientos_count} />
                    </div>
                    <div className="flex items-center gap-3 mt-1 text-xs text-[var(--muted-light)]">
                      {c.rut && <span className="tabular-nums">{c.rut}</span>}
                      {c.email && <span className="truncate">{c.email}</span>}
                      {c.telefono && <span>{c.telefono}</span>}
                    </div>
                    {c.notas && <p className="text-[10px] text-[var(--muted-light)] mt-1 truncate">{c.notas}</p>}
                  </div>
                  <div className="flex gap-1.5 shrink-0">
                    <button onClick={() => { setEditingCliente(c); setShowForm(true); }}
                      className="btn-press p-2 rounded-lg bg-[var(--surface)] hover:bg-[var(--border)] transition-all duration-150">
                      <PencilSimple size={14} className="text-[var(--muted)]" />
                    </button>
                    <button onClick={() => handleDelete(c.id)} disabled={deletingId === c.id}
                      className="btn-press p-2 rounded-lg bg-[var(--accent-light)] hover:bg-[#FFE4E0] disabled:opacity-50 transition-all duration-150">
                      <Trash size={14} className="text-[#E8553E]" />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {showForm && <ClienteForm empresaId={empresaId} cliente={editingCliente} onClose={() => setShowForm(false)} />}
      </div>
    </div>
  );
}
