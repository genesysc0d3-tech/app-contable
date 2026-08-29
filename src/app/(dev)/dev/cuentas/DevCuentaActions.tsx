"use client";

import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { entrarModoClienteDev, setCuentaPlan, setTrialGlobal, setCuentaTrialCortesia, purgarCuenta, migrarEmpresaACuenta } from "../actions";
import { C } from "../colors";

/**
 * Gramática de color de los botones, para que no contradiga la de las fases:
 * ámbar = escribe y se puede deshacer · rojo = no se deshace · gris = navega.
 * Antes "Guardar plan" era rojo igual que "Purgar cuenta", y "Traer empresa"
 * era gris igual que "Buscar".
 */
const BTN_AMBAR = { border: "1px solid rgba(245,158,11,.45)", background: C.amberSoft, color: C.text } as const;
const BTN_ROJO = { border: "1px solid rgba(232,85,62,.6)", background: "rgba(232,85,62,.18)", color: C.accent } as const;
const BTN_GRIS = { border: `1px solid ${C.border}`, background: C.muted, color: C.text } as const;
const BASE = { borderRadius: 7, padding: "7px 12px", fontSize: 11, fontWeight: 800 } as const;

export function VerComoClienteButton({
  empresaId,
  children = "Ver como cliente",
  compacto = false,
}: {
  empresaId: string | null;
  children?: ReactNode;
  compacto?: boolean;
}) {
  const router = useRouter();
  const [estado, setEstado] = useState<"idle" | "loading" | "error">("idle");

  async function entrar() {
    if (!empresaId || estado === "loading") return;
    setEstado("loading");
    const res = await entrarModoClienteDev(empresaId);
    if ("error" in res) {
      setEstado("error");
      return;
    }
    router.push("/massdte");
  }

  return (
    <button
      type="button"
      onClick={entrar}
      disabled={!empresaId || estado === "loading"}
      title={estado === "error" ? "No se pudo entrar en modo cliente" : undefined}
      style={{
        ...BTN_AMBAR,
        borderRadius: 7,
        padding: compacto ? "5px 9px" : "7px 11px",
        fontSize: compacto ? 10 : 11,
        fontWeight: 800,
        color: estado === "error" ? C.accent : C.text,
        cursor: !empresaId || estado === "loading" ? "default" : "pointer",
        opacity: !empresaId ? 0.45 : 1,
        whiteSpace: "nowrap",
      }}
    >
      {estado === "loading" ? "Abriendo..." : estado === "error" ? "Error" : children}
    </button>
  );
}

export function DevLinkButton({
  href,
  children,
}: {
  href: string;
  children: ReactNode;
}) {
  return (
    <a
      href={href}
      style={{
        border: `1px solid ${C.border}`,
        background: C.muted,
        color: C.text2,
        borderRadius: 7,
        padding: "7px 11px",
        fontSize: 11,
        fontWeight: 700,
        textDecoration: "none",
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </a>
  );
}

/** Copia al portapapeles un dato que la UI necesita mostrar (ej. el id de una empresa). */
export function CopiarButton({ valor, etiqueta }: { valor: string; etiqueta: string }) {
  const [copiado, setCopiado] = useState(false);
  return (
    <button
      type="button"
      title={valor}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(valor);
          setCopiado(true);
          setTimeout(() => setCopiado(false), 1500);
        } catch {
          setCopiado(false);
        }
      }}
      style={{
        border: `1px solid ${C.border}`,
        background: C.muted,
        color: copiado ? C.green : C.text2,
        borderRadius: 6,
        padding: "3px 7px",
        fontSize: 10,
        fontWeight: 800,
        fontFamily: "ui-monospace, monospace",
        cursor: "pointer",
        whiteSpace: "nowrap",
      }}
    >
      {copiado ? "copiado ✓" : etiqueta}
    </button>
  );
}

export function PlanToggle({
  cuentaId,
  cuentaNombre,
  planCodigo,
  planActivo,
  suscripcionActiva,
}: {
  cuentaId: string;
  cuentaNombre: string;
  planCodigo: string | null;
  planActivo: boolean;
  /**
   * Si hay suscripción viva, `entitlements` resuelve el plan desde ella en
   * CADA lectura: escribir acá no tiene ningún efecto, ni siquiera hasta el
   * próximo webhook. Antes el botón decía "Guardado ✓" igual.
   */
  suscripcionActiva: boolean;
}) {
  const router = useRouter();
  const [plan, setPlan] = useState(planCodigo ?? "start");
  const [activo, setActivo] = useState(planActivo);
  const [estado, setEstado] = useState<"idle" | "loading" | "error" | "ok">("idle");

  async function guardar() {
    if (estado === "loading" || suscripcionActiva) return;
    setEstado("loading");
    const res = await setCuentaPlan(cuentaId, plan, activo);
    setEstado("error" in res ? "error" : "ok");
    if (!("error" in res)) router.refresh();
  }

  if (suscripcionActiva) {
    return (
      <div style={{ fontSize: 12, color: C.amber, fontWeight: 700, lineHeight: 1.5, maxWidth: 620 }}>
        Esta cuenta tiene una suscripción activa, así que su plan manda desde ya y este control no haría nada.
        Para cambiarlo, primero hay que cancelar la suscripción en la pasarela.
      </div>
    );
  }

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
      <select
        value={plan}
        onChange={(e) => { setPlan(e.target.value); setEstado("idle"); }}
        style={{
          border: `1px solid ${C.border}`, background: C.muted, color: C.text,
          borderRadius: 7, padding: "7px 10px", fontSize: 12, fontWeight: 700,
        }}
      >
        <option value="start">Start</option>
        <option value="pro">Pro</option>
        <option value="business">Business</option>
      </select>
      <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: C.text2, fontWeight: 700 }}>
        <input type="checkbox" checked={activo} onChange={(e) => { setActivo(e.target.checked); setEstado("idle"); }} />
        funciones liberadas
      </label>
      <button
        type="button"
        onClick={guardar}
        disabled={estado === "loading"}
        style={{
          ...BASE,
          ...BTN_AMBAR,
          color: estado === "error" ? C.accent : C.text,
          cursor: estado === "loading" ? "default" : "pointer",
        }}
      >
        {estado === "loading" ? "Guardando..." : estado === "ok" ? "Guardado ✓" : estado === "error" ? "Error" : `Guardar el plan de «${cuentaNombre}»`}
      </button>
    </div>
  );
}

/**
 * Toggle GLOBAL del trial (oferta pública para todas las cuentas sin plan).
 * Pide confirmación: apagarlo no solo cierra la puerta a los que vengan, deja
 * afuera EN EL ACTO a quien esté en medio de su prueba (lib/dal.ts).
 */
export function TrialGlobalToggle({ habilitado }: { habilitado: boolean }) {
  const router = useRouter();
  const [on, setOn] = useState(habilitado);
  const [armado, setArmado] = useState(false);
  const [estado, setEstado] = useState<"idle" | "loading" | "error">("idle");

  async function confirmar() {
    if (estado === "loading") return;
    const next = !on;
    setEstado("loading");
    const res = await setTrialGlobal(next);
    if ("error" in res) { setEstado("error"); return; }
    setOn(next);
    setArmado(false);
    setEstado("idle");
    router.refresh();
  }

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
      <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: ".04em", color: on ? C.green : C.text2 }}>
        {on ? "TRIAL PÚBLICO: ON" : "TRIAL PÚBLICO: OFF"}
      </span>
      {!armado ? (
        <button
          type="button"
          onClick={() => setArmado(true)}
          style={{ ...BASE, ...BTN_AMBAR, cursor: "pointer" }}
        >
          {on ? "Apagar el trial público" : "Prender el trial público"}
        </button>
      ) : (
        <>
          <span style={{ fontSize: 11, color: C.amber, fontWeight: 700 }}>
            {on
              ? "Se apaga para todos, incluida la gente que está en medio de su prueba ahora mismo. ¿Seguro?"
              : "Se abre la prueba para toda cuenta sin plan. ¿Seguro?"}
          </span>
          <button
            type="button"
            onClick={confirmar}
            disabled={estado === "loading"}
            style={{ ...BASE, ...BTN_AMBAR, color: estado === "error" ? C.accent : C.text, cursor: "pointer" }}
          >
            {estado === "loading" ? "..." : estado === "error" ? "Error" : "Sí, cambiarlo"}
          </button>
          <button type="button" onClick={() => setArmado(false)} style={{ ...BASE, ...BTN_GRIS, cursor: "pointer" }}>
            Cancelar
          </button>
        </>
      )}
    </div>
  );
}

/**
 * Zona de peligro: purga TOTAL de la cuenta.
 *
 * El nombre a tipear NO va en el placeholder: tenerlo impreso al lado
 * convierte la confirmación en copiar y pegar, que no confirma nada. Está en
 * la barra de arriba, que es donde el operador ya lo tiene a la vista.
 */
export function PurgarCuentaButton({ cuentaId, nombre }: { cuentaId: string; nombre: string }) {
  const [confirmacion, setConfirmacion] = useState("");
  const [estado, setEstado] = useState<"idle" | "loading" | "error" | "listo">("idle");
  const [error, setError] = useState<string | null>(null);
  const [resumen, setResumen] = useState<string | null>(null);
  const armado = confirmacion.trim() === nombre.trim();

  async function purgar() {
    if (!armado || estado === "loading") return;
    setEstado("loading");
    setError(null);
    const res = await purgarCuenta(cuentaId, confirmacion);
    if ("error" in res) { setEstado("error"); setError(res.error); return; }
    // El resumen es la evidencia con la que se le responde al cliente en un
    // ARCO: antes se descartaba y se navegaba de vuelta a la lista.
    const r = res.resumen;
    setEstado("listo");
    setResumen(`Borrado: ${r.empresas} empresa(s), ${r.documentos} documento(s), ${r.auditChunks} audit_chunks, ${r.parserLogs} parser_logs.`);
  }

  if (estado === "listo") {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 8, alignItems: "flex-start" }}>
        <span style={{ fontSize: 12, color: C.green, fontWeight: 800 }}>Cuenta borrada.</span>
        <span style={{ fontSize: 11, color: C.text2, fontFamily: "ui-monospace, monospace" }}>{resumen}</span>
        <DevLinkButton href="/dev/cuentas">Volver a la lista</DevLinkButton>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <input
        value={confirmacion}
        onChange={(e) => { setConfirmacion(e.target.value); setEstado("idle"); }}
        placeholder="Escribe el nombre exacto de la cuenta para habilitar"
        style={{
          border: "1px solid rgba(232,85,62,.45)", background: C.muted, color: C.text,
          borderRadius: 7, padding: "8px 10px", fontSize: 12, width: "100%", maxWidth: 380,
        }}
      />
      <button
        type="button"
        onClick={purgar}
        disabled={!armado || estado === "loading"}
        style={{
          ...BASE,
          ...(armado ? BTN_ROJO : { border: "1px solid rgba(232,85,62,.35)", background: "rgba(232,85,62,.05)", color: C.text2 }),
          letterSpacing: ".03em",
          cursor: armado && estado !== "loading" ? "pointer" : "not-allowed",
          alignSelf: "flex-start",
        }}
      >
        {estado === "loading" ? "Borrando..." : "Borrar la cuenta (no se deshace)"}
      </button>
      {error && <span style={{ fontSize: 11, color: C.accent, maxWidth: 620, lineHeight: 1.5 }}>{error}</span>}
    </div>
  );
}

/** Toggle de trial de CORTESÍA para una cuenta puntual ("amistad"). */
export function TrialCortesiaToggle({ cuentaId, cortesia }: { cuentaId: string; cortesia: boolean }) {
  const router = useRouter();
  const [on, setOn] = useState(cortesia);
  const [estado, setEstado] = useState<"idle" | "loading" | "error">("idle");

  async function toggle() {
    if (estado === "loading") return;
    const next = !on;
    setEstado("loading");
    const res = await setCuentaTrialCortesia(cuentaId, next);
    if ("error" in res) { setEstado("error"); return; }
    setOn(next);
    setEstado("idle");
    router.refresh();
  }

  return (
    <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: C.text2, fontWeight: 700 }}>
      <input type="checkbox" checked={on} disabled={estado === "loading"} onChange={toggle} />
      Prestarle la prueba gratis a esta cuenta
      {estado === "error" ? <span style={{ color: C.accent }}>· error</span> : on ? <span style={{ color: C.green }}>· activa</span> : null}
    </label>
  );
}

/**
 * Migración de empresa hacia ESTA cuenta (LEGO: re-apunta el vínculo; los
 * datos no se mueven). Corre el checklist adversarial completo en el server.
 * La explicación de qué hace y qué exige vive en el `Explica` de la página, no
 * acá: tenerla en los dos lados producía dos redacciones del mismo aviso.
 */
export function MigrarEmpresaForm({ cuentaId }: { cuentaId: string }) {
  const router = useRouter();
  const [empresaId, setEmpresaId] = useState("");
  const [confirmacion, setConfirmacion] = useState("");
  const [estado, setEstado] = useState<"idle" | "loading" | "ok" | "error">("idle");
  const [mensaje, setMensaje] = useState<string | null>(null);

  async function migrar() {
    if (estado === "loading") return;
    setEstado("loading");
    setMensaje(null);
    const res = await migrarEmpresaACuenta(empresaId.trim(), cuentaId, confirmacion);
    if ("error" in res) { setEstado("error"); setMensaje(res.error); return; }
    setEstado("ok");
    setMensaje(res.resumen);
    router.refresh();
  }

  const inp = { border: `1px solid ${C.border}`, background: C.muted, color: C.text, borderRadius: 7, padding: "8px 10px", fontSize: 12, width: "100%", maxWidth: 380 } as const;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <input value={empresaId} onChange={(e) => { setEmpresaId(e.target.value); setEstado("idle"); }} placeholder="ID de la empresa a traer (se copia desde su cuenta actual)" style={inp} />
      <input value={confirmacion} onChange={(e) => { setConfirmacion(e.target.value); setEstado("idle"); }} placeholder="Razón social EXACTA de esa empresa (confirmación)" style={inp} />
      <button
        type="button"
        onClick={migrar}
        disabled={!empresaId.trim() || !confirmacion.trim() || estado === "loading"}
        style={{ ...BASE, ...BTN_ROJO, letterSpacing: ".03em", cursor: estado === "loading" ? "wait" : "pointer", alignSelf: "flex-start" }}
      >
        {estado === "loading" ? "Migrando..." : "Traer la empresa (no se deshace)"}
      </button>
      {mensaje && <span style={{ fontSize: 11, color: estado === "ok" ? C.green : C.accent, maxWidth: 620, lineHeight: 1.5 }}>{mensaje}</span>}
    </div>
  );
}
