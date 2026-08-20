"use client";

import { Suspense } from "react";
import AuthCard from "../AuthCard";

// Mismo tratamiento que login (la tarjeta es la MISMA AuthCard, modo registro);
// la escena vive en el layout de /auth y persiste entre rutas.
export default function RegistroPage() {
  return (
    <div className="relative z-10 min-h-svh flex items-center justify-center lg:justify-end px-4 py-4 lg:pr-[7vw]">
      <Suspense fallback={<AuthFallback />}>
        <AuthCard inicial="registro" />
      </Suspense>
    </div>
  );
}

// Evita el flash mientras carga (useSearchParams exige Suspense).
function AuthFallback() {
  return <div className="h-8 w-8 rounded-full border-2 border-white/15 border-t-[#e8553e] animate-spin" />;
}
