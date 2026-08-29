"use client";

/**
 * El botón de cancelar. Antes la página prometía «cancela cuando quieras» y no
 * existía: había que escribirle a soporte.
 *
 * Dos cosas que este componente hace a propósito:
 *
 * - **Dice hasta cuándo conserva lo que pagó.** El miedo real al cancelar no es
 *   perder el plan, es perderlo AHORA habiendo pagado el mes. Si eso no está en
 *   pantalla, la gente no aprieta y escribe a soporte igual.
 * - **Se puede deshacer.** Mientras no llegue la fecha, volver atrás es un
 *   clic. Cancelar por error no puede costar volver a contratar.
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { cancelarPlan, deshacerCancelacion } from "./cancelar";

const RED = "#E8553E";

function fmtFecha(iso: string | null) {
  if (!iso) return "el final del período";
  return new Intl.DateTimeFormat("es-CL", { dateStyle: "long", timeZone: "America/Santiago" }).format(new Date(iso));
}

export default function CancelarPlan({
  cancelada,
  hasta,
}: {
  cancelada: boolean;
  hasta: string | null;
}) {
  const router = useRouter();
  const [armado, setArmado] = useState(false);
  const [estado, setEstado] = useState<"idle" | "cargando" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  async function ejecutar(cancelar: boolean) {
    setEstado("cargando");
    setError(null);
    const res = cancelar ? await cancelarPlan() : await deshacerCancelacion();
    if ("error" in res) {
      setEstado("error");
      setError(res.error);
      return;
    }
    setEstado("idle");
    setArmado(false);
    router.refresh();
  }

  const enlace = { background: "none", border: "none", padding: 0, cursor: "pointer", fontSize: 12, textDecoration: "underline" } as const;

  if (cancelada) {
    return (
      <div style={{ textAlign: "center", marginTop: 14, fontSize: 12.5, color: "rgba(255,255,255,.65)", lineHeight: 1.6 }}>
        Tu plan queda cancelado y sigues con todo hasta el <strong style={{ color: "#fff" }}>{fmtFecha(hasta)}</strong>.
        No se te va a cobrar de nuevo.{" "}
        <button type="button" onClick={() => ejecutar(false)} disabled={estado === "cargando"} style={{ ...enlace, color: RED }}>
          {estado === "cargando" ? "..." : "Deshacer"}
        </button>
        {error && <div style={{ marginTop: 6, color: RED }}>{error}</div>}
      </div>
    );
  }

  return (
    <div style={{ textAlign: "center", marginTop: 14, fontSize: 12, color: "rgba(255,255,255,.4)" }}>
      {!armado ? (
        <button type="button" onClick={() => setArmado(true)} style={{ ...enlace, color: "rgba(255,255,255,.45)" }}>
          Cancelar mi plan
        </button>
      ) : (
        <div style={{ lineHeight: 1.6 }}>
          <div style={{ color: "rgba(255,255,255,.7)" }}>
            Sigues con todo hasta el <strong style={{ color: "#fff" }}>{fmtFecha(hasta)}</strong>, que es lo que ya pagaste.
            Después no se te cobra más. Puedes volver atrás cuando quieras.
          </div>
          <div style={{ marginTop: 8, display: "flex", gap: 14, justifyContent: "center" }}>
            <button type="button" onClick={() => ejecutar(true)} disabled={estado === "cargando"} style={{ ...enlace, color: RED }}>
              {estado === "cargando" ? "Cancelando..." : "Sí, cancelar"}
            </button>
            <button type="button" onClick={() => setArmado(false)} style={{ ...enlace, color: "rgba(255,255,255,.45)" }}>
              Mejor no
            </button>
          </div>
          {error && <div style={{ marginTop: 6, color: RED }}>{error}</div>}
        </div>
      )}
    </div>
  );
}
