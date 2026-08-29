/**
 * Lista de cuentas pagadoras: la puerta de entrada del panel.
 *
 * Arriba explica qué es el panel y qué hay en cada pantalla —el operador entra
 * acá a veces cada varias semanas— y el único control global que existe (el
 * trial público) vive en su propio bloque explicado, no suelto en la cabecera
 * al lado de un link: prenderlo cambia la oferta para TODAS las cuentas.
 */
import { notFound, redirect } from "next/navigation";
import { listarDevCuentas, type DevCuentaRow } from "@/lib/dev/account-360";
import { DevLinkButton, VerComoClienteButton, TrialGlobalToggle } from "./DevCuentaActions";
import { obtenerTrialGlobal } from "../actions";
import { C, DevNav, Explica, Pill, Section, fmtClp, fmtFecha, toneColor, type Tone } from "../ui";

type FiltroEstado = "todas" | "alertas" | "bloqueadas" | "sin_pago" | "sobre_cupo";

function normalizarFiltro(value: string | string[] | undefined): FiltroEstado {
  const raw = Array.isArray(value) ? value[0] : value;
  return raw === "alertas" || raw === "bloqueadas" || raw === "sin_pago" || raw === "sobre_cupo" ? raw : "todas";
}

function sobreCupo(cuenta: DevCuentaRow) {
  return cuenta.empresasActivas > cuenta.empresasPermitidas || cuenta.personasActivas > cuenta.personasPermitidas;
}

function sinPago(cuenta: DevCuentaRow) {
  return !cuenta.ultimoPagoEstado;
}

function conAlerta(cuenta: DevCuentaRow) {
  return cuenta.alertas.length > 0 || !cuenta.planActivo || sinPago(cuenta) || sobreCupo(cuenta);
}

function tonoCuenta(cuenta: DevCuentaRow): Tone {
  if (!cuenta.planActivo || sobreCupo(cuenta)) return "error";
  if (sinPago(cuenta) || cuenta.alertas.length > 0) return "warning";
  return "ok";
}

function etiquetaTono(tone: Tone) {
  if (tone === "error") return "accion";
  if (tone === "warning") return "revisar";
  return "ok";
}

function filtrarCuentas(cuentas: DevCuentaRow[], filtro: FiltroEstado) {
  if (filtro === "alertas") return cuentas.filter(conAlerta);
  if (filtro === "bloqueadas") return cuentas.filter((cuenta) => !cuenta.planActivo);
  if (filtro === "sin_pago") return cuentas.filter(sinPago);
  if (filtro === "sobre_cupo") return cuentas.filter(sobreCupo);
  return cuentas;
}

function filtroHref(filtro: FiltroEstado, query: string) {
  const params = new URLSearchParams();
  if (query) params.set("q", query);
  if (filtro !== "todas") params.set("estado", filtro);
  const qs = params.toString();
  return qs ? `/dev/cuentas?${qs}` : "/dev/cuentas";
}

function FilterLink({
  filtro,
  activo,
  query,
  count,
  children,
}: {
  filtro: FiltroEstado;
  activo: boolean;
  query: string;
  count: number;
  children: string;
}) {
  return (
    <a
      href={filtroHref(filtro, query)}
      style={{
        border: `1px solid ${activo ? "rgba(232,85,62,.48)" : C.border}`,
        background: activo ? "rgba(232,85,62,.14)" : C.muted,
        color: activo ? C.accent : C.text2,
        borderRadius: 999,
        padding: "6px 10px",
        fontSize: 10,
        fontWeight: 850,
        textDecoration: "none",
        whiteSpace: "nowrap",
      }}
    >
      {children} <span style={{ color: activo ? C.text : C.text3 }}>{count.toLocaleString("es-CL")}</span>
    </a>
  );
}

function MetricCard({ label, value, sub, tone = "muted" }: { label: string; value: number; sub: string; tone?: Tone }) {
  const color = toneColor(tone);
  return (
    <div
      style={{
        border: `1px solid ${C.border}`,
        background: C.muted,
        borderRadius: 10,
        padding: "10px 11px",
        minWidth: 0,
      }}
    >
      <div style={{ fontSize: 10, color: C.text3, textTransform: "uppercase", letterSpacing: ".07em", fontWeight: 850 }}>
        {label}
      </div>
      <div style={{ marginTop: 5, color, fontSize: 20, lineHeight: 1, fontWeight: 950 }}>
        {value.toLocaleString("es-CL")}
      </div>
      <div style={{ marginTop: 5, fontSize: 10, color: C.text3, lineHeight: 1.35 }}>{sub}</div>
    </div>
  );
}

function CuentaRow({ cuenta }: { cuenta: DevCuentaRow }) {
  const estadoPlan: Tone = cuenta.planActivo ? "ok" : "error";
  const estadoPago: Tone =
    cuenta.ultimoPagoEstado === "approved" || cuenta.ultimoPagoEstado === "aprobado"
      ? "ok"
      : cuenta.ultimoPagoEstado
        ? "warning"
        : "error";
  const tone = tonoCuenta(cuenta);
  const color = toneColor(tone);
  const issue = cuenta.alertas[0] ?? (!cuenta.planActivo ? "plan bloqueado" : sinPago(cuenta) ? "sin pago registrado" : sobreCupo(cuenta) ? "sobre cupo" : "sin alertas");

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "minmax(230px, 1.35fr) minmax(145px, .65fr) minmax(150px, .65fr) minmax(190px, .9fr) auto",
        gap: 12,
        alignItems: "center",
        borderTop: `1px solid ${C.border}`,
        borderLeft: `3px solid ${color}`,
        background: tone === "ok" ? "transparent" : `${color}0c`,
        borderRadius: 10,
        marginTop: 8,
        padding: "12px 10px",
      }}
    >
      <div style={{ minWidth: 0 }}>
        <div style={{ display: "flex", gap: 7, alignItems: "center", minWidth: 0 }}>
          <div
            style={{
              fontSize: 13,
              fontWeight: 850,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              minWidth: 0,
            }}
          >
            {cuenta.nombre}
          </div>
          <Pill tone={tone}>{etiquetaTono(tone)}</Pill>
        </div>
        <div style={{ fontSize: 10, color: C.text3, marginTop: 3 }}>
          {cuenta.ownerNombre} · {cuenta.ownerEmailMasked}
        </div>
        <div style={{ fontSize: 10, color: C.text2, marginTop: 3 }}>
          {cuenta.empresaPrincipalNombre ?? "sin empresa principal"}
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 5, alignItems: "flex-start" }}>
        <Pill tone={estadoPlan}>{cuenta.planNombre}</Pill>
        <span style={{ fontSize: 10, color: C.text3 }}>actualizado {fmtFecha(cuenta.updatedAt)}</span>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 5, alignItems: "flex-start" }}>
        <Pill tone={estadoPago}>{cuenta.ultimoPagoEstado ?? "sin pago"}</Pill>
        <span style={{ fontSize: 10, color: C.text3 }}>{fmtClp(cuenta.ultimoPagoMontoClp)}</span>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
        <span style={{ fontSize: 10, color: tone === "ok" ? C.text3 : color, fontWeight: 850, textTransform: "uppercase", letterSpacing: ".06em" }}>
          {issue}
        </span>
        <span style={{ fontSize: 11, color: C.text2 }}>
          Empresas {cuenta.empresasActivas}/{cuenta.empresasPermitidas}
        </span>
        <span style={{ fontSize: 11, color: C.text2 }}>
          Personas {cuenta.personasActivas}/{cuenta.personasPermitidas}
        </span>
        {cuenta.alertas.length > 1 && (
          <span style={{ fontSize: 10, color: C.amber }}>{cuenta.alertas.join(" · ")}</span>
        )}
      </div>

      <div style={{ display: "flex", gap: 6, justifyContent: "flex-end", alignItems: "center" }}>
        <DevLinkButton href={`/dev/cuentas/${cuenta.id}`}>Detalle</DevLinkButton>
        <VerComoClienteButton empresaId={cuenta.empresaPrincipalId} compacto>
          Ver cliente
        </VerComoClienteButton>
      </div>
    </div>
  );
}

export default async function DevCuentasPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string | string[] | undefined; estado?: string | string[] | undefined }>;
}) {
  const params = await searchParams;
  const rawQuery = Array.isArray(params.q) ? params.q[0] : params.q;
  const query = (rawQuery ?? "").trim().slice(0, 80);
  const filtro = normalizarFiltro(params.estado);
  const result = await listarDevCuentas({ query });
  if (!result.ok) {
    if (result.error === "NO_AUTH") redirect("/auth/login?next=/dev/cuentas");
    if (result.error === "NOT_DEV_OPERATOR") redirect("/dev/diagnostico");
    if (result.status === 403 || result.status === 404) notFound();
    throw new Error(`${result.error}${result.detalle ? `: ${result.detalle}` : ""}`);
  }

  const cuentasBase = result.data;
  const cuentas = filtrarCuentas(cuentasBase, filtro);
  const total = cuentasBase.length;
  const totalAlertas = cuentasBase.filter(conAlerta).length;
  const totalBloqueadas = cuentasBase.filter((cuenta) => !cuenta.planActivo).length;
  const totalSinPago = cuentasBase.filter(sinPago).length;
  const totalSobreCupo = cuentasBase.filter(sobreCupo).length;
  const trialGlobalOn = await obtenerTrialGlobal();

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
      <div style={{ maxWidth: 1280, margin: "0 auto", display: "flex", flexDirection: "column", gap: 14 }}>
        <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
          <div>
            <div style={{ fontSize: 11, color: C.text3, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".08em" }}>
              Panel operador
            </div>
            <h1 style={{ margin: "2px 0 0", fontSize: 22, lineHeight: 1.1 }}>Cuentas</h1>
          </div>
          <DevNav activa="cuentas" />
        </header>

        <Section
          title="Qué hay en este panel"
          hint="Dos pantallas y nada más. Todo lo que escribe algo vive dentro de una cuenta, nunca suelto por acá."
        >
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 10 }}>
            {[
              {
                titulo: "Cuentas (esta pantalla)",
                texto: "Buscar una cuenta y ver de un vistazo cuáles necesitan atención. Entrando al detalle está todo lo demás: plan, pagos, empresas, emisión y los controles de soporte.",
              },
              {
                titulo: "Estado del sistema",
                texto: "Si TU acceso de operador está bien y cómo está la plataforma completa: colas, emisiones fallidas y eventos de las últimas 24 horas. No muestra datos de clientes.",
              },
            ].map((item) => (
              <div key={item.titulo} style={{ border: `1px solid ${C.border}`, background: C.muted, borderRadius: 10, padding: "10px 11px" }}>
                <div style={{ fontSize: 12, fontWeight: 900 }}>{item.titulo}</div>
                <div style={{ marginTop: 4, fontSize: 11, color: C.text2, lineHeight: 1.5 }}>{item.texto}</div>
              </div>
            ))}
          </div>
        </Section>

        <Section
          title="Account 360"
          hint="Plan, pago, cupos y acceso de soporte. No muestra documentos, imágenes ni el crudo de los pagos."
        >
          <form action="/dev/cuentas" style={{ display: "flex", gap: 8, marginBottom: 10 }}>
            {filtro !== "todas" && <input type="hidden" name="estado" value={filtro} />}
            <input
              name="q"
              defaultValue={query}
              placeholder="Buscar cuenta, empresa, RUT, plan o correo"
              style={{
                flex: 1,
                minWidth: 0,
                border: `1px solid ${C.border}`,
                background: C.muted,
                color: C.text,
                borderRadius: 8,
                padding: "9px 10px",
                fontSize: 12,
                outline: "none",
              }}
            />
            <button
              type="submit"
              style={{
                border: `1px solid ${C.border}`,
                background: C.muted,
                color: C.text,
                borderRadius: 8,
                padding: "9px 12px",
                fontSize: 11,
                fontWeight: 800,
              }}
            >
              Buscar
            </button>
            {query && <DevLinkButton href="/dev/cuentas">Limpiar</DevLinkButton>}
          </form>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(5, minmax(0, 1fr))", gap: 8, marginBottom: 10 }}>
            <MetricCard label="Coinciden" value={total} sub="cuentas en la búsqueda actual" />
            <MetricCard label="Con alertas" value={totalAlertas} sub="algo que mirar, no siempre urgente" tone={totalAlertas > 0 ? "warning" : "ok"} />
            <MetricCard label="Bloqueadas" value={totalBloqueadas} sub="pagan pero no ven sus funciones" tone={totalBloqueadas > 0 ? "error" : "ok"} />
            <MetricCard label="Sin pago" value={totalSinPago} sub="ningún cobro registrado todavía" tone={totalSinPago > 0 ? "warning" : "ok"} />
            <MetricCard label="Sobre cupo" value={totalSobreCupo} sub="más empresas o personas que su plan" tone={totalSobreCupo > 0 ? "error" : "ok"} />
          </div>

          <div style={{ display: "flex", gap: 7, flexWrap: "wrap", marginBottom: 8 }}>
            <FilterLink filtro="todas" activo={filtro === "todas"} query={query} count={total}>Todas</FilterLink>
            <FilterLink filtro="alertas" activo={filtro === "alertas"} query={query} count={totalAlertas}>Alertas</FilterLink>
            <FilterLink filtro="bloqueadas" activo={filtro === "bloqueadas"} query={query} count={totalBloqueadas}>Bloqueadas</FilterLink>
            <FilterLink filtro="sin_pago" activo={filtro === "sin_pago"} query={query} count={totalSinPago}>Sin pago</FilterLink>
            <FilterLink filtro="sobre_cupo" activo={filtro === "sobre_cupo"} query={query} count={totalSobreCupo}>Sobre cupo</FilterLink>
          </div>

          <div style={{ fontSize: 11, color: C.text3, marginBottom: 4 }}>
            Mostrando {cuentas.length.toLocaleString("es-CL")} de {total.toLocaleString("es-CL")} cuenta{total === 1 ? "" : "s"}
            {query ? ` para "${query}"` : ""}.
          </div>

          {cuentas.length === 0 ? (
            <div style={{ borderTop: `1px solid ${C.border}`, paddingTop: 14, fontSize: 12, color: C.text2 }}>
              {query || filtro !== "todas" ? "No hay cuentas que coincidan con la vista actual." : "No hay cuentas pagadoras registradas."}
            </div>
          ) : (
            <div>
              {cuentas.map((cuenta) => (
                <CuentaRow key={cuenta.id} cuenta={cuenta} />
              ))}
            </div>
          )}
        </Section>

        <Section title="Trial público" tone="warning">
          <Explica
            tono="warning"
            que="Prende o apaga la prueba gratis para TODAS las cuentas sin plan, incluida gente que se registre en el próximo minuto."
            cuando="Abrir o cerrar la prueba como oferta pública. Para una cuenta puntual está el trial de cortesía, dentro de su detalle."
            ojo="El trial emite documentos tributarios REALES contra el SII. Los folios que gaste la gente no se pueden deshacer."
          />
          <TrialGlobalToggle habilitado={trialGlobalOn} />
        </Section>
      </div>
    </main>
  );
}

export const dynamic = "force-dynamic";
