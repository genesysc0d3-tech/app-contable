"use client";

import { useState, useTransition } from "react";
import { useToast } from "@/components/Toast";
import { crearInvitacionEmpresa } from "./actions";

interface MiembroRow {
  id: string;
  email: string;
  nombre: string;
  rol: string;
}

interface InvitacionRow {
  id: string;
  email: string;
  rol: string;
  estado: string;
  expires_at: string;
}

export default function MiembrosPanel({ miembros, invitaciones }: { miembros: MiembroRow[]; invitaciones: InvitacionRow[] }) {
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  const [lastInviteUrl, setLastInviteUrl] = useState<string | null>(null);

  function submit(formData: FormData) {
    setLastInviteUrl(null);
    startTransition(async () => {
      const result = await crearInvitacionEmpresa(formData);
      if (result?.error) {
        toast(result.error, "error");
        return;
      }
      if (result?.invitePath) {
        const url = `${window.location.origin}${result.invitePath}`;
        setLastInviteUrl(url);
        const copied = await navigator.clipboard?.writeText(url).then(() => true).catch(() => false);
        toast(copied ? "Invitación creada. Link copiado." : "Invitación creada. Copia el link manualmente.", "success");
      }
    });
  }

  async function copyLastInvite() {
    if (!lastInviteUrl) return;
    const copied = await navigator.clipboard?.writeText(lastInviteUrl).then(() => true).catch(() => false);
    toast(copied ? "Link copiado." : "No se pudo copiar. Selecciona el link manualmente.", copied ? "success" : "error");
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl bg-white dark:bg-white/5 border border-black/5 dark:border-white/10 p-4">
        <h2 className="text-sm font-semibold mb-3">Miembros</h2>
        <div className="space-y-2">
          {miembros.map((miembro) => (
            <div key={miembro.id} className="flex items-center justify-between gap-3 text-sm">
              <div className="min-w-0">
                <div className="truncate text-[var(--foreground)]">{miembro.nombre || miembro.email}</div>
                <div className="truncate text-xs text-[#888] dark:text-white/50">{miembro.email}</div>
              </div>
              <span className="rounded-full bg-black/5 dark:bg-white/10 px-2 py-1 text-xs text-[#666] dark:text-white/60">{miembro.rol}</span>
            </div>
          ))}
        </div>
      </div>

      <form action={submit} className="rounded-xl bg-white dark:bg-white/5 border border-black/5 dark:border-white/10 p-4 space-y-3">
        <div>
          <h2 className="text-sm font-semibold">Invitar usuario</h2>
          <p className="text-xs text-[#888] dark:text-white/50 mt-1">Primera fase multiusuario: una empresa, varios usuarios.</p>
        </div>
        <input
          name="email"
          type="email"
          required
          placeholder="correo@empresa.cl"
          className="w-full rounded-xl bg-black/5 dark:bg-white/5 border border-black/10 dark:border-white/10 px-3 py-2 text-sm"
        />
        <select name="rol" defaultValue="contador" className="w-full rounded-xl bg-black/5 dark:bg-white/5 border border-black/10 dark:border-white/10 px-3 py-2 text-sm">
          <option value="admin">Admin</option>
          <option value="contador">Contador</option>
          <option value="viewer">Viewer</option>
        </select>
        <button type="submit" disabled={pending} className="w-full rounded-xl bg-[#E8553E] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
          {pending ? "Creando..." : "Crear invitacion"}
        </button>
        {lastInviteUrl && (
          <div className="rounded-lg bg-black/5 dark:bg-white/5 p-2 space-y-2">
            <label className="block text-[11px] font-medium text-[#666] dark:text-white/50">Link de invitación</label>
            <input
              readOnly
              value={lastInviteUrl}
              onFocus={(event) => event.currentTarget.select()}
              className="w-full rounded-lg bg-white/70 dark:bg-black/20 border border-black/10 dark:border-white/10 px-2 py-2 text-xs text-[#555] dark:text-white/70"
            />
            <button type="button" onClick={copyLastInvite} className="w-full rounded-lg bg-black/5 dark:bg-white/10 px-3 py-2 text-xs font-medium text-[#555] dark:text-white/70">
              Copiar link
            </button>
          </div>
        )}
      </form>

      {invitaciones.length > 0 && (
        <div className="rounded-xl bg-white dark:bg-white/5 border border-black/5 dark:border-white/10 p-4">
          <h2 className="text-sm font-semibold mb-3">Invitaciones pendientes</h2>
          <div className="space-y-2">
            {invitaciones.map((invitacion) => (
              <div key={invitacion.id} className="flex items-center justify-between gap-3 text-sm">
                <div className="min-w-0">
                  <div className="truncate">{invitacion.email}</div>
                  <div className="text-xs text-[#888] dark:text-white/50">Vence {new Date(invitacion.expires_at).toLocaleDateString("es-CL")}</div>
                </div>
                <span className="rounded-full bg-black/5 dark:bg-white/10 px-2 py-1 text-xs text-[#666] dark:text-white/60">{invitacion.rol}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
