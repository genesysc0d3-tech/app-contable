import { notFound, redirect } from "next/navigation";
import { obtenerDevCuentaDetalle, type DevCuentaDetalle } from "@/lib/dev/account-360";
import { DevLinkButton, VerComoClienteButton } from "../DevCuentaActions";

const C = {
  bg: "#0f1014",
  surface: "#16181d",
  border: "rgba(255,255,255,.07)",
  text: "#e8eaf0",
  text2: "#9aa0ad",
  text3: "#636878",
  accent: "#E8553E",
  amber: "#f59e0b",
  green: "#22c55e",
  muted: "rgba(255,255,255,.045)",
} as const;

function fmtClp(value: number | null) {
  if (value === null) return "sin monto";
  return `$${Math.round(value).toLocaleString("es-CL")}`;
}

function fmtDate(value: string | null | undefined) {
  if (!value) return "sin fecha";
  return new Intl.DateTimeFormat("es-CL", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "America/Santiago",
  }).format(new Date(value));
}

function toneColor(tone: "ok" | "warning" | "error" | "muted") {
  if (tone === "ok") return C.green;
  if (tone === "warning") return C.amber;
  if (tone === "error") return C.accent;
  return C.text2;
}

function Pill({
  children,
  tone = "muted",
}: {
  children: string;
  tone?: "ok" | "warning" | "error" | "muted";
}) {
  const color = toneColor(tone);
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        border: `1px solid ${tone === "muted" ? C.border : `${color}55`}`,
        background: tone === "muted" ? C.muted : `${color}14`,
        color,
        borderRadius: 999,
        padding: "3px 8px",
        fontSize: 10,
        fontWeight: 800,
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </span>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section
      style={{
        background: C.surface,
        border: `1px solid ${C.border}`,
        borderRadius: 12,
        padding: 14,
        minWidth: 0,
      }}
    >
      <h2 style={{ margin: "0 0 10px", fontSize: 12, color: C.text2, textTransform: "uppercase", letterSpacing: ".08em" }}>
        {title}
      </h2>
      {children}
    </section>
  );
}

function StatusTile({
  label,
  value,
  sub,
  tone = "muted",
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "ok" | "warning" | "error" | "muted";
}) {
  const color = toneColor(tone);
  return (
    <div
      style={{
        border: `1px solid ${tone === "muted" ? C.border : `${color}44`}`,
        background: tone === "muted" ? C.muted : `${color}0f`,
        borderRadius: 10,
        padding: "10px 11px",
        minWidth: 0,
      }}
    >
      <div style={{ fontSize: 10, color: C.text3, textTransform: "uppercase", letterSpacing: ".07em", fontWeight: 850 }}>
        {label}
      </div>
      <div style={{ marginTop: 5, fontSize: 20, fontWeight: 950, lineHeight: 1, color: tone === "muted" ? C.text : color }}>
        {value}
      </div>
      {sub && <div style={{ marginTop: 5, fontSize: 11, color: C.text2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{sub}</div>}
    </div>
  );
}

function EmptyState({ children }: { children: string }) {
  return (
    <div
      style={{
        border: `1px dashed ${C.border}`,
        background: "rgba(255,255,255,.025)",
        borderRadius: 10,
        padding: "13px 12px",
        fontSize: 12,
        color: C.text2,
      }}
    >
      {children}
    </div>
  );
}

function QuickCheck({
  label,
  value,
  tone,
  sub,
}: {
  label: string;
  value: string;
  tone: "ok" | "warning" | "error" | "muted";
  sub?: string;
}) {
  return (
    <div style={{ borderTop: `1px solid ${C.border}`, padding: "9px 0", minWidth: 0 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "baseline" }}>
        <span style={{ fontSize: 10, color: C.text3, textTransform: "uppercase", letterSpacing: ".07em", fontWeight: 850 }}>
          {label}
        </span>
        <Pill tone={tone}>{value}</Pill>
      </div>
      {sub && <div style={{ marginTop: 4, fontSize: 11, color: C.text2 }}>{sub}</div>}
    </div>
  );
}

function CompactRow({
  left,
  right,
  sub,
}: {
  left: React.ReactNode;
  right?: React.ReactNode;
  sub?: React.ReactNode;
}) {
  return (
    <div style={{ borderTop: `1px solid ${C.border}`, padding: "9px 0", display: "flex", gap: 10, alignItems: "center" }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12, fontWeight: 750, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{left}</div>
        {sub && <div style={{ marginTop: 3, fontSize: 10, color: C.text3 }}>{sub}</div>}
      </div>
      {right && <div style={{ flexShrink: 0, display: "flex", gap: 6, alignItems: "center" }}>{right}</div>}
    </div>
  );
}

function PriorityPanel({ data }: { data: DevCuentaDetalle }) {
  const problems = data.diagnostico
    .filter((item) => item.codigo !== "ok")
    .sort((a, b) => (a.codigo === b.codigo ? 0 : a.codigo === "error" ? -1 : 1));
  const errors = problems.filter((item) => item.codigo === "error").length;
  const warnings = problems.filter((item) => item.codigo === "warning").length;
  const lock = data.emision.lockActivo;
  const empresasSobreCupo = data.cuenta.empresasActivas > data.cuenta.empresasPermitidas;
  const personasSobreCupo = data.cuenta.personasActivas > data.cuenta.personasPermitidas;
  const healthTone = errors > 0 ? "error" : warnings > 0 ? "warning" : "ok";
  const title = errors > 0
    ? "Hay bloqueos que revisar"
    : warnings > 0
      ? "Hay advertencias operativas"
      : "Cuenta sin alertas principales";
  const subtitle = errors > 0
    ? "Parte por los errores antes de entrar en modo cliente o revisar pagos."
    : warnings > 0
      ? "La cuenta puede operar, pero hay señales que conviene confirmar."
      : "Plan, pagos, cupos y emisión no muestran problemas críticos en esta vista.";
  const nextStep = errors > 0
    ? problems[0]?.texto ?? "Revisar el diagnostico antes de entrar en modo cliente."
    : lock
      ? "Hay una emision real en curso. Espera cierre, fallo o expiracion antes de probar otra emision."
      : warnings > 0
        ? problems[0]?.texto ?? "Confirmar la advertencia principal y luego probar como cliente."
        : "Entrar en modo cliente y confirmar que la cuenta ve funciones, cupos y empresas esperadas.";

  return (
    <section
      style={{
        background: C.surface,
        border: `1px solid ${healthTone === "ok" ? C.border : `${toneColor(healthTone)}55`}`,
        borderRadius: 12,
        padding: 14,
      }}
    >
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, .95fr) minmax(320px, .75fr)", gap: 14, alignItems: "start" }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <Pill tone={healthTone}>{healthTone === "ok" ? "OK" : healthTone === "error" ? `${errors} error${errors === 1 ? "" : "es"}` : `${warnings} advertencia${warnings === 1 ? "" : "s"}`}</Pill>
            <span style={{ fontSize: 11, color: C.text3, fontWeight: 800, textTransform: "uppercase", letterSpacing: ".08em" }}>
              Prioridad
            </span>
          </div>
          <h2 style={{ margin: "8px 0 4px", fontSize: 18, lineHeight: 1.15 }}>
            {title}
          </h2>
          <p style={{ margin: 0, fontSize: 12, color: C.text2, lineHeight: 1.45 }}>
            {subtitle}
          </p>
          <div
            style={{
              marginTop: 11,
              border: `1px solid ${C.border}`,
              background: C.muted,
              borderRadius: 10,
              padding: "9px 10px",
            }}
          >
            <div style={{ fontSize: 10, color: C.text3, textTransform: "uppercase", letterSpacing: ".08em", fontWeight: 850 }}>
              Siguiente paso
            </div>
            <div style={{ marginTop: 4, fontSize: 12, color: C.text, lineHeight: 1.35 }}>
              {nextStep}
            </div>
          </div>

          <div style={{ marginTop: 10 }}>
            {problems.length === 0 ? (
              <CompactRow left="No hay errores ni advertencias en el diagnostico principal." right={<Pill tone="ok">listo</Pill>} />
            ) : (
              problems.slice(0, 5).map((item) => (
                <CompactRow
                  key={item.texto}
                  left={item.texto}
                  right={<Pill tone={item.codigo === "error" ? "error" : "warning"}>{item.codigo}</Pill>}
                />
              ))
            )}
            {problems.length > 5 && (
              <div style={{ borderTop: `1px solid ${C.border}`, paddingTop: 8, fontSize: 11, color: C.text3 }}>
                {problems.length - 5} señales adicionales en diagnostico.
              </div>
            )}
          </div>
        </div>

        <div style={{ minWidth: 0 }}>
          <QuickCheck
            label="Plan"
            value={data.cuenta.planActivo ? "liberado" : "bloqueado"}
            tone={data.cuenta.planActivo ? "ok" : "error"}
            sub={data.cuenta.planNombre}
          />
          <QuickCheck
            label="Pago"
            value={data.cuenta.ultimoPagoEstado ?? "sin pago"}
            tone={data.cuenta.ultimoPagoEstado === "approved" || data.cuenta.ultimoPagoEstado === "aprobado" ? "ok" : data.cuenta.ultimoPagoEstado ? "warning" : "error"}
            sub={fmtClp(data.cuenta.ultimoPagoMontoClp)}
          />
          <QuickCheck
            label="Cupos"
            value={empresasSobreCupo || personasSobreCupo ? "sobre cupo" : "dentro"}
            tone={empresasSobreCupo || personasSobreCupo ? "error" : "ok"}
            sub={`Empresas ${data.cuenta.empresasActivas}/${data.cuenta.empresasPermitidas} · Personas ${data.cuenta.personasActivas}/${data.cuenta.personasPermitidas}`}
          />
          <QuickCheck
            label="Emision"
            value={lock ? "bloqueada" : "libre"}
            tone={lock ? "warning" : "ok"}
            sub={lock ? `${lock.usuarioNombre} · ${lock.estado_visible}` : "Sin lock activo"}
          />
        </div>
      </div>
    </section>
  );
}

function Diagnostico({ data }: { data: DevCuentaDetalle["diagnostico"] }) {
  return (
    <div>
      {data.map((item) => (
        <CompactRow
          key={item.texto}
          left={item.texto}
          right={<Pill tone={item.codigo === "warning" ? "warning" : item.codigo === "error" ? "error" : "ok"}>{item.codigo}</Pill>}
        />
      ))}
    </div>
  );
}

function Empresas({ data }: { data: DevCuentaDetalle["empresas"] }) {
  return (
    <div>
      {data.map((empresa) => (
        <CompactRow
          key={empresa.id}
          left={empresa.nombre}
          sub={`${empresa.rutMasked} · ${empresa.tipoContribuyente} · boletas ${empresa.proveedorBoletas} · facturas ${empresa.proveedorFacturas}`}
          right={
            <>
              {empresa.esPrincipal && <Pill tone="ok">principal</Pill>}
              <Pill tone={empresa.planActivo ? "ok" : "error"}>{empresa.planActivo ? "activa" : "bloqueada"}</Pill>
              <Pill tone={empresa.certificadoLocal ? "ok" : "muted"}>{empresa.certificadoLocal ? "certificado" : "sin cert."}</Pill>
              <VerComoClienteButton empresaId={empresa.id} compacto>
                Ver
              </VerComoClienteButton>
            </>
          }
        />
      ))}
    </div>
  );
}

function Personas({ data }: { data: DevCuentaDetalle["usuarios"] }) {
  return (
    <div>
      {data.map((usuario) => (
        <CompactRow
          key={usuario.id}
          left={usuario.nombre}
          sub={usuario.emailMasked}
          right={
            <>
              {usuario.esTitular && <Pill tone="ok">titular</Pill>}
              {usuario.devMode && <Pill tone="warning">dev</Pill>}
              {usuario.vetado && <Pill tone="error">vetado</Pill>}
              <Pill tone={usuario.activo ? "ok" : "muted"}>{usuario.activo ? "activo" : "inactivo"}</Pill>
            </>
          }
        />
      ))}
    </div>
  );
}

function Addons({ data }: { data: DevCuentaDetalle["addons"] }) {
  if (data.length === 0) return <div style={{ fontSize: 11, color: C.text2 }}>Sin extras activos o históricos.</div>;
  return (
    <div>
      {data.map((addon) => (
        <CompactRow
          key={addon.id}
          left={`${addon.tipo} × ${addon.cantidad.toLocaleString("es-CL")}`}
          sub={`${addon.origen} · ${addon.periodo ?? "sin periodo"} · ${fmtDate(addon.created_at)}`}
          right={<Pill tone={addon.estado === "activo" ? "ok" : "muted"}>{addon.estado}</Pill>}
        />
      ))}
    </div>
  );
}

function Finanzas({ data }: { data: Pick<DevCuentaDetalle, "suscripciones" | "pagos"> }) {
  if (data.suscripciones.length === 0 && data.pagos.length === 0) {
    return <EmptyState>No hay pagos ni suscripciones asociadas a esta cuenta. Si el cliente pagó, revisar webhook/proveedor antes de liberar funciones manualmente.</EmptyState>;
  }

  return (
    <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", gap: 14 }}>
      <div>
        <h3 style={{ margin: "0 0 4px", fontSize: 11, color: C.text2 }}>Suscripciones</h3>
        {data.suscripciones.length === 0 && <EmptyState>Sin suscripciones.</EmptyState>}
        {data.suscripciones.slice(0, 6).map((suscripcion) => (
          <CompactRow
            key={suscripcion.id}
            left={`${suscripcion.plan_codigo} · ${suscripcion.estado}`}
            sub={`${suscripcion.proveedor} · ${fmtDate(suscripcion.created_at)} · vence ${fmtDate(suscripcion.periodo_hasta)}`}
            right={<Pill tone={suscripcion.estado === "activa" ? "ok" : "warning"}>{fmtClp(suscripcion.clp_ultimo_cobro)}</Pill>}
          />
        ))}
      </div>
      <div>
        <h3 style={{ margin: "0 0 4px", fontSize: 11, color: C.text2 }}>Pagos</h3>
        {data.pagos.length === 0 && <EmptyState>Sin pagos.</EmptyState>}
        {data.pagos.slice(0, 8).map((pago) => (
          <CompactRow
            key={pago.id}
            left={`${pago.tipo} · ${pago.estado}`}
            sub={`${pago.proveedor} · ${fmtDate(pago.created_at)} · ref ${pago.proveedor_ref ?? "sin ref"}`}
            right={<Pill tone={pago.estado === "approved" || pago.estado === "aprobado" ? "ok" : "warning"}>{fmtClp(pago.monto_clp)}</Pill>}
          />
        ))}
      </div>
    </div>
  );
}

function Emision({ data }: { data: DevCuentaDetalle["emision"] }) {
  if (!data.lockActivo && data.jobs.length === 0 && data.folios.length === 0) {
    return <EmptyState>No hay emisión real en curso, jobs recientes ni reservas de folio. La cuenta está libre para iniciar una emisión si su plan y proveedor lo permiten.</EmptyState>;
  }

  return (
    <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", gap: 14 }}>
      <div>
        <h3 style={{ margin: "0 0 4px", fontSize: 11, color: C.text2 }}>Lock activo</h3>
        {data.lockActivo ? (
          <CompactRow
            left={`${data.lockActivo.usuarioNombre} · ${data.lockActivo.estado_visible}`}
            sub={`${data.lockActivo.usuarioEmailMasked} · ${data.lockActivo.provider} · vence ${fmtDate(data.lockActivo.locked_until)}`}
            right={<Pill tone="warning">bloqueando</Pill>}
          />
        ) : (
          <EmptyState>Sin bloqueo de emisión real.</EmptyState>
        )}

        <h3 style={{ margin: "16px 0 4px", fontSize: 11, color: C.text2 }}>Jobs recientes</h3>
        {data.jobs.length === 0 && <EmptyState>Sin jobs.</EmptyState>}
        {data.jobs.map((job) => (
          <CompactRow
            key={job.job_id}
            left={`${job.provider} · ${job.estado_visible || job.estado}`}
            sub={`${job.empresaNombre} · ${job.usuarioEmailMasked} · ${fmtDate(job.created_at)}`}
            right={<Pill tone={job.estado === "completed" ? "ok" : job.estado === "failed" ? "error" : "warning"}>{job.estado}</Pill>}
          />
        ))}
      </div>
      <div>
        <h3 style={{ margin: "0 0 4px", fontSize: 11, color: C.text2 }}>Reservas de folio</h3>
        {data.folios.length === 0 && <EmptyState>Sin reservas.</EmptyState>}
        {data.folios.map((folio) => (
          <CompactRow
            key={folio.id}
            left={`${folio.empresaNombre} · ${folio.tipo_dte} #${folio.folio}`}
            sub={`${folio.job_id} · ${fmtDate(folio.created_at)}`}
            right={<Pill tone={folio.estado === "usado" ? "ok" : folio.estado === "fallido" ? "error" : "warning"}>{folio.estado}</Pill>}
          />
        ))}
      </div>
    </div>
  );
}

function Auditoria({ data }: { data: DevCuentaDetalle["auditoria"] }) {
  if (data.length === 0) return <EmptyState>Sin eventos recientes.</EmptyState>;
  const visible = data.slice(0, 8);
  const hidden = data.length - visible.length;

  return (
    <div>
      {visible.map((event) => (
        <CompactRow
          key={event.id}
          left={event.resumen}
          sub={`${event.empresaNombre ?? "Cuenta"} · ${event.usuarioEmailMasked} · ${fmtDate(event.created_at)}`}
          right={<Pill tone={event.accion === "emision_fallida" ? "error" : "muted"}>{event.accion}</Pill>}
        />
      ))}
      {hidden > 0 && (
        <div style={{ borderTop: `1px solid ${C.border}`, paddingTop: 9, fontSize: 11, color: C.text3 }}>
          {hidden} evento{hidden === 1 ? "" : "s"} mas oculto{hidden === 1 ? "" : "s"} para mantener esta vista compacta.
        </div>
      )}
    </div>
  );
}

export default async function DevCuentaDetallePage({
  params,
}: {
  params: Promise<{ cuentaId: string }>;
}) {
  const { cuentaId } = await params;
  const result = await obtenerDevCuentaDetalle(cuentaId);
  if (!result.ok) {
    if (result.error === "NO_AUTH") redirect(`/auth/login?next=/dev/cuentas/${cuentaId}`);
    if (result.error === "NOT_DEV_OPERATOR") redirect("/dev/diagnostico");
    if (result.status === 403 || result.status === 404) notFound();
    throw new Error(`${result.error}${result.detalle ? `: ${result.detalle}` : ""}`);
  }

  const detalle = result.data;
  const cuenta = detalle.cuenta;
  const cuota = detalle.uso.cuota;

  return (
    <main
      style={{
        minHeight: "100dvh",
        background: C.bg,
        color: C.text,
        fontFamily: "'DM Sans','Inter',sans-serif",
        padding: "18px",
      }}
    >
      <div style={{ maxWidth: 1320, margin: "0 auto", display: "flex", flexDirection: "column", gap: 14 }}>
        <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 11, color: C.text3, fontWeight: 800, textTransform: "uppercase", letterSpacing: ".08em" }}>
              Cuenta pagadora
            </div>
            <h1 style={{ margin: "2px 0 0", fontSize: 22, lineHeight: 1.1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {cuenta.nombre}
            </h1>
            <div style={{ marginTop: 4, fontSize: 11, color: C.text2 }}>
              {cuenta.ownerNombre} · {cuenta.ownerEmailMasked}
            </div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
              <Pill tone={cuenta.planActivo ? "ok" : "error"}>{cuenta.planActivo ? "funciones liberadas" : "bloqueada"}</Pill>
              <Pill>{cuenta.planNombre}</Pill>
              {detalle.funciones.equipo && <Pill tone="ok">Business equipo</Pill>}
              {detalle.funciones.multiempresa && <Pill tone="ok">multiempresa</Pill>}
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <DevLinkButton href="/dev/cuentas">Cuentas</DevLinkButton>
            <DevLinkButton href="/dev/diagnostico">Diagnostico</DevLinkButton>
            <VerComoClienteButton empresaId={cuenta.empresaPrincipalId}>Ver como cliente</VerComoClienteButton>
          </div>
        </header>

        <PriorityPanel data={detalle} />

        <Section title="Resumen operativo">
          <div style={{ display: "grid", gridTemplateColumns: "repeat(6, minmax(0, 1fr))", gap: 8 }}>
            <StatusTile
              label="Plan"
              value={cuenta.planNombre}
              sub={cuenta.planActivo ? "funciones liberadas" : "bloqueado"}
              tone={cuenta.planActivo ? "ok" : "error"}
            />
            <StatusTile
              label="Pago"
              value={cuenta.ultimoPagoEstado ?? "sin pago"}
              sub={fmtClp(cuenta.ultimoPagoMontoClp)}
              tone={cuenta.ultimoPagoEstado === "approved" || cuenta.ultimoPagoEstado === "aprobado" ? "ok" : "warning"}
            />
            <StatusTile label="Empresas" value={`${cuenta.empresasActivas}/${cuenta.empresasPermitidas}`} tone={cuenta.empresasActivas > cuenta.empresasPermitidas ? "error" : "ok"} />
            <StatusTile label="Personas" value={`${cuenta.personasActivas}/${cuenta.personasPermitidas}`} tone={cuenta.personasActivas > cuenta.personasPermitidas ? "error" : "ok"} />
            <StatusTile
              label="Cartolas"
              value={`${detalle.uso.boletasDesdeCartolasMes}/${detalle.funciones.boletasDesdeCartolas}`}
              sub={`disponible ${cuota?.disponible.toLocaleString("es-CL") ?? "sin dato"}`}
              tone={cuota && cuota.disponible <= 0 ? "error" : "muted"}
            />
            <StatusTile
              label="Propuestas"
              value={`${detalle.uso.propuestasPendientes}/${detalle.uso.propuestasListas}`}
              sub="pendientes / listas"
              tone={detalle.uso.propuestasPendientes > 0 ? "warning" : "muted"}
            />
          </div>
        </Section>

        <div style={{ display: "grid", gridTemplateColumns: "minmax(0, .9fr) minmax(0, 1.1fr)", gap: 12 }}>
          <Section title="Diagnóstico">
            <Diagnostico data={detalle.diagnostico} />
          </Section>
          <Section title="Empresas">
            <Empresas data={detalle.empresas} />
          </Section>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "minmax(0, .9fr) minmax(0, 1.1fr)", gap: 12 }}>
          <Section title="Personas">
            <Personas data={detalle.usuarios} />
          </Section>
          <Section title="Extras">
            <Addons data={detalle.addons} />
          </Section>
        </div>

        <Section title="Pagos y suscripción">
          <Finanzas data={detalle} />
        </Section>

        <Section title="Emisión local">
          <Emision data={detalle.emision} />
        </Section>

        <Section title="Auditoría">
          <Auditoria data={detalle.auditoria} />
        </Section>
      </div>
    </main>
  );
}

export const dynamic = "force-dynamic";
