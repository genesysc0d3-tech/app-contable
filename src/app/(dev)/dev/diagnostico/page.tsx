import { redirect } from "next/navigation";
import { getDevOperatorDiagnostics } from "@/lib/dev/support-mode";

const C = {
  bg: "#0f1014",
  surface: "#16181d",
  border: "rgba(255,255,255,.08)",
  text: "#e8eaf0",
  text2: "#9aa0ad",
  text3: "#636878",
  accent: "#E8553E",
  green: "#22c55e",
  amber: "#f59e0b",
  muted: "rgba(255,255,255,.05)",
} as const;

function Row({ label, value, ok }: { label: string; value: string; ok?: boolean | null }) {
  const color = ok === true ? C.green : ok === false ? C.accent : C.text2;
  return (
    <div
      style={{
        borderTop: `1px solid ${C.border}`,
        padding: "10px 0",
        display: "grid",
        gridTemplateColumns: "210px minmax(0, 1fr)",
        gap: 12,
        alignItems: "baseline",
      }}
    >
      <div style={{ fontSize: 11, color: C.text3, textTransform: "uppercase", letterSpacing: ".07em", fontWeight: 800 }}>
        {label}
      </div>
      <div style={{ fontSize: 13, color, fontWeight: 700, overflowWrap: "anywhere" }}>{value}</div>
    </div>
  );
}

function boolText(value: boolean | null) {
  if (value === null) return "sin dato";
  return value ? "true" : "false";
}

export default async function DevDiagnosticoPage() {
  const data = await getDevOperatorDiagnostics();
  if (!data.authenticated) redirect("/auth/login?next=/dev/diagnostico");

  return (
    <main
      style={{
        minHeight: "100dvh",
        background: C.bg,
        color: C.text,
        fontFamily: "'DM Sans','Inter',sans-serif",
        padding: 18,
      }}
    >
      <div style={{ maxWidth: 820, margin: "0 auto", display: "flex", flexDirection: "column", gap: 14 }}>
        <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
          <div>
            <div style={{ fontSize: 11, color: C.text3, textTransform: "uppercase", letterSpacing: ".08em", fontWeight: 800 }}>
              Panel operador
            </div>
            <h1 style={{ margin: "3px 0 0", fontSize: 22 }}>Diagnóstico de acceso dev</h1>
          </div>
          <a
            href="/dev/cuentas"
            style={{
              border: `1px solid ${C.border}`,
              background: C.muted,
              color: C.text2,
              borderRadius: 8,
              padding: "8px 12px",
              fontSize: 11,
              fontWeight: 800,
              textDecoration: "none",
            }}
          >
            Reintentar cuentas
          </a>
        </header>

        <section
          style={{
            background: C.surface,
            border: `1px solid ${C.border}`,
            borderRadius: 14,
            padding: 16,
          }}
        >
          <div
            style={{
              color: data.ok ? C.green : C.amber,
              fontSize: 13,
              fontWeight: 900,
              marginBottom: 8,
            }}
          >
            {data.ok ? "Acceso dev OK" : "El servidor no esta aceptando esta sesion como operador dev"}
          </div>
          <p style={{ margin: "0 0 10px", fontSize: 12, color: C.text2, lineHeight: 1.5 }}>
            Esta pantalla solo muestra el estado de tu propia sesion. No muestra datos de clientes ni claves.
          </p>

          <Row label="Auth email" value={data.authEmail ?? "sin email de auth"} ok={data.authEmail?.toLowerCase() === data.expectedEmail} />
          <Row label="Email esperado" value={data.expectedEmail} ok />
          <Row label="Auth user id" value={data.authUserId ?? "sin user id"} />
          <Row label="Backend service" value={data.backendConfigured ? "configurado" : "faltante"} ok={data.backendConfigured} />
          <Row label="Fila usuarios" value={data.usuarioEncontrado ? "encontrada" : "no encontrada para este auth user id"} ok={data.usuarioEncontrado} />
          <Row label="Usuario email" value={data.usuarioEmail ?? "sin fila/email"} ok={data.emailOk} />
          <Row label="Usuario nombre" value={data.usuarioNombre ?? "sin nombre"} />
          <Row label="dev_mode" value={`${boolText(data.usuarioDevMode)} · informativo para Genesys`} />
          <Row label="vetado" value={boolText(data.usuarioVetado)} ok={data.vetadoOk} />
          <Row label="Email calza" value={boolText(data.emailOk)} ok={data.emailOk} />
          <Row label="Resultado" value={data.ok ? "puede entrar a /dev/cuentas" : data.error ?? "bloqueado"} ok={data.ok} />
          {data.detalle && <Row label="Detalle" value={data.detalle} ok={false} />}
        </section>
      </div>
    </main>
  );
}

export const dynamic = "force-dynamic";
