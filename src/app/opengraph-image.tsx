import { ImageResponse } from "next/og";

// Tarjeta de compartir de la APP (WhatsApp/redes) — mismo lenguaje visual que el
// landing (massdte.cl) para que el link de la app también se vea con marca.
export const alt = "MassDTE — Tu escritorio de boletas electrónicas del SII";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          padding: "0 96px",
          background:
            "radial-gradient(900px 500px at 18% 0%, rgba(232,85,62,0.28), transparent 60%), #050505",
          color: "#ffffff",
          fontFamily: "system-ui, sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 14, fontSize: 34, fontWeight: 700, letterSpacing: 4 }}>
          MASSDTE
          <div style={{ width: 10, height: 10, borderRadius: 999, background: "#e8553e" }} />
        </div>
        <div style={{ marginTop: 38, fontSize: 76, fontWeight: 700, lineHeight: 1.06, letterSpacing: -2, maxWidth: 980 }}>
          Tu escritorio de boletas del SII
        </div>
        <div style={{ marginTop: 28, fontSize: 30, color: "rgba(255,255,255,0.62)", maxWidth: 900 }}>
          Sube tu cartola, revisa y emite el lote completo — con tu clave del SII, desde tu computador.
        </div>
        <div style={{ marginTop: 44, display: "flex", alignItems: "center", gap: 10, fontSize: 24, color: "#e8553e", fontWeight: 600 }}>
          app.massdte.cl
          <span style={{ color: "rgba(255,255,255,0.35)" }}>· Hecho en Chile</span>
        </div>
      </div>
    ),
    { ...size },
  );
}
