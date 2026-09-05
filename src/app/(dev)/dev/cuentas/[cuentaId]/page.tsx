/**
 * Ficha de una cuenta pagadora para el operador.
 *
 * El orden de la página NO es temático, es por consecuencia: primero todo lo
 * que solo se MIRA, después los controles que ESCRIBEN en la cuenta de un
 * cliente real, y al final —separado y solo— lo que no se puede deshacer.
 * Antes la purga total vivía en el medio, entre dos bloques informativos, y se
 * pasaba por encima de ella en cada scroll.
 */
import { notFound, redirect } from "next/navigation";
import { obtenerDevCuentaDetalle, fmtProveedor, type DevCuentaDetalle } from "@/lib/dev/account-360";
import { CopiarButton, VerComoClienteButton, PlanToggle, TrialCortesiaToggle, ReiniciarTrialButton, PurgarCuentaButton, MigrarEmpresaForm, CarrilEmisionSelector } from "../DevCuentaActions";
import {
  C,
  CompactRow,
  DevNav,
  EmptyState,
  Explica,
  Fase,
  Pill,
  Section,
  fmtClp,
  fmtFecha,
  toneColor,
  type Tone,
} from "../../ui";

const fmtDate = (value: string | null | undefined) => fmtFecha(value, true);

const ancla = {
  border: `1px solid ${C.border}`,
  background: C.muted,
  color: C.text2,
  borderRadius: 7,
  padding: "6px 10px",
  fontSize: 11,
  fontWeight: 800,
  textDecoration: "none",
  whiteSpace: "nowrap" as const,
};

function StatusTile({
  label,
  value,
  sub,
  tone = "muted",
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: Tone;
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

function QuickCheck({
  label,
  value,
  tone,
  sub,
}: {
  label: string;
  value: string;
  tone: Tone;
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

function PriorityPanel({ data }: { data: DevCuentaDetalle }) {
  const problems = data.diagnostico
    .filter((item) => item.codigo !== "ok")
    .sort((a, b) => (a.codigo === b.codigo ? 0 : a.codigo === "error" ? -1 : 1));
  const errors = problems.filter((item) => item.codigo === "error").length;
  const warnings = problems.filter((item) => item.codigo === "warning").length;
  const lock = data.emision.lockActivo;
  const empresasSobreCupo = data.cuenta.empresasActivas > data.cuenta.empresasPermitidas;
  const personasSobreCupo = data.cuenta.personasActivas > data.cuenta.personasPermitidas;
  const healthTone: Tone = errors > 0 ? "error" : warnings > 0 ? "warning" : "ok";
  const title = errors > 0
    ? "Hay errores que revisar"
    : warnings > 0
      ? "Hay advertencias"
      : "Cuenta sin alertas";
  const subtitle = errors > 0
    ? "Parte por los errores antes de entrar en modo cliente o revisar pagos."
    : warnings > 0
      ? "La cuenta puede operar, pero hay señales que conviene confirmar."
      : "Plan, pagos, cupos y emisión no muestran problemas críticos en esta vista.";
  // El paso viene de la señal misma (account-360), no de su título: antes esta
  // caja repetía el síntoma —«Sin suscripción asociada» no es un paso— y
  // fallaba justo cuando había problemas, que es cuando se lee.
  //
  // Y el candado gana antes que cualquier advertencia: mientras hay folios en
  // juego, "no toques nada" manda sobre "esta cuenta no registra pagos". La
  // primera versión de esto ordenaba solo por código y dejaba el candado
  // último, o sea degradaba justo la advertencia irreversible.
  const urgente = problems.find((item) => item.codigo === "error")
    ?? (lock ? problems.find((item) => item.texto.startsWith("Emisión real en curso")) : undefined)
    ?? problems[0];
  const nextStep = urgente
    ? urgente.paso ?? urgente.texto
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
              <CompactRow left="No hay errores ni advertencias en las señales de la cuenta." right={<Pill tone="ok">listo</Pill>} />
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
                {problems.length - 5} señales más abajo.
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
            label="Emisión"
            value={lock ? "bloqueada" : "libre"}
            tone={lock ? "warning" : "ok"}
            sub={lock ? `${lock.usuarioNombre} · ${lock.estado_visible}` : "Sin bloqueo activo"}
          />
        </div>
      </div>
    </section>
  );
}

function Senales({ data }: { data: DevCuentaDetalle["diagnostico"] }) {
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
  // Una cuenta sin empresas dejaba el bloque en blanco: ni filas ni aviso.
  if (data.length === 0) {
    return <EmptyState>Esta cuenta no tiene ninguna empresa. Es lo que se ve cuando alguien se registró y nunca terminó de crearla, o cuando su única empresa se migró a otra cuenta.</EmptyState>;
  }
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
              {/* El formulario de traer una empresa pide este id y el panel no
                  lo mostraba en ninguna parte: había que ir a buscarlo por SQL
                  para usar un control del propio panel. */}
              <CopiarButton valor={empresa.id} etiqueta="copiar id" />
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
  if (data.length === 0) {
    return <EmptyState>Nadie está vinculado a esta cuenta. Si el cliente dice que no puede entrar, esta es la razón.</EmptyState>;
  }
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
  if (data.length === 0) return <EmptyState>Sin extras activos o históricos.</EmptyState>;
  return (
    <div>
      {data.map((addon) => (
        <CompactRow
          key={addon.id}
          left={`${addon.tipo} × ${addon.cantidad.toLocaleString("es-CL")}`}
          sub={`${addon.origen} · ${addon.periodo ?? "sin período"} · ${fmtDate(addon.created_at)}`}
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
            sub={`${fmtProveedor(suscripcion.proveedor)} · ${fmtDate(suscripcion.created_at)} · vence ${fmtDate(suscripcion.periodo_hasta)}`}
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
            sub={`${fmtProveedor(pago.proveedor)} · ${fmtDate(pago.created_at)} · ref ${pago.proveedor_ref ?? "sin ref"}`}
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
        <h3 style={{ margin: "0 0 4px", fontSize: 11, color: C.text2 }}>Bloqueo activo</h3>
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
          {hidden} evento{hidden === 1 ? "" : "s"} más, oculto{hidden === 1 ? "" : "s"} por espacio.
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
    if (result.error === "NOT_DEV_OPERATOR" || result.error === "MFA_NO_ENROLADO" || result.error === "MFA_REQUERIDO") redirect("/dev/diagnostico");
    if (result.status === 403 || result.status === 404) notFound();
    throw new Error(`${result.error}${result.detalle ? `: ${result.detalle}` : ""}`);
  }

  const detalle = result.data;
  const cuenta = detalle.cuenta;
  const cuota = detalle.uso.cuota;
  // entitlements.ts resuelve el plan desde la suscripción viva en CADA lectura:
  // con una activa, escribir el plan a mano no tiene efecto ninguno.
  const suscripcionActiva = detalle.suscripciones.some((s) => s.estado === "activa");

  return (
    <main
      style={{
        minHeight: "100dvh",
        background: C.bg,
        color: C.text,
        fontFamily: "var(--font-geist-sans), sans-serif",
        padding: "18px",
      }}
    >
      <div style={{ maxWidth: 1320, margin: "0 auto", display: "flex", flexDirection: "column", gap: 14 }}>
        {/*
          Barra PEGAJOSA. Dos razones, las dos aprendidas rompiendo esta misma
          página: (1) ordenar por consecuencia deja los controles abajo, y sin
          atajo eso es "más ordenado y más lejos"; (2) a esa altura del scroll
          ninguna de las tarjetas dice de quién es la cuenta, y ahí es donde se
          le cambia el plan a la empresa equivocada.
        */}
        <header
          style={{
            position: "sticky",
            top: 0,
            zIndex: 10,
            margin: "-18px -18px 0",
            padding: "12px 18px",
            background: "rgba(15,16,20,.92)",
            backdropFilter: "blur(8px)",
            borderBottom: `1px solid ${C.border}`,
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 12,
            flexWrap: "wrap",
          }}
        >
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 10, color: C.text3, fontWeight: 800, textTransform: "uppercase", letterSpacing: ".08em" }}>
              Cuenta pagadora
            </div>
            <h1 style={{ margin: "1px 0 0", fontSize: 18, lineHeight: 1.15, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {cuenta.nombre}
            </h1>
          </div>
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            {/*
              Los saltos van encerrados y rotulados. Sueltos se veían iguales a
              los botones que hacen cosas —seis controles idénticos en fila, tres
              tipos distintos— y daban susto: parecía que «Peligro» iba a hacer
              algo peligroso, cuando solo baja la página.
            */}
            <div
              style={{
                display: "flex",
                gap: 6,
                alignItems: "center",
                border: `1px dashed ${C.border}`,
                borderRadius: 9,
                padding: "5px 8px",
              }}
            >
              <span style={{ fontSize: 10, color: C.text3, fontWeight: 800, letterSpacing: ".06em", textTransform: "uppercase", whiteSpace: "nowrap" }}>
                Ir a panel:
              </span>
              <a href="#mirar" style={ancla} title="Baja al estado de la cuenta: plan, pagos, empresas, personas, emisión y auditoría.">Mirar</a>
              <a href="#actuar" style={ancla} title="Baja a los controles que se pueden deshacer: cambiar el plan y prestar la prueba gratis.">Actuar</a>
              <a href="#peligro" style={{ ...ancla, color: C.accent, borderColor: "rgba(232,85,62,.4)" }} title="Baja a los dos controles sin vuelta atrás: traer una empresa y borrar la cuenta. Bajar no hace nada.">Peligro</a>
            </div>
            <DevNav />
            <VerComoClienteButton empresaId={cuenta.empresaPrincipalId}>Ver como cliente</VerComoClienteButton>
          </div>
        </header>

        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 12, color: C.text2 }}>
            {cuenta.ownerNombre} · {cuenta.ownerEmailMasked}
          </div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
            <Pill tone={cuenta.planActivo ? "ok" : "error"}>{cuenta.planActivo ? "funciones liberadas" : "bloqueada"}</Pill>
            <Pill>{cuenta.planNombre}</Pill>
            {suscripcionActiva && <Pill tone="ok">suscripción activa</Pill>}
            {detalle.funciones.equipo && <Pill tone="ok">Business equipo</Pill>}
            {detalle.funciones.multiempresa && <Pill tone="ok">multiempresa</Pill>}
          </div>
        </div>

        <PriorityPanel data={detalle} />

        {/*
          La descripción NO dice "solo lectura": sería falso. «Ver como
          cliente» vive en esta zona (en la barra y en cada fila de empresa) y
          escribe cookie + auditoría en la cuenta del cliente. Un cartel que
          dice "tranquilo" sobre el control más invasivo después del borrado es
          peor que no tener cartel.
        */}
        <Fase
          id="mirar"
          paso="1 · Mirar"
          titulo="Estado de la cuenta"
          descripcion="Lectura, con una excepción: «Ver como cliente»."
        />

        {/* Plegado: es la nota al pie de la excepción, no un bloque de la
            página. Abierto empujaba los datos hacia abajo en cada visita. */}
        <details style={{ border: `1px solid ${C.border}`, background: C.surface, borderRadius: 12, padding: "10px 14px" }}>
          <summary style={{ fontSize: 12, color: C.text2, fontWeight: 800, cursor: "pointer", letterSpacing: ".04em" }}>
            ¿QUÉ HACE «VER COMO CLIENTE»?
            <span style={{ color: C.text3, fontWeight: 600, letterSpacing: 0 }}> — el único control que escribe en esta zona</span>
          </summary>
          <div style={{ marginTop: 11 }}>
            <Explica
              que="Abre la app con la empresa del cliente, en modo soporte de solo lectura, con tu propia sesión. Deja registro en la auditoría de esa cuenta y te muestra una barra diciendo que estás adentro."
              cuando="Para ver lo que ve el cliente cuando reporta algo que en estas tablas no se nota."
              ojo="La sesión de soporte dura 4 horas y NO se cierra sola al volver acá con el botón del navegador: hay que salir con «Volver a dev». Para escribir de verdad hace falta que el cliente te dé su código de 6 dígitos."
            />
          </div>
        </details>

        <Section
          title="Resumen operativo"
          hint="Los seis números que explican casi cualquier reclamo: si el plan está liberado, si el último cobro pasó, si se pasó de empresas o personas, y cuánta cuota de cartolas le queda este mes."
        >
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
          <Section
            title="Señales de la cuenta"
            hint="Chequeos automáticos sobre ESTA cuenta. No confundir con «Estado del sistema», que mira la plataforma entera."
          >
            <Senales data={detalle.diagnostico} />
          </Section>
          <Section
            title="Empresas"
            hint="Cada empresa con su RUT enmascarado, su tipo de contribuyente y por qué carril emite boletas y facturas."
          >
            <Empresas data={detalle.empresas} />
          </Section>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "minmax(0, .9fr) minmax(0, 1.1fr)", gap: 12 }}>
          <Section title="Personas" hint="Quiénes entran a esta cuenta. «Titular» es quien paga; «dev» y «vetado» son marcas nuestras.">
            <Personas data={detalle.usuarios} />
          </Section>
          <Section title="Extras" hint="Boletas extra compradas aparte del plan, con su período y si siguen activas.">
            <Addons data={detalle.addons} />
          </Section>
        </div>

        <Section
          title="Pagos y suscripción"
          hint="Lo que dice la pasarela. Si el cliente asegura haber pagado y acá no aparece nada, el problema es el webhook, no el plan."
        >
          <Finanzas data={detalle} />
        </Section>

        <Section
          title="Emisión local"
          hint="Trabajos que la extensión corrió contra el SII, folios reservados y si hay una emisión real bloqueando la cuenta ahora mismo."
        >
          <Emision data={detalle.emision} />
        </Section>

        <Section title="Auditoría" hint="Últimos movimientos registrados de la cuenta, incluidas las entradas de soporte.">
          <Auditoria data={detalle.auditoria} />
        </Section>

        <Fase
          id="actuar"
          paso="2 · Actuar"
          titulo="Se puede deshacer"
          descripcion="Escriben en la cuenta de un cliente real, quedan auditados, y se revierten volviendo a tocarlos."
          tono="warning"
        />

        <Section title="Cambiar el plan" tone="warning">
          <Explica
            tono="warning"
            que="Fija a mano el plan y si sus funciones están liberadas, en la cuenta y en todas sus empresas de una vez. Si lo subes a un plan multiempresa, las empresas que un downgrade había dormido REVIVEN y se borra la elección de empresa operativa del cliente."
            cuando="La pasarela falló, hay que probar un tier, o una cuenta quedó bloqueada por un desfase nuestro."
            ojo="Si la cuenta tiene suscripción activa, el CÓDIGO de plan lo manda ella desde ya —no desde el próximo cobro— y lo que elijas acá lo pisa. Igual sirve tocarlo: sincroniza las empresas con el plan vigente y revive las que un downgrade había dormido."
          />
          <PlanToggle
            cuentaId={cuentaId}
            cuentaNombre={cuenta.nombre}
            planCodigo={cuenta.planCodigo}
            planActivo={cuenta.planActivo}
            suscripcionActiva={suscripcionActiva}
          />
        </Section>

        <Section title="Prestar la prueba gratis" tone="warning">
          <Explica
            tono="warning"
            que="Le habilita la prueba a ESTA cuenta aunque el trial público esté apagado."
            cuando="Un conocido o un cliente puntual al que le queremos dar la prueba sin abrirla para todo el mundo."
            ojo="La prueba emite documentos tributarios REALES: los folios que gaste no se pueden deshacer, aunque le quites la cortesía después."
          />
          <TrialCortesiaToggle cuentaId={cuentaId} cortesia={cuenta.trialCortesia} />
        </Section>

        <Section title="Reiniciar la prueba gratis" tone="warning">
          <Explica
            tono="warning"
            que="Le vuelve a prender la prueba a UNA empresa, con sus días completos contados desde hoy."
            cuando="El trial se le acabó y quieres darle otra pasada, o llegó tarde a usarlo y se le venció sin emitir nada."
            ojo="La prueba parte SOLA cuando se abre la cuenta y el reloj la apaga al vencer: esto es lo único que la vuelve a prender. Prestarle la prueba (arriba) NO mueve la fecha. Y emite documentos REALES: los folios que gaste no se deshacen."
          />
          {detalle.empresas.length === 0
            ? <div style={{ fontSize: 12, color: C.text3 }}>Esta cuenta no tiene empresas.</div>
            : detalle.empresas.map((e) => (
                <ReiniciarTrialButton key={e.id} empresaId={e.id} nombre={e.nombre} />
              ))}
        </Section>

        <Section title="Carril de emisión" tone="warning">
          <Explica
            tono="warning"
            que="Elige POR DÓNDE sale cada documento de una empresa: el simulador, la extensión del cliente o SimpleAPI."
            cuando="El cliente instaló la extensión y hay que sacarlo del simulador, o algo del carril real falla y hay que devolverlo al simulador mientras se arregla."
            ojo="Pasar a un carril real significa que el próximo lote emite documentos tributarios DE VERDAD, con folios que no se deshacen. No toca la configuración de afecta/exenta: eso es del cliente, en Empresa → Emisor."
          />
          {detalle.empresas.length === 0
            ? <div style={{ fontSize: 12, color: C.text3 }}>Esta cuenta no tiene empresas.</div>
            : detalle.empresas.map((e) => (
                <CarrilEmisionSelector key={e.id} empresaId={e.id} nombre={e.nombre} boletas={e.proveedorBoletas} facturas={e.proveedorFacturas} />
              ))}
        </Section>

        {/*
          Migrar vive en la fase 3, no en la 2: el server exige plan activo con
          CUPO libre en el destino, y devolverla exige que el origen tenga cupo
          de vuelta — no hay botón de deshacer, solo otra migración con sus
          mismos requisitos.
        */}
        <Fase
          id="peligro"
          paso="3 · No se vuelve atrás"
          titulo="Sin botón de deshacer"
          descripcion="Dos controles. Si dudas, no es acá."
          tono="error"
        />

        <Section title="Traer una empresa a esta cuenta" tone="error">
          <Explica
            tono="error"
            que="Re-apunta el vínculo de la empresa hacia esta cuenta: los datos no se copian, pero el titular de ACÁ pasa a ver toda la historia de esa empresa —cartolas, movimientos, RUTs de terceros y boletas—. También desconecta sus chats de Telegram, que hay que re-vincular desde esta cuenta."
            cuando="Unificar dos cuentas del mismo dueño, devolverle su empresa a alguien que perdió el acceso, o el DIVORCIO: un socio se separa y su empresa se muda a la cuenta nueva que él ya pagó. El id de la empresa se copia desde la ficha de su cuenta actual, en el bloque Empresas."
            ojo="Exige plan activo con cupo libre en el destino (el destino paga primero, siempre). No hay botón de deshacer: devolverla es otra migración, con cupo en el origen. Antes de tocar: verificar identidad por el runbook —unificación, responde desde ambos correos; recuperación, $1 con código desde el banco de la empresa—. Nunca pedir cédula. Si al origen le queda otra empresa, sus logins se re-apuntan solos; si no, el panel marca el login colgado en rojo."
          />
          <MigrarEmpresaForm cuentaId={cuentaId} />
        </Section>

        <Section title="Borrar la cuenta entera" tone="error">
          <Explica
            tono="error"
            que="Borra empresas, cartolas, documentos, movimientos, propuestas y el texto crudo que sobrevive al documento y trae RUTs y montos de terceros (audit_chunks, parser_logs). Conserva auth y consentimientos como prueba ARCO."
            cuando="El cliente ejerció su derecho de eliminación (Ley 21.719), o hay que limpiar una cuenta de prueba."
            ojo="Si la cuenta tiene aunque sea UNA boleta emitida en el SII, la purga se niega entera y no borra nada: son 6 años de retención tributaria y ese cierre se hace a mano. Para habilitar el botón hay que escribir el nombre de la CUENTA (el de la barra de arriba), que no siempre es la razón social."
          />
          <PurgarCuentaButton cuentaId={cuentaId} nombre={cuenta.nombre} />
        </Section>
      </div>
    </main>
  );
}

export const dynamic = "force-dynamic";
