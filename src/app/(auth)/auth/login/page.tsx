"use client";

import { Suspense } from "react";
import AuthCard from "../AuthCard";

// La escena de fondo vive en el layout de /auth (persiste entre rutas); esta
// página solo posiciona la tarjeta. Alternar a "Crear cuenta" NO navega: la
// AuthCard cambia de modo en el lugar (y ajusta la URL con replaceState).
export default function LoginPage() {
  return (
    <div className="relative z-10 min-h-svh flex items-center justify-center lg:justify-end px-4 py-4 lg:pr-[7vw]">
      <Suspense fallback={<AuthFallback />}>
        <AuthCard inicial="login" />
      </Suspense>
    </div>
  );
}

// Evita el flash mientras carga (useSearchParams exige Suspense).
function AuthFallback() {
  return <div className="h-8 w-8 rounded-full border-2 border-white/15 border-t-[#e8553e] animate-spin" />;
}
