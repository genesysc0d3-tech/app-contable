"use client";

import { useEffect, useState } from "react";

export default function EmpresaBrand({
  nombre,
  logoUrl,
  size = 34,
  textSize = 18,
  maxWidth = 260,
}: {
  nombre: string;
  logoUrl: string;
  size?: number;
  textSize?: number;
  maxWidth?: number;
}) {
  const [logoOk, setLogoOk] = useState(Boolean(logoUrl));

  return (
    <span style={{ display: "flex", alignItems: "center", gap: logoOk ? 0 : 9, minWidth: 0, width: "fit-content", maxWidth, whiteSpace: "nowrap", flexShrink: 0, overflow: "visible" }}>
      {logoOk ? (
        <span style={{ width: maxWidth, maxWidth, height: size, display: "flex", alignItems: "center", justifyContent: "flex-start", overflow: "visible", flexShrink: 0 }}>
          <LogoImage src={logoUrl} alt={`Logo de ${nombre}`} maxHeight={size} onError={() => setLogoOk(false)} />
        </span>
      ) : (
        <span style={{ fontSize: textSize, fontWeight: 700, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", minWidth: 0 }}>{nombre}</span>
      )}
    </span>
  );
}

/**
 * La silueta blanca (brightness(0) invert(1)) existe para que un logo oscuro
 * monocromo no desaparezca sobre el dashboard oscuro. Pero aplicarla siempre
 * mata los logos con color. Acá se analiza el logo (same-origin → canvas
 * legible) y la silueta se activa SOLO si es oscuro y sin color; además solo
 * rige en tema oscuro (vía CSS .dark).
 */
function LogoImage({ src, alt, maxHeight, onError }: { src: string; alt: string; maxHeight: number; onError: () => void }) {
  const [silhouette, setSilhouette] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const img = new Image();
    img.src = src;
    img.onload = () => {
      try {
        const S = 24;
        const canvas = document.createElement("canvas");
        canvas.width = S;
        canvas.height = S;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        ctx.drawImage(img, 0, 0, S, S);
        const { data } = ctx.getImageData(0, 0, S, S);
        let n = 0, lumSum = 0, colorful = 0;
        for (let i = 0; i < data.length; i += 4) {
          if (data[i + 3] < 40) continue; // transparente: fuera
          const r = data[i], g = data[i + 1], b = data[i + 2];
          n++;
          lumSum += (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
          if ((Math.max(r, g, b) - Math.min(r, g, b)) / 255 > 0.22) colorful++;
        }
        if (!cancelled && n > 0) {
          setSilhouette(lumSum / n < 0.45 && colorful / n < 0.08);
        }
      } catch {
        /* canvas tainted u otro fallo: se queda el logo original */
      }
    };
    return () => { cancelled = true; };
  }, [src]);

  return (
    <span style={{ position: "relative", display: "inline-flex", alignItems: "center", height: maxHeight, maxWidth: "100%", overflow: "visible" }}>
      <style>{`.eb-sil{display:none}.dark .eb-sil{display:block}`}</style>
      {/* eslint-disable-next-line @next/next/no-img-element -- API same-origin con cookies (el optimizer de next/image no autentica) + tamaño natural */}
      <img
        src={src}
        alt={alt}
        onError={onError}
        style={{ maxHeight, maxWidth: "100%", width: "auto", height: "auto", objectFit: "contain", display: "block" }}
      />
      {silhouette && (
        // eslint-disable-next-line @next/next/no-img-element -- overlay silueta del mismo recurso
        <img
          src={src}
          alt=""
          aria-hidden="true"
          className="eb-sil"
          style={{ position: "absolute", inset: 0, maxHeight, maxWidth: "100%", width: "auto", height: "auto", objectFit: "contain", filter: "brightness(0) invert(1)", mixBlendMode: "lighten", pointerEvents: "none" }}
        />
      )}
    </span>
  );
}
