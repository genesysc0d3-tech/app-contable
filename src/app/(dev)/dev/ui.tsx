/**
 * Piezas visuales compartidas del panel /dev.
 *
 * Los bloques se agrupan por CONSECUENCIA, no por tema: `Fase` separa mirar /
 * actuar / no-se-vuelve-atrás, y todo control que escribe lleva un `Explica`
 * con las mismas tres líneas.
 *
 * REGLA DURA sobre esas tres líneas: describen lo que hace el código de
 * actions.ts, y un texto que promete de más es PEOR que no tener texto —
 * traslada la vigilancia del operador a un cartel que miente. La primera
 * versión de este archivo tenía tres explicaciones falsas el mismo día que se
 * escribió. Por eso las afirmaciones están amarradas por
 * `explicaciones.test.ts`: si alguien cambia la regla en el server, el test
 * cae y obliga a revisar el texto.
 *
 * Server components: no hay estado ni handlers. Los botones con estado viven
 * en DevCuentaActions.tsx. Los colores viven en colors.ts (sin JSX) para que
 * ese archivo cliente pueda importarlos sin arrastrarse este.
 */
import Link from "next/link";
import type { ReactNode } from "react";
import { C, toneColor, type Tone } from "./colors";

export { C, toneColor, type Tone };

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

/** Las pantallas del panel. Una sola fuente: el texto de la portada la usa. */
export const PANTALLAS = [
  {
    id: "cuentas" as const,
    href: "/dev/cuentas",
    label: "Cuentas",
    title: "Ir a la lista de todas las cuentas.",
  },
  {
    id: "sistema" as const,
    href: "/dev/diagnostico",
    label: "Estado del sistema",
    title: "Ir a la salud de la plataforma entera: tu acceso, colas, emisiones fallidas y eventos de las últimas 24 horas.",
  },
];

/**
 * Navegación entre pantallas. `activa` es opcional a propósito: en el detalle
 * de una cuenta no estás en NINGUNA de las dos, y pintar "Cuentas" como
 * pestaña actual ahí sería mentir.
 */
export function DevNav({ activa }: { activa?: "cuentas" | "sistema" }) {
  return (
    <nav style={{ display: "flex", gap: 6 }}>
      {PANTALLAS.map((item) => {
        const on = item.id === activa;
        return (
          <Link
            key={item.id}
            href={item.href}
            title={item.title}
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
          </Link>
        );
      })}
    </nav>
  );
}

/**
 * Separador de fase. Dice, antes de seguir bajando, qué tipo de cosa viene.
 * Es un `<h2>` con `id` para que el header pegajoso pueda saltar acá: sin
 * atajo, ordenar en vertical solo aleja los controles.
 */
export function Fase({
  id,
  paso,
  titulo,
  descripcion,
  tono = "muted",
}: {
  id: string;
  paso: string;
  titulo: string;
  descripcion: string;
  tono?: Tone;
}) {
  const color = toneColor(tono);
  return (
    <h2
      id={id}
      style={{
        display: "flex",
        alignItems: "baseline",
        flexWrap: "wrap",
        gap: "4px 10px",
        margin: "8px 0 0",
        paddingBottom: 3,
        // 110 y no 76: la barra tiene flexWrap y bajo ~950px el grupo derecho
        // baja a una segunda línea, con lo que pasa de 100px. Con 76 el ancla
        // dejaba este título DEBAJO de la barra, o sea el atajo no servía.
        scrollMarginTop: 110,
        borderBottom: `1px solid ${tono === "muted" ? C.border : `${color}44`}`,
        fontSize: 13,
        fontWeight: 900,
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
      <span style={{ color: tono === "muted" ? C.text : color }}>{titulo}</span>
      <span style={{ fontSize: 11, fontWeight: 500, color: C.text2, lineHeight: 1.4 }}>{descripcion}</span>
    </h2>
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
      <h3
        style={{
          margin: 0,
          fontSize: 12,
          color: tone === "muted" ? C.text2 : color,
          textTransform: "uppercase",
          letterSpacing: ".08em",
        }}
      >
        {title}
      </h3>
      {/* text2, no text3: el hint es la explicación que este panel existe para
          dar. Pintarla con el gris más tenue la dejaba en 3,2:1 de contraste,
          menos legible que el texto genérico que vino a reemplazar. */}
      {hint && (
        <p style={{ margin: "5px 0 0", fontSize: 12, color: C.text2, lineHeight: 1.5, maxWidth: 760 }}>{hint}</p>
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
  // En el bloque irreversible la etiqueta carga el peso: "Ojo" alcanza para
  // una advertencia, no para algo que no tiene vuelta.
  const filas: Array<[string, string]> = [
    ["Qué hace", que],
    ["Cuándo", cuando],
    [tono === "error" ? "No se deshace" : "Ojo", ojo],
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
        maxWidth: 760,
      }}
    >
      {filas.map(([etiqueta, texto], i) => (
        <div key={etiqueta} style={{ display: "grid", gridTemplateColumns: "auto minmax(0, 1fr)", gap: 10 }}>
          <span
            style={{
              fontSize: 10,
              fontWeight: 900,
              letterSpacing: ".06em",
              textTransform: "uppercase",
              whiteSpace: "nowrap",
              color: i === 2 ? color : C.text3,
            }}
          >
            {etiqueta}
          </span>
          <span style={{ fontSize: 12, color: i === 2 && tono !== "muted" ? color : C.text2, lineHeight: 1.5 }}>
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
