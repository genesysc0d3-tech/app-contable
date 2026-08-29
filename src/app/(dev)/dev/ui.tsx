/**
 * Piezas visuales compartidas del panel /dev.
 *
 * Antes cada página repetía su propia paleta, su propio `Pill` y su propio
 * `Section`, y el detalle de cuenta mezclaba lo que se MIRA con lo que se
 * ESCRIBE. El panel funcionaba, pero mareaba: no había forma de saber, sin
 * leer el código, si un bloque solo informaba o si tocarlo cambiaba la cuenta
 * de un cliente real.
 *
 * De ahí las dos reglas que impone este archivo:
 *
 *  1. Los bloques se agrupan por CONSECUENCIA, no por tema: `Fase` separa
 *     mirar / actuar / no-se-vuelve-atrás.
 *  2. Todo control que escribe lleva un `Explica` con las mismas tres líneas
 *     —qué hace, cuándo se usa, ojo—. Si un control nuevo no puede llenarlas,
 *     todavía no está listo para vivir acá.
 *
 * Server components: no hay estado ni handlers. Los botones con estado viven
 * en DevCuentaActions.tsx.
 */
import type { ReactNode } from "react";

export const C = {
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

export type Tone = "ok" | "warning" | "error" | "muted";

export function toneColor(tone: Tone) {
  if (tone === "ok") return C.green;
  if (tone === "warning") return C.amber;
  if (tone === "error") return C.accent;
  return C.text2;
}

export function fmtClp(value: number | null) {
  if (value === null) return "sin monto";
  return `$${Math.round(value).toLocaleString("es-CL")}`;
}

export function fmtFecha(value: string | null | undefined, conHora = false) {
  if (!value) return "sin fecha";
  return new Intl.DateTimeFormat("es-CL", {
    dateStyle: "medium",
    ...(conHora ? { timeStyle: "short" as const } : {}),
    timeZone: "America/Santiago",
  }).format(new Date(value));
}

export function Pill({ children, tone = "muted" }: { children: string; tone?: Tone }) {
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

/** Barra de navegación: las tres pantallas del panel, siempre a la vista. */
export function DevNav({ activa }: { activa: "cuentas" | "sistema" }) {
  const items = [
    { id: "cuentas" as const, href: "/dev/cuentas", label: "Cuentas" },
    { id: "sistema" as const, href: "/dev/diagnostico", label: "Estado del sistema" },
  ];
  return (
    <nav style={{ display: "flex", gap: 6 }}>
      {items.map((item) => {
        const on = item.id === activa;
        return (
          <a
            key={item.id}
            href={item.href}
            style={{
              border: `1px solid ${on ? "rgba(232,85,62,.45)" : C.border}`,
              background: on ? "rgba(232,85,62,.12)" : C.muted,
              color: on ? C.accent : C.text2,
              borderRadius: 7,
              padding: "7px 11px",
              fontSize: 11,
              fontWeight: 800,
              textDecoration: "none",
              whiteSpace: "nowrap",
            }}
          >
            {item.label}
          </a>
        );
      })}
    </nav>
  );
}

/**
 * Separador de fase. Le dice al operador, antes de seguir bajando, qué tipo de
 * cosa viene: mirar no cambia nada, actuar escribe en la cuenta de alguien,
 * peligro no se deshace.
 */
export function Fase({
  paso,
  titulo,
  descripcion,
  tono = "muted",
}: {
  paso: string;
  titulo: string;
  descripcion: string;
  tono?: Tone;
}) {
  const color = toneColor(tono);
  return (
    <div
      style={{
        display: "flex",
        alignItems: "baseline",
        gap: 10,
        marginTop: 8,
        paddingBottom: 2,
        borderBottom: `1px solid ${tono === "muted" ? C.border : `${color}44`}`,
      }}
    >
      <span
        style={{
          fontSize: 10,
          fontWeight: 950,
          color,
          letterSpacing: ".1em",
          textTransform: "uppercase",
          whiteSpace: "nowrap",
        }}
      >
        {paso}
      </span>
      <span style={{ fontSize: 13, fontWeight: 900, color: tono === "muted" ? C.text : color }}>{titulo}</span>
      <span style={{ fontSize: 11, color: C.text2, lineHeight: 1.4 }}>{descripcion}</span>
    </div>
  );
}

export function Section({
  title,
  hint,
  tone = "muted",
  children,
}: {
  title: string;
  /** Una línea: qué muestra este bloque y para qué sirve mirarlo. */
  hint?: string;
  tone?: Tone;
  children: ReactNode;
}) {
  const color = toneColor(tone);
  return (
    <section
      style={{
        background: C.surface,
        border: `1px solid ${tone === "muted" ? C.border : `${color}55`}`,
        borderRadius: 12,
        padding: 14,
        minWidth: 0,
      }}
    >
      <h2
        style={{
          margin: 0,
          fontSize: 12,
          color: tone === "muted" ? C.text2 : color,
          textTransform: "uppercase",
          letterSpacing: ".08em",
        }}
      >
        {title}
      </h2>
      {hint && (
        <p style={{ margin: "5px 0 0", fontSize: 11, color: C.text3, lineHeight: 1.5, maxWidth: 720 }}>{hint}</p>
      )}
      <div style={{ marginTop: 11 }}>{children}</div>
    </section>
  );
}

/**
 * Ficha de un control que ESCRIBE. Las tres líneas son obligatorias a
 * propósito: la mitad del mareo era no saber qué NO hace un botón.
 */
export function Explica({
  que,
  cuando,
  ojo,
  tono = "muted",
}: {
  que: string;
  cuando: string;
  ojo: string;
  tono?: Tone;
}) {
  const color = toneColor(tono);
  const filas: Array<[string, string]> = [
    ["Qué hace", que],
    ["Cuándo", cuando],
    ["Ojo", ojo],
  ];
  return (
    <div
      style={{
        border: `1px solid ${tono === "muted" ? C.border : `${color}33`}`,
        background: tono === "muted" ? C.muted : `${color}0b`,
        borderRadius: 10,
        padding: "10px 11px",
        marginBottom: 11,
        display: "flex",
        flexDirection: "column",
        gap: 6,
        maxWidth: 720,
      }}
    >
      {filas.map(([etiqueta, texto], i) => (
        <div key={etiqueta} style={{ display: "grid", gridTemplateColumns: "62px minmax(0, 1fr)", gap: 10 }}>
          <span
            style={{
              fontSize: 10,
              fontWeight: 900,
              letterSpacing: ".06em",
              textTransform: "uppercase",
              color: i === 2 ? color : C.text3,
            }}
          >
            {etiqueta}
          </span>
          <span style={{ fontSize: 11, color: i === 2 && tono !== "muted" ? color : C.text2, lineHeight: 1.5 }}>
            {texto}
          </span>
        </div>
      ))}
    </div>
  );
}

export function EmptyState({ children }: { children: string }) {
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

export function CompactRow({
  left,
  right,
  sub,
}: {
  left: ReactNode;
  right?: ReactNode;
  sub?: ReactNode;
}) {
  return (
    <div style={{ borderTop: `1px solid ${C.border}`, padding: "9px 0", display: "flex", gap: 10, alignItems: "center" }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12, fontWeight: 750, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {left}
        </div>
        {sub && <div style={{ marginTop: 3, fontSize: 10, color: C.text3 }}>{sub}</div>}
      </div>
      {right && <div style={{ flexShrink: 0, display: "flex", gap: 6, alignItems: "center" }}>{right}</div>}
    </div>
  );
}
