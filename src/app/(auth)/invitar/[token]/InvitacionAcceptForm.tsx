"use client";

import { useActionState } from "react";
import { aceptarInvitacionEmpresa } from "@/app/(app)/empresa/actions";

export default function InvitacionAcceptForm({ token, email }: { token: string; email: string | null | undefined }) {
  const [state, formAction, pending] = useActionState(async () => aceptarInvitacionEmpresa(token), {} as { error?: string });

  return (
    <form action={formAction} className="space-y-3">
      <p className="text-sm text-white/60">Sesión activa: {email}</p>
      {state.error && (
        <div className="rounded-xl bg-red-500/10 border border-red-500/20 px-4 py-3 text-sm text-red-300">
          {state.error}
        </div>
      )}
      <button type="submit" disabled={pending} className="w-full rounded-xl bg-[#E8553E] px-4 py-3 text-sm font-semibold text-white disabled:opacity-50">
        {pending ? "Aceptando..." : "Aceptar invitación"}
      </button>
    </form>
  );
}
