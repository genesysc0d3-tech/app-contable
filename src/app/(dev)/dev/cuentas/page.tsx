import { notFound, redirect } from "next/navigation";
import { listarDevCuentas, type DevCuentaRow } from "@/lib/dev/account-360";
import { DevLinkButton, VerComoClienteButton, TrialGlobalToggle } from "./DevCuentaActions";
import { obtenerTrialGlobal } from "../actions";

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

type FiltroEstado = "todas" | "alertas" | "bloqueadas" | "sin_pago" | "sobre_cupo";
type RowTone = "ok" | "warn" | "bad";

function fmtClp(value: number | null) {
  if (value === null) return "sin monto";
  return `$${Math.round(value).toLocaleString("es-CL")}`;
}

function fmtDate(value: string) {
  return new Intl.DateTimeFormat("es-CL", {
    dateStyle: "medium",
    timeZone: "America/Santiago",
  }).format(new Date(value));
}

function Pill({ children, tone = "muted" }: { children: string; tone?: "muted" | "ok" | "warn" | "bad" }) {
  const color = tone === "ok" ? C.green : tone === "warn" ? C.amber : tone === "bad" ? C.accent : C.text2;
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        border: `1px solid ${tone === "muted" ? C.border : `${color}55`}`,
        background: tone === "muted" ? C.muted : `${color}14`,
        color,
        borderRadius: 999,
        padding: "3px 7px",
        fontSize: 10,
        fontWeight: 700,
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </span>
  );
}

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

function tonoCuenta(cuenta: DevCuentaRow): RowTone {
  if (!cuenta.planActivo || sobreCupo(cuenta)) return "bad";
  if (sinPago(cuenta) || cuenta.alertas.length > 0) return "warn";
  return "ok";
}

function etiquetaTono(tone: RowTone) {
  if (tone === "bad") return "accion";
  if (tone === "warn") return "revisar";
  return "ok";
}

function colorTono(tone: RowTone) {
  if (tone === "bad") return C.accent;
  if (tone === "warn") return C.amber;
  return C.green;
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

function MetricCard({
  label,
  value,
  tone = "muted",
}: {
  label: string;
  value: number;
  tone?: "muted" | "ok" | "warn" | "bad";
}) {
  const color = tone === "ok" ? C.green : tone === "warn" ? C.amber : tone === "bad" ? C.accent : C.text2;
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
    </div>
  );
}

function CuentaRow({ cuenta }: { cuenta: DevCuentaRow }) {
  const estadoPlan = cuenta.planActivo ? "ok" : "bad";
  const estadoPago = cuenta.ultimoPagoEstado === "approved" || cuenta.ultimoPagoEstado === "aprobado" ? "ok" : cuenta.ultimoPagoEstado ? "warn" : "bad";
  const tone = tonoCuenta(cuenta);
  const toneColor = colorTono(tone);
  const issue = cuenta.alertas[0] ?? (!cuenta.planActivo ? "plan bloqueado" : sinPago(cuenta) ? "sin pago registrado" : sobreCupo(cuenta) ? "sobre cupo" : "sin alertas");

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "minmax(230px, 1.35fr) minmax(145px, .65fr) minmax(150px, .65fr) minmax(190px, .9fr) auto",
        gap: 12,
        alignItems: "center",
        borderTop: `1px solid ${C.border}`,
        borderLeft: `3px solid ${toneColor}`,
        background: tone === "ok" ? "transparent" : `${toneColor}0c`,
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
        <span style={{ fontSize: 10, color: C.text3 }}>actualizado {fmtDate(cuenta.updatedAt)}</span>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 5, alignItems: "flex-start" }}>
        <Pill tone={estadoPago}>{cuenta.ultimoPagoEstado ?? "sin pago"}</Pill>
        <span style={{ fontSize: 10, color: C.text3 }}>{fmtClp(cuenta.ultimoPagoMontoClp)}</span>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
        <span style={{ fontSize: 10, color: tone === "ok" ? C.text3 : toneColor, fontWeight: 850, textTransform: "uppercase", letterSpacing: ".06em" }}>
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
          <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <TrialGlobalToggle habilitado={trialGlobalOn} />
            <DevLinkButton href="/dev/diagnostico">Diagnostico</DevLinkButton>
          </div>
        </header>

        <section
          style={{
            background: C.surface,
            border: `1px solid ${C.border}`,
            borderRadius: 12,
            padding: "14px",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", gap: 10, marginBottom: 4 }}>
            <div>
              <h2 style={{ margin: 0, fontSize: 13 }}>Account 360</h2>
              <p style={{ margin: "4px 0 0", fontSize: 11, color: C.text2 }}>
                Plan, pago, cupos y acceso de soporte. No muestra documentos, imágenes ni raw de pagos.
              </p>
            </div>
            <Pill>{`${cuentas.length.toLocaleString("es-CL")} cuentas`}</Pill>
          </div>

          <form action="/dev/cuentas" style={{ display: "flex", gap: 8, margin: "12px 0 6px" }}>
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

          <div style={{ display: "grid", gridTemplateColumns: "repeat(5, minmax(0, 1fr))", gap: 8, margin: "10px 0 10px" }}>
            <MetricCard label="Coinciden" value={total} tone="muted" />
            <MetricCard label="Con alertas" value={totalAlertas} tone={totalAlertas > 0 ? "warn" : "ok"} />
            <MetricCard label="Bloqueadas" value={totalBloqueadas} tone={totalBloqueadas > 0 ? "bad" : "ok"} />
            <MetricCard label="Sin pago" value={totalSinPago} tone={totalSinPago > 0 ? "warn" : "ok"} />
            <MetricCard label="Sobre cupo" value={totalSobreCupo} tone={totalSobreCupo > 0 ? "bad" : "ok"} />
          </div>

          <div style={{ display: "flex", gap: 7, flexWrap: "wrap", margin: "0 0 8px" }}>
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
        </section>
      </div>
    </main>
  );
}

export const dynamic = "force-dynamic";
