"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import Link from "next/link";
import { CaretRight } from "@phosphor-icons/react";
import type { Tables } from "@/lib/database.types";

type Cliente = Pick<Tables<"clientes">, "id" | "nombre" | "rut" | "tipo_contribuyente">;

export default function ClientesEmpresa({ empresaId }: { empresaId: string }) {
  const [clientes, setClientes] = useState<Cliente[]>([]);

  useEffect(() => {
    supabase
      .from("clientes")
      .select("id, nombre, rut, tipo_contribuyente")
      .eq("empresa_id", empresaId)
      .order("nombre", { ascending: true })
      .then(({ data }) => setClientes(data ?? []));
  }, [empresaId]);

  if (clientes.length === 0) {
    return (
      <div className="p-4 rounded-xl bg-white dark:bg-white/5 border border-black/5 dark:border-white/10">
        <p className="text-xs text-[var(--muted-light)]">No hay clientes registrados.</p>
        <Link href="/clientes" className="text-xs text-[#E8553E] hover:underline mt-1 inline-block">
          Agregar clientes →
        </Link>
      </div>
    );
  }

  return (
    <div className="rounded-xl bg-white dark:bg-white/5 border border-black/5 dark:border-white/10 divide-y divide-[var(--border)]">
      {clientes.map((c) => (
        <div key={c.id} className="flex items-center gap-3 px-4 py-2.5">
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium text-[var(--foreground)] truncate">{c.nombre}</p>
            {c.rut && <p className="text-[10px] text-[var(--muted-light)]">{c.rut}</p>}
          </div>
          <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-semibold ${
            c.tipo_contribuyente === "exento"
              ? "bg-[#3B82F6]/10 text-[#3B82F6]"
              : "bg-[var(--accent-light)] text-[#E8553E]"
          }`}>
            {c.tipo_contribuyente === "exento" ? "EXENTO" : "AFECTO"}
          </span>
          <Link href="/clientes" className="text-[var(--muted-light)] hover:text-[var(--foreground)]">
            <CaretRight size={14} />
          </Link>
        </div>
      ))}
      <Link
        href="/clientes"
        className="flex items-center justify-center px-4 py-2.5 text-[10px] font-medium text-[#E8553E] hover:bg-[var(--accent-light)] transition-colors rounded-b-xl"
      >
        + Agregar o editar clientes
      </Link>
    </div>
  );
}
