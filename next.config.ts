import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // pdf-parse/pdfjs-dist cargan su worker (pdf.worker.mjs) por ruta relativa al
  // módulo. Si Next los empaqueta, el worker no existe en el bundle y TODO PDF
  // falla con "Setting up fake worker failed: Cannot find module …/pdf.worker.mjs".
  // Se cargan como externos del servidor (require nativo desde node_modules).
  serverExternalPackages: ["pdf-parse", "pdfjs-dist"],
  experimental: {
    optimizePackageImports: [
      "@phosphor-icons/react",
    ],
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains; preload",
          },
          {
            key: "X-Content-Type-Options",
            value: "nosniff",
          },
          {
            key: "Referrer-Policy",
            value: "strict-origin-when-cross-origin",
          },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=(), payment=()",
          },
          {
            key: "X-Frame-Options",
            value: "DENY",
          },
          {
            key: "Content-Security-Policy",
            value: "frame-ancestors 'self'; object-src 'none'; base-uri 'self'",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
