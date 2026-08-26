// Service Worker de MassDTE, servido como Route Handler ("shader cache" de la
// app, idea del fundador: si la versión calza, los estáticos salen del disco;
// si no, se baja la versión nueva y el cache viejo se purga solo).
//
// REGLAS DE ORO (auditoría adversarial 2026-08-26 — NO relajar sin re-auditar):
//  - El SW SOLO interviene GET same-origin de /_next/static/* (inmutables por
//    hash) y navegaciones (red primero, /shell SOLO si la red FALLA).
//  - JAMÁS toca: /api/* (incluye sii-local — el puente de la extensión fetchea
//    ahí y un SW torpe se comería el folio real del SII —, pagos Flow/MP,
//    emisión, archivo/R2), POST/server actions, RSC (?_rsc / header RSC /
//    prefetch), cross-origin (Supabase, realtime), /auth/*.
//  - JAMÁS cachea HTML con datos (fuga contable en computador compartido):
//    el único documento precacheado es /shell, estático y sin datos de nadie.
//  - Kill-switch: /api/sw-config {enabled:false} => unregister + purga caches.
//    Capa 0: /sw.js se sirve con Cache-Control no-store (next.config).

const VERSION = process.env.NEXT_PUBLIC_APP_VERSION ?? "dev";

const WORKER_SOURCE = `
const VERSION = ${JSON.stringify(VERSION)};
const CACHE = "massdte-" + VERSION;
const SHELL = "/shell";

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    try {
      const res = await fetch(SHELL, { cache: "no-store" });
      // res.redirected: si un middleware redirigiera /shell (p. ej. a login),
      // cachearlo guardaría OTRA página como shell. Solo el 200 directo vale.
      if (res.ok && !res.redirected) await cache.put(SHELL, res);
    } catch { /* offline durante install: el shell se precachea en el próximo activate-check */ }
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k.startsWith("massdte-") && k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
    checkKillSwitch();
  })());
});

let lastConfigCheck = 0;
async function checkKillSwitch() {
  lastConfigCheck = Date.now();
  try {
    const res = await fetch("/api/sw-config", { cache: "no-store" });
    const cfg = await res.json();
    if (cfg && cfg.enabled === false) {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k.startsWith("massdte-")).map((k) => caches.delete(k)));
      await self.registration.unregister();
    }
  } catch { /* red caída: se reintenta en la próxima navegación */ }
}

async function cacheFirst(request) {
  const cached = await caches.match(request, { cacheName: CACHE });
  if (cached) return cached;
  const res = await fetch(request);
  if (res.ok) {
    const cache = await caches.open(CACHE);
    cache.put(request, res.clone());
  }
  return res;
}

async function networkWithShellFallback(request) {
  try {
    // Red SIEMPRE primero: datos contables jamás salen de un cache del SW.
    return await fetch(request);
  } catch {
    const shell = await caches.match(SHELL, { cacheName: CACHE });
    if (shell) return shell;
    throw new Error("offline sin shell");
  }
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;                       // server actions, POSTs
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;        // Supabase, R2, fonts
  if (url.pathname.startsWith("/api/")) return;           // emisión, pagos, sii-local, archivo
  if (url.pathname === "/sw.js") return;                  // el propio worker, siempre de red
  if (url.searchParams.has("_rsc")) return;               // RSC: territorio del Router Cache
  if (req.headers.get("RSC") || req.headers.get("Next-Router-Prefetch")) return;

  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(cacheFirst(req));                   // inmutables por hash de build
    return;
  }

  if (req.mode === "navigate") {
    // chequeo del kill-switch a lo más cada 6 horas, sin bloquear la navegación
    if (Date.now() - lastConfigCheck > 6 * 3600 * 1000) {
      event.waitUntil(checkKillSwitch());
    }
    event.respondWith(networkWithShellFallback(req));
    return;
  }
  // Todo lo demás: el navegador va directo a la red (sin respondWith).
});
`;

export function GET() {
  return new Response(WORKER_SOURCE, {
    headers: {
      "Content-Type": "application/javascript; charset=utf-8",
      "Cache-Control": "no-cache, no-store, must-revalidate",
      // El scope raíz lo da la URL /sw.js (mismo nivel), no hace falta header
      // Service-Worker-Allowed.
    },
  });
}
