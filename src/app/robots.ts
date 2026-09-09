import type { MetadataRoute } from "next";

/**
 * La app NO es superficie de SEO: la marca vive en massdte.cl. Hoy Google
 * tenía indexado app.massdte.cl/auth/registro y /robots.txt rebotaba al
 * login (el guard de sesión lo tapaba), así que ni siquiera podía leer esto.
 * Se excluye /robots.txt del guard en proxy.ts y se cierra todo.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", disallow: "/" }],
  };
}
