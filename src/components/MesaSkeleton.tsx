// Silueta de la mesa de trabajo, compartida entre:
//  - loading.tsx de /massdte (streaming del App Router: navegación + F5)
//  - /shell (fallback OFFLINE precacheado por el Service Worker — sin datos
//    de NADIE: por eso este componente es 100% estático)
// Tema: vars globales (--background/--foreground, puestas por ThemeInitializer
// antes del primer paint) + grises translúcidos neutros para ambos temas.
// Grilla: calza con la real (.app en page.tsx: 2.3fr/7.7fr, max 1400, gap 20)
// para que el morph silueta→mesa no salte.
export default function MesaSkeleton() {
  return (
    <div style={{ minHeight: "100vh", background: "var(--background)", color: "var(--foreground)", padding: "14px 16px", fontFamily: "var(--font-geist-sans), sans-serif" }}>
      <style>{`@keyframes mesaSk{0%,100%{opacity:.5}50%{opacity:.85}} .mesa-sk{background:rgba(127,127,127,.10);border:1px solid rgba(127,127,127,.13);border-radius:14px;animation:mesaSk 1.15s ease-in-out infinite}`}</style>

      {/* Tira de calendario (header) */}
      <div style={{ display: "flex", justifyContent: "center", marginBottom: 16 }}>
        <div className="mesa-sk" style={{ height: 38, width: "min(560px, 92%)", borderRadius: 12 }} />
      </div>

      {/* Grid: columna izquierda + mesa (misma proporción que .app real) */}
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0,2.3fr) minmax(0,7.7fr)", gap: 20, maxWidth: 1400, margin: "0 auto" }}>
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
