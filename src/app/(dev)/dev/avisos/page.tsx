/**
 * /dev → Avisos: lo que las clientas ven dentro de la app (toast, tarjeta o popup
 * urgente). Crear, editar, desactivar, con vista previa en vivo y cuántas
 * personas ya cerraron cada aviso. Mismo guard que el resto del panel.
 */
import { redirect } from "next/navigation";
import { getDevOperatorContext } from "@/lib/dev/support-mode";
import { versionPublicadaDelServidor } from "@/lib/actualizacion/version";
import { fechaDeCommit } from "@/lib/avisos/version";
import { C, DevNav, Section } from "../ui";
import { AvisosEditor, type AvisoFila } from "./AvisosEditor";

/** Fuera del componente: la hora del server para los valores por defecto del formulario. */
function ahoraIso(): string {
  return new Date().toISOString();
}

const COLUMNAS = "id, tipo, titulo, cuerpo, formato, desde, hasta, empresa_ids, mesa, version_min, activo, creado_por, created_at, avisos_vistos(count)";

export default async function DevAvisosPage() {
  const operador = await getDevOperatorContext();
  if (!operador.ok) {
    if (operador.error === "NO_AUTH") redirect("/auth/login?next=/dev/avisos");
    redirect("/dev/diagnostico");
  }

  // Fail-safe: sin la migración aplicada la pantalla lo dice y no se cae.
  let avisos: AvisoFila[] = [];
  let errorLectura: string | null = null;
  try {
    const { data, error } = await operador.sb
      .from("avisos_app")
      .select(COLUMNAS)
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) errorLectura = error.code === "PGRST205" || error.code === "42P01" ? "La tabla avisos_app aún no existe (migración 20261001120000 sin aplicar)." : "No se pudo leer avisos_app (detalle en los logs del servidor).";
    else {
      avisos = ((data ?? []) as unknown as (Omit<AvisoFila, "vistos"> & { avisos_vistos?: { count?: number }[] })[]).map(
        ({ avisos_vistos: conteo, ...fila }) => ({ ...fila, vistos: conteo?.[0]?.count ?? 0 }),
      );
    }
  } catch {
    errorLectura = "No se pudo leer avisos_app.";
  }

  return (
    <main style={{ minHeight: "100dvh", background: C.bg, color: C.text, fontFamily: "var(--font-geist-sans), sans-serif", padding: 18 }}>
      <div style={{ maxWidth: 1080, margin: "0 auto", display: "flex", flexDirection: "column", gap: 14 }}>
        <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <div>
            <div style={{ fontSize: 11, color: C.text3, textTransform: "uppercase", letterSpacing: ".08em", fontWeight: 800 }}>Panel operador</div>
            <h1 style={{ margin: "3px 0 0", fontSize: 22 }}>Avisos y novedades</h1>
          </div>
          <DevNav activa="avisos" />
        </header>

        <Section
          title="Avisos"
          tone={errorLectura ? "warning" : "muted"}
          hint="Llegan en las cargas que la app ya hace (sin sondeo): un aviso nuevo aparece en ≤ 1 min en la próxima carga de la mesa. Cada persona lo ve UNA vez. Nunca sale encima de una emisión, una subida o un popup con cambios sin guardar: espera. Popup = solo urgentes."
        >
          {errorLectura ? <div style={{ color: C.amber, fontSize: 12, fontWeight: 800, marginBottom: 10 }}>{errorLectura}</div> : null}
          <AvisosEditor
            avisos={avisos}
            ahoraIso={ahoraIso()}
            versionActual={versionPublicadaDelServidor() ?? "—"}
            commitActual={fechaDeCommit()}
            deshabilitado={Boolean(errorLectura)}
          />
        </Section>
      </div>
    </main>
  );
}

export const dynamic = "force-dynamic";
