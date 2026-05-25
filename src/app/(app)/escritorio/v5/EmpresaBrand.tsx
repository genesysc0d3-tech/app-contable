"use client";

import { useState } from "react";

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

function LogoImage({ src, alt, maxHeight, onError }: { src: string; alt: string; maxHeight: number; onError: () => void }) {
  return (
    <span style={{ position: "relative", display: "inline-flex", alignItems: "center", height: maxHeight, maxWidth: "100%", overflow: "visible" }}>
      <img
        src={src}
        alt={alt}
        onError={onError}
        style={{ maxHeight, maxWidth: "100%", width: "auto", height: "auto", objectFit: "contain", display: "block" }}
      />
      <img
        src={src}
        alt=""
        aria-hidden="true"
        style={{ position: "absolute", inset: 0, maxHeight, maxWidth: "100%", width: "auto", height: "auto", objectFit: "contain", display: "block", filter: "brightness(0) invert(1)", mixBlendMode: "lighten", pointerEvents: "none" }}
      />
    </span>
  );
}
