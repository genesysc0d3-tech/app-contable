import type { MetadataRoute } from "next";

// Manifest PWA: hace la app instalable y le da identidad al "modo app".
// Iconos generados desde brand/massdte-tile-naranjo-2000.png (tile cuadrado
// oficial de la marca, #E8553E).
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "MassDTE",
    short_name: "MassDTE",
    description: "Tu cartola entra. Tus boletas salen.",
    start_url: "/massdte",
    display: "standalone",
    background_color: "#0f1014",
    theme_color: "#E8553E",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
  };
}
