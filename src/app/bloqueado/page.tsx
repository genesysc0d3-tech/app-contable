import { signOut } from "@/app/(auth)/auth/actions";

export default function BloqueadoPage() {
  return (
    <div className="flex-1 flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm space-y-6 text-center">
        <div className="text-5xl">🚫</div>
        <div>
          <h1 className="text-2xl font-bold">Cuenta suspendida</h1>
          <p className="text-white/50 mt-2 text-sm">
            Tu cuenta ha sido suspendida por un administrador. Si crees que esto
            es un error, contacta a soporte.
          </p>
        </div>

        <div className="rounded-2xl bg-white/5 backdrop-blur-sm border border-white/10 p-5">
          <p className="text-sm text-white/70">
            Escribe a{" "}
            <span className="text-blue-400">soporte@appcontable.cl</span> para
            resolver tu situacion.
          </p>
        </div>

        <form action={signOut}>
          <button
            type="submit"
            className="text-sm text-white/40 hover:text-white/70 transition-colors"
          >
            Cerrar sesion
          </button>
        </form>
      </div>
    </div>
  );
}
