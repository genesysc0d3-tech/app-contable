// Kill-switch remoto del Service Worker (capa 1). El SW y la página consultan
// este flag; {enabled:false} => el SW se des-registra y purga sus caches en la
// próxima navegación de cada cliente, SIN redeploy.
//
// Apagarlo en emergencia: `vercel env` → SW_ENABLED=false (production) + redeploy
// de env (instantáneo). Encendido por defecto solo en production real:
//  - Vercel previews (VERCEL_ENV=preview) => SIEMPRE off (un SW registrado en
//    un preview contaminaría el dominio del preview).
//  - Build local con `next start` (sin VERCEL_ENV) => on, para poder probarlo.

export function GET() {
  const env = process.env.VERCEL_ENV; // "production" | "preview" | "development" | undefined (local)
  const enabled =
    process.env.SW_ENABLED !== "false" &&
    (env === undefined || env === "production");

  return Response.json(
    { enabled, version: process.env.NEXT_PUBLIC_APP_VERSION ?? "dev" },
    { headers: { "Cache-Control": "no-cache, no-store, must-revalidate" } },
  );
}
