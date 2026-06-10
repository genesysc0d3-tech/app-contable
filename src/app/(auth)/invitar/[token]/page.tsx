import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import InvitacionAcceptForm from "./InvitacionAcceptForm";

export default async function InvitacionPage({ params }: { params: Promise<{ token: string }> | { token: string } }) {
  const { token } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const invitePath = `/invitar/${token}`;
  const authNext = encodeURIComponent(invitePath);

  return (
    <main className="mesh-bg min-h-screen flex items-center justify-center px-4 py-12">
      <section className="w-full max-w-sm rounded-2xl bg-white/5 border border-white/10 p-6 text-center space-y-4">
        <div>
          <h1 className="text-2xl font-bold">Invitación a empresa</h1>
          <p className="text-sm text-white/50 mt-2">Acepta la invitación con el mismo email al que fue enviada.</p>
        </div>

        {!user ? (
          <div className="space-y-3">
            <p className="text-sm text-white/60">Primero inicia sesión o crea tu cuenta. Te traeremos de vuelta a esta invitación.</p>
            <Link href={`/auth/login?next=${authNext}`} className="block rounded-xl bg-[#E8553E] px-4 py-3 text-sm font-semibold text-white">Iniciar sesión</Link>
            <Link href={`/auth/registro?next=${authNext}`} className="block rounded-xl bg-white/10 px-4 py-3 text-sm font-semibold text-white/90">Crear cuenta</Link>
          </div>
        ) : (
          <InvitacionAcceptForm token={token} email={user.email} />
        )}
      </section>
    </main>
  );
}
