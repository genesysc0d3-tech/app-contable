// Skeleton instantáneo de la mesa de trabajo: aparece al toque en cada
// navegación del calendario (día/semana/mes, ‹ ›, elegir día) mientras el
// server resuelve los datos. Mata la sensación de "congelado" y habilita el
// prefetch de la ruta (Next precarga este shell, sin tocar la DB).
export default function MesaLoading() {
  return (
    <div style={{ minHeight: "100vh", background: "#0f1014", color: "#e8eaf0", padding: "14px 16px", fontFamily: "'DM Sans','Inter',sans-serif" }}>
      <style>{`@keyframes mesaSk{0%,100%{opacity:.5}50%{opacity:.85}} .mesa-sk{background:#16181d;border:1px solid rgba(255,255,255,.06);border-radius:14px;animation:mesaSk 1.15s ease-in-out infinite}`}</style>

      {/* Tira de calendario (header) */}
      <div style={{ display: "flex", justifyContent: "center", marginBottom: 16 }}>
        <div className="mesa-sk" style={{ height: 38, width: "min(560px, 92%)", borderRadius: 12 }} />
      </div>

      {/* Grid: columna izquierda + mesa */}
      <div style={{ display: "grid", gridTemplateColumns: "300px 1fr", gap: 14, maxWidth: 1280, margin: "0 auto" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div className="mesa-sk" style={{ height: 64, borderRadius: 16 }} />
          <div className="mesa-sk" style={{ height: 64, borderRadius: 16 }} />
          <div className="mesa-sk" style={{ height: 62, borderRadius: 14 }} />
          <div className="mesa-sk" style={{ height: 210, borderRadius: 16 }} />
        </div>
        <div className="mesa-sk" style={{ height: "calc(100vh - 96px)", borderRadius: 18, animationDelay: ".15s" }} />
      </div>
    </div>
  );
}
