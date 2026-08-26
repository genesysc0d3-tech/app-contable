// /shell — cascarón OFFLINE de la app, precacheado por el Service Worker.
// Es la MISMA silueta del loading de /massdte, 100% estática y sin datos de
// ningún usuario (regla dura: el SW jamás cachea HTML con datos contables —
// en un computador compartido sería una fuga). Cuando una navegación falla
// por red, el SW responde esto y el script de abajo reintenta la URL real
// apenas vuelve la conexión.
// Vive FUERA del grupo (app) a propósito: no pasa por getAppEmpresaContext.
import MesaSkeleton from "@/components/MesaSkeleton";

export const dynamic = "force-static";

export default function ShellPage() {
  return (
    <>
      <MesaSkeleton />
      {/* Aviso discreto solo visible en esta página (que solo aparece offline) */}
      <div style={{ position: "fixed", left: "50%", bottom: 26, transform: "translateX(-50%)", padding: "8px 14px", borderRadius: 999, background: "rgba(127,127,127,.14)", border: "1px solid rgba(127,127,127,.2)", fontSize: 11, fontWeight: 700, color: "var(--foreground)", opacity: .75 }}>
        Sin conexión — reintentando…
      </div>
      <script
        // Reintento automático: cuando vuelve la red (o cada 5s), recarga la
        // URL que el usuario pidió (el SW respondió /shell EN ESA URL, así que
        // location.reload() re-navega a la ruta real).
        dangerouslySetInnerHTML={{
          // Solo reintenta cuando el SW sirvió este shell COMO FALLBACK de otra
          // ruta (location.pathname = la URL real que el usuario pidió). En una
          // visita directa a /shell estando online, sin guardia, esto recargaría
          // en loop cada 5s.
          __html: `(function(){if(location.pathname==="/shell")return;var r=function(){if(navigator.onLine)location.reload()};window.addEventListener("online",r);setInterval(r,5000);})();`,
        }}
      />
    </>
  );
}
