import Link from "next/link";
import { redirect } from "next/navigation";
import { getDevOperatorContext, getDevOperatorDiagnostics } from "@/lib/dev/support-mode";
import { collectOpsSnapshot, type OpsSnapshot } from "@/lib/ops/diagnostics";

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

function statusLabel(status: OpsSnapshot["status"]) {
  if (status === "critical") return "crítico";
  if (status === "degraded") return "degradado";
  return "OK";
}

function severityColor(severity: string) {
  if (severity === "critical" || severity === "error") return C.accent;
  if (severity === "warn") return C.amber;
  return C.green;
}

function Metric({ label, value, tone }: { label: string; value: number; tone?: "ok" | "warn" | "critical" }) {
  const color = tone === "critical" ? C.accent : tone === "warn" ? C.amber : C.green;
  return (
    <div style={{ border: `1px solid ${C.border}`, borderRadius: 10, padding: 12, background: C.muted }}>
      <div style={{ fontSize: 11, color: C.text3, textTransform: "uppercase", letterSpacing: ".06em", fontWeight: 900 }}>
        {label}
      </div>
      <div style={{ marginTop: 7, fontSize: 24, lineHeight: 1, color, fontWeight: 950 }}>{value}</div>
    </div>
  );
}

function OpsHealth({ snapshot }: { snapshot: OpsSnapshot | null }) {
  if (!snapshot) {
    return (
      <section style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 14, padding: 16 }}>
        <div style={{ color: C.amber, fontSize: 13, fontWeight: 900 }}>Salud operacional no disponible</div>
        <p style={{ margin: "8px 0 0", color: C.text2, fontSize: 12 }}>
          Entra como operador dev valido para leer el snapshot productivo.
        </p>
      </section>
    );
  }

  const statusColor = snapshot.status === "critical" ? C.accent : snapshot.status === "degraded" ? C.amber : C.green;
  return (
    <section style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 14, padding: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "baseline" }}>
        <div>
          <div style={{ color: statusColor, fontSize: 13, fontWeight: 900 }}>
            Salud operacional {statusLabel(snapshot.status)}
          </div>
          <p style={{ margin: "5px 0 0", color: C.text2, fontSize: 12 }}>
            Snapshot seguro: sin payloads, claves, XML, PDFs ni prompts.
          </p>
        </div>
        <div style={{ color: C.text3, fontSize: 11, fontWeight: 800 }}>
          {new Date(snapshot.checkedAt).toLocaleString("es-CL", { timeZone: "America/Santiago" })}
        </div>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(145px, 1fr))",
          gap: 10,
          marginTop: 14,
        }}
      >
        <Metric label="Docs atascados" value={snapshot.metrics.documentosAtascados} tone={snapshot.metrics.documentosAtascados > 0 ? "critical" : "ok"} />
        <Metric label="Locks expirados" value={snapshot.metrics.locksExpirados} tone={snapshot.metrics.locksExpirados > 0 ? "warn" : "ok"} />
        <Metric label="Emisión fallida 24h" value={snapshot.metrics.jobsEmisionFallidos24h} tone={snapshot.metrics.jobsEmisionFallidos24h > 0 ? "warn" : "ok"} />
        <Metric label="Errores ops 24h" value={snapshot.metrics.opsErrores24h} tone={snapshot.metrics.opsCriticos24h > 0 ? "critical" : snapshot.metrics.opsErrores24h > 0 ? "warn" : "ok"} />
        <Metric label="Cola docs lista" value={snapshot.metrics.documentJobsQueued} tone={snapshot.metrics.documentJobsQueued > 10 ? "warn" : "ok"} />
        <Metric label="Cola docs corriendo" value={snapshot.metrics.documentJobsRunning} tone="ok" />
        <Metric label="Cola docs fallida 24h" value={snapshot.metrics.documentJobsFailed24h} tone={snapshot.metrics.documentJobsFailed24h > 0 ? "warn" : "ok"} />
        <Metric label="Cola docs atascada" value={snapshot.metrics.documentJobsStale} tone={snapshot.metrics.documentJobsStale > 0 ? "critical" : "ok"} />
      </div>

      {snapshot.findings.length > 0 ? (
        <div style={{ marginTop: 14, borderTop: `1px solid ${C.border}`, paddingTop: 10 }}>
          <div style={{ fontSize: 11, color: C.text3, textTransform: "uppercase", letterSpacing: ".07em", fontWeight: 900 }}>
            Hallazgos activos
          </div>
          <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 8 }}>
            {snapshot.findings.map((finding) => (
              <div key={finding.eventName} style={{ display: "grid", gridTemplateColumns: "82px minmax(0, 1fr)", gap: 10 }}>
                <span style={{ color: severityColor(finding.severity), fontSize: 11, fontWeight: 950, textTransform: "uppercase" }}>
                  {finding.severity}
                </span>
                <span style={{ color: C.text2, fontSize: 12, lineHeight: 1.45 }}>{finding.summary}</span>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <div style={{ marginTop: 14, borderTop: `1px solid ${C.border}`, paddingTop: 10 }}>
        <div style={{ fontSize: 11, color: C.text3, textTransform: "uppercase", letterSpacing: ".07em", fontWeight: 900 }}>
          Últimos eventos ops
        </div>
        {snapshot.latestEvents.length === 0 ? (
          <p style={{ margin: "8px 0 0", color: C.text2, fontSize: 12 }}>Sin eventos operacionales recientes.</p>
        ) : (
          <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 9 }}>
            {snapshot.latestEvents.map((event) => (
              <div key={event.id} style={{ borderTop: `1px solid ${C.border}`, paddingTop: 9 }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "baseline" }}>
                  <span style={{ color: severityColor(event.severity), fontSize: 11, fontWeight: 950, textTransform: "uppercase" }}>
                    {event.severity} · {event.source}
                  </span>
                  <span style={{ color: C.text3, fontSize: 11 }}>
                    {new Date(event.created_at).toLocaleString("es-CL", { timeZone: "America/Santiago" })}
                  </span>
                </div>
                <div style={{ marginTop: 4, color: C.text, fontSize: 12, fontWeight: 850 }}>{event.event_name}</div>
                <div style={{ marginTop: 2, color: C.text2, fontSize: 12, lineHeight: 1.45 }}>{event.summary}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

export default async function DevDiagnosticoPage() {
  const data = await getDevOperatorDiagnostics();
  if (!data.authenticated) redirect("/auth/login?next=/dev/diagnostico");
  const operator = data.ok ? await getDevOperatorContext() : null;
  const opsSnapshot = operator?.ok ? await collectOpsSnapshot(operator.sb).catch(() => null) : null;

  return (
    <main
      style={{
        minHeight: "100dvh",
        background: C.bg,
        color: C.text,
        fontFamily: "var(--font-geist-sans), sans-serif",
        padding: 18,
      }}
    >
      <div style={{ maxWidth: 920, margin: "0 auto", display: "flex", flexDirection: "column", gap: 14 }}>
        <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
          <div>
            <div style={{ fontSize: 11, color: C.text3, textTransform: "uppercase", letterSpacing: ".08em", fontWeight: 800 }}>
              Panel operador
            </div>
            <h1 style={{ margin: "3px 0 0", fontSize: 22 }}>Diagnóstico de acceso dev</h1>
          </div>
          <Link
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
          </Link>
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

        <OpsHealth snapshot={opsSnapshot} />
      </div>
    </main>
  );
}

export const dynamic = "force-dynamic";
