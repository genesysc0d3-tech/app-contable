/**
 * Estado del sistema: las dos preguntas que se hacen cuando algo no anda —
 * "¿estoy entrando bien yo?" y "¿está bien la plataforma?"—, en ese orden.
 *
 * Se llama "Estado del sistema" y no "Diagnóstico" porque el detalle de cada
 * cuenta ya tiene sus propias señales: dos cosas distintas con el mismo nombre
 * era la mitad del mareo. La ruta sigue siendo /dev/diagnostico.
 */
import { redirect } from "next/navigation";
import { getDevOperatorContext, getDevOperatorDiagnostics } from "@/lib/dev/support-mode";
import { collectOpsSnapshot, type OpsSnapshot } from "@/lib/ops/diagnostics";
import { C, DevNav, Section } from "../ui";

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

// El motivo real del evento vive en metadata (error_message del proveedor, motivo
// del RPA…). Sin esto, el panel solo mostraba el summary genérico y para saber la
// causa había que consultar ops_events por SQL.
function eventMotivo(event: { metadata: Record<string, unknown> | null }): string | null {
  const md = event.metadata;
  if (!md) return null;
  const raw = md.error_message ?? md.motivo ?? md.error ?? null;
  if (typeof raw !== "string" || !raw.trim()) return null;
  return raw.length > 220 ? `${raw.slice(0, 220)}…` : raw;
}

type EstadoRespaldo = OpsSnapshot["respaldo"]["estado"];

function respaldoColor(estado: EstadoRespaldo) {
  if (estado === "ok") return C.green;
  if (estado === "fallido") return C.accent;
  return C.amber;
}

function respaldoTitulo(estado: EstadoRespaldo) {
  if (estado === "ok") return "Al día y verificado";
  if (estado === "sin_verificar") return "Hecho, sin verificar";
  if (estado === "fallido") return "Falló";
  if (estado === "atrasado") return "Atrasado";
  return "Sin noticias";
}

/**
 * El detalle habla de tiempo y de verificación, nunca de ubicación. Que el
 * respaldo exista es información de operación; dónde vive es un secreto.
 */
function respaldoDetalle(r: OpsSnapshot["respaldo"]) {
  if (r.estado === "sin_datos") {
    return "El respaldo nunca ha avisado que corrió. O no está instalado, o la máquina que lo corre está apagada.";
  }
  const hace = r.horas === null
    ? ""
    : r.horas < 1
      ? "hace menos de una hora"
      : `hace ${Math.round(r.horas)} ${Math.round(r.horas) === 1 ? "hora" : "horas"}`;
  if (r.estado === "fallido") {
    return `El último intento (${hace}) falló. Mientras no haya respaldo, un problema en la base no tiene vuelta atrás.`;
  }
  if (r.estado === "atrasado") {
    return `El último fue ${hace}. Debería correr cada noche: revisa que la máquina esté encendida.`;
  }
  if (r.estado === "sin_verificar") {
    return `Se hizo ${hace}, pero no se comprobó restaurándolo. Un volcado que nunca se restauró es un archivo, no un respaldo.`;
  }
  return `El último se hizo ${hace} y se comprobó restaurándolo y cotejando los conteos.`;
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
      <Section
        title="La plataforma"
        tone="warning"
        hint="No se pudo leer el estado de la plataforma. Revisa tu acceso, arriba."
      >
        <div style={{ color: C.amber, fontSize: 13, fontWeight: 900 }}>Salud operacional no disponible</div>
      </Section>
    );
  }

  const statusColor = snapshot.status === "critical" ? C.accent : snapshot.status === "degraded" ? C.amber : C.green;
  return (
    <Section
      title="La plataforma"
      tone={snapshot.status === "critical" ? "error" : snapshot.status === "degraded" ? "warning" : "muted"}
      hint="Cómo está el sistema entero, no una cuenta: colas de documentos, emisiones que fallaron y eventos de las últimas 24 horas. Snapshot seguro: sin payloads, claves, XML, PDFs ni prompts."
    >
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "baseline" }}>
        <div style={{ color: statusColor, fontSize: 13, fontWeight: 900 }}>
          Salud operacional {statusLabel(snapshot.status)}
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
        <Metric label="Bloqueos vencidos" value={snapshot.metrics.locksExpirados} tone={snapshot.metrics.locksExpirados > 0 ? "warn" : "ok"} />
        <Metric label="Emisiones fallidas 24h" value={snapshot.metrics.jobsEmisionFallidos24h} tone={snapshot.metrics.jobsEmisionFallidos24h > 0 ? "warn" : "ok"} />
        <Metric label="Errores ops 24h" value={snapshot.metrics.opsErrores24h} tone={snapshot.metrics.opsCriticos24h > 0 ? "critical" : snapshot.metrics.opsErrores24h > 0 ? "warn" : "ok"} />
        <Metric label="Cola docs en espera" value={snapshot.metrics.documentJobsQueued} tone={snapshot.metrics.documentJobsQueued > 10 ? "warn" : "ok"} />
        <Metric label="Cola docs corriendo" value={snapshot.metrics.documentJobsRunning} tone="ok" />
        <Metric label="Cola docs fallida 24h" value={snapshot.metrics.documentJobsFailed24h} tone={snapshot.metrics.documentJobsFailed24h > 0 ? "warn" : "ok"} />
        <Metric label="Cola docs atascada" value={snapshot.metrics.documentJobsStale} tone={snapshot.metrics.documentJobsStale > 0 ? "critical" : "ok"} />
      </div>

      {/*
        Respaldo: dice SI anda, nunca DÓNDE. Ni proveedor, ni ruta, ni máquina.
        Esta pantalla se ve en capturas y el respaldo es lo último que queda si
        todo lo demás se cae.
      */}
      <div
        style={{
          marginTop: 14,
          border: `1px solid ${snapshot.respaldo.estado === "ok" ? C.border : `${respaldoColor(snapshot.respaldo.estado)}55`}`,
          background: snapshot.respaldo.estado === "ok" ? C.muted : `${respaldoColor(snapshot.respaldo.estado)}0f`,
          borderRadius: 10,
          padding: "11px 12px",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
          <span style={{ fontSize: 11, color: C.text3, textTransform: "uppercase", letterSpacing: ".07em", fontWeight: 900 }}>
            Respaldo local
          </span>
          <span style={{ fontSize: 12, fontWeight: 900, color: respaldoColor(snapshot.respaldo.estado) }}>
            {respaldoTitulo(snapshot.respaldo.estado)}
          </span>
        </div>
        <p style={{ margin: "6px 0 0", fontSize: 12, color: C.text2, lineHeight: 1.5 }}>
          {respaldoDetalle(snapshot.respaldo)}
        </p>
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
                {eventMotivo(event) && (
                  <div style={{ marginTop: 3, color: C.text3, fontSize: 11, lineHeight: 1.45, fontFamily: "ui-monospace, monospace", wordBreak: "break-word" }}>
                    {eventMotivo(event)}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </Section>
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
            <h1 style={{ margin: "3px 0 0", fontSize: 22 }}>Estado del sistema</h1>
          </div>
          <DevNav activa="sistema" />
        </header>

        <Section
          title="Tu acceso"
          tone={data.ok ? "muted" : "warning"}
          hint="Por qué el servidor te deja entrar —o no— al panel. Solo muestra el estado de TU sesión: acá no hay datos de clientes ni claves."
        >
          <div
            style={{
              color: data.ok ? C.green : C.amber,
              fontSize: 13,
              fontWeight: 900,
              marginBottom: 4,
            }}
          >
            {data.ok ? "Acceso dev OK" : "El servidor no está aceptando esta sesión como operador dev"}
          </div>

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
        </Section>

        <OpsHealth snapshot={opsSnapshot} />
      </div>
    </main>
  );
}

export const dynamic = "force-dynamic";
