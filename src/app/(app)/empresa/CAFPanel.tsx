export interface CAFRow {
  id: string;
  tipo_dte: number;
  folio_desde: number;
  folio_hasta: number;
  folio_actual: number;
  estado: string;
  fecha_vence: string;
}

export default function CAFPanel({ cafs, proveedor = "mock" }: { cafs: CAFRow[]; proveedor?: "mock" | "sii_local" | "simpleapi" }) {
  const isSiiLocal = proveedor === "sii_local";
  const isSimpleApi = proveedor === "simpleapi";
  const activos = cafs.filter(c => c.estado === "activo");
  const totalDisponibles = activos.reduce((s, c) => s + Math.max(0, c.folio_hasta - c.folio_actual + 1), 0);
  const totalEmitidos = cafs.reduce((s, c) => s + Math.max(0, c.folio_actual - c.folio_desde), 0);
  const uso = totalDisponibles + totalEmitidos > 0
    ? Math.round((totalEmitidos / (totalDisponibles + totalEmitidos)) * 100)
    : 0;

  return (
    <div style={{
      borderRadius: 22,
      border: "1px solid rgba(255,255,255,0.08)",
      background: "rgba(255,255,255,0.025)",
      boxShadow: "inset 0 1px 0 rgba(255,255,255,0.035)",
    }}>
      <div style={{ maxWidth: 1180, margin: "0 auto", padding: "28px 36px" }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 20, marginBottom: 24 }}>
          <div style={{
            width: 48, height: 48, flexShrink: 0,
            display: "flex", alignItems: "center", justifyContent: "center",
            borderRadius: 16,
            border: "1px solid rgba(245,158,11,0.25)",
            background: "rgba(245,158,11,0.12)",
            color: "#FBBF24",
          }}>
            <svg viewBox="0 0 24 24" fill="none" width={20} height={20}>
              <path d="M4 7h16v12H4V7Z" stroke="currentColor" strokeWidth="1.8"/>
              <path d="M4 7l3-3h10l3 3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
            </svg>
          </div>
          <div style={{ minWidth: 0, paddingTop: 4, flex: 1 }}>
            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10 }}>
              <h3 style={{ fontSize: 20, fontWeight: 700, lineHeight: 1.2, letterSpacing: "-0.04em", color: "#ffffff" }}>
                Folios CAF
              </h3>
              <span style={{
                display: "inline-block", borderRadius: 9999,
                border: "1px solid rgba(245,158,11,0.20)",
                background: "rgba(245,158,11,0.13)",
                padding: "4px 10px", fontSize: 11, fontWeight: 700,
                color: "#FBBF24",
              }}>
                {isSiiLocal ? "Automático por SII" : isSimpleApi ? "Bóveda local" : `${activos.length} activos`}
              </span>
            </div>
            <p style={{ marginTop: 6, fontSize: 13, lineHeight: 1.4, color: "rgba(255,255,255,0.45)" }}>
              {isSiiLocal
                ? "En SII local, e-Boleta/MiPyme asigna el folio real al finalizar la emisión."
                : isSimpleApi
                  ? "SimpleAPI usará CAF y certificado cifrados en este equipo cuando el proxy esté listo."
                  : "Folios de prueba para simular emisión sin informar al SII."}
            </p>
          </div>
        </div>

        {isSiiLocal ? (
          <div style={{
            display: "flex", alignItems: "flex-start", gap: 12,
            borderRadius: 14,
            border: "1px solid rgba(34,197,94,0.18)",
            background: "rgba(34,197,94,0.08)",
            padding: "16px 18px",
          }}>
            <div style={{ width: 24, height: 24, borderRadius: 8, display: "grid", placeItems: "center", background: "rgba(34,197,94,0.14)", color: "#22c55e", flexShrink: 0 }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                <path d="M20 6 9 17l-5-5" />
              </svg>
            </div>
            <div>
              <div style={{ fontSize: 13, fontWeight: 800, color: "#eaf0f8" }}>
                No tienes que solicitar CAF aquí.
              </div>
              <div style={{ marginTop: 4, fontSize: 12, lineHeight: 1.5, color: "rgba(255,255,255,0.56)" }}>
                Cuando emites desde el portal SII, el SII entrega el número de folio y el PDF oficial. App Contable sólo guarda ese folio y respaldo al terminar.
              </div>
            </div>
          </div>
        ) : isSimpleApi ? (
          <div style={{
            display: "flex", alignItems: "flex-start", gap: 12,
            borderRadius: 14,
            border: "1px solid rgba(96,165,250,0.20)",
            background: "rgba(96,165,250,0.08)",
            padding: "16px 18px",
          }}>
            <div style={{ width: 24, height: 24, borderRadius: 8, display: "grid", placeItems: "center", background: "rgba(96,165,250,0.14)", color: "#60a5fa", flexShrink: 0 }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 3v18" /><path d="M5 8h14" /><path d="M5 16h14" />
              </svg>
            </div>
            <div>
              <div style={{ fontSize: 13, fontWeight: 800, color: "#eaf0f8" }}>
                CAF gestionado desde la extensión.
              </div>
              <div style={{ marginTop: 4, fontSize: 12, lineHeight: 1.5, color: "rgba(255,255,255,0.56)" }}>
                Tus certificados y CAF quedan cifrados en este equipo. Durante una emisión SimpleAPI se transmiten temporalmente a App Contable para firmar y enviar el DTE. No los almacenamos en nuestros servidores.
              </div>
            </div>
          </div>
        ) : (
          <>
        <div style={{
          display: "flex", alignItems: "flex-start", gap: 12,
          borderRadius: 14,
          border: "1px solid rgba(255,255,255,0.08)",
          background: "rgba(255,255,255,0.03)",
          padding: "14px 16px",
          marginBottom: 18,
        }}>
          <div style={{ width: 20, height: 20, borderRadius: 6, display: "grid", placeItems: "center", background: "rgba(96,165,250,0.12)", color: "#60a5fa", flexShrink: 0, fontSize: 11, fontWeight: 700 }}>
            i
          </div>
          <div style={{ fontSize: 12, lineHeight: 1.5, color: "rgba(255,255,255,0.50)" }}>
            Estos folios son simulados para el modo de prueba. Sirven para validar el flujo sin emitir documentos reales.
          </div>
        </div>

        <div style={{
          display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 0,
          borderRadius: 14, overflow: "hidden",
          border: "1px solid rgba(255,255,255,0.08)",
          background: "rgba(255,255,255,0.03)",
        }}>
          {[
            { value: activos.length, label: "Folios activos" },
            { value: totalDisponibles.toLocaleString(), label: "Folios disponibles" },
            { value: totalEmitidos, label: "DTE emitidos" },
            { value: `${uso}%`, label: "Uso promedio" },
          ].map((s, i) => (
            <div key={i} style={{
              padding: "16px 14px", textAlign: "center",
              borderRight: i < 3 ? "1px solid rgba(255,255,255,0.08)" : "none",
            }}>
              <div style={{ color: "#f59e0b", fontWeight: 850, fontSize: 18, marginBottom: 4 }}>
                {s.value}
              </div>
              <div style={{ color: "rgba(255,255,255,0.45)", fontSize: 11 }}>
                {s.label}
              </div>
            </div>
          ))}
        </div>
          </>
        )}
      </div>
    </div>
  );
}
