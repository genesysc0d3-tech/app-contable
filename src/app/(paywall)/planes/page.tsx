import Link from "next/link";
import Image from "next/image";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { getUsuario } from "@/lib/dal";
import { getUfClp } from "@/lib/sii/uf";
import { clpConIva, estadoCuota } from "@/lib/pagos/metering";
import CheckoutButton from "./CheckoutButton";

/**
 * /planes — paywall y catálogo de planes massDTE.
 * Server component: lee planes_config (policy de lectura authenticated),
 * la UF del día y el estado de cuota/trial de la empresa. Los precios se
 * muestran en UF + el equivalente CLP con IVA calculado vivo.
 */

export const dynamic = "force-dynamic";

const UF_PERSONA_ADICIONAL = 0.2;

function fmtClp(n: number): string {
  return `$${Math.round(n).toLocaleString("es-CL")}`;
}

function featuresDe(features: unknown): string[] {
  return Array.isArray(features) ? features.filter((f): f is string => typeof f === "string") : [];
}

function Linea({ texto, destacada = false }: { texto: string; destacada?: boolean }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 7,
        fontSize: 11,
        color: destacada ? "var(--foreground)" : "var(--muted)",
        fontWeight: destacada ? 650 : 400,
      }}
    >
      <span
        style={{
          width: 4,
          height: 4,
          borderRadius: 999,
          background: destacada ? "#E8553E" : "var(--muted-light)",
          flexShrink: 0,
        }}
      />
      {texto}
    </div>
  );
}

function Aviso({ texto }: { texto: string }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
        border: "1px solid var(--border)",
        background: "var(--surface)",
        borderRadius: 10,
        padding: "8px 14px",
        marginBottom: 18,
        fontSize: 11,
        color: "var(--muted)",
      }}
    >
      <span style={{ width: 6, height: 6, borderRadius: 999, background: "#E8553E", flexShrink: 0 }} />
      {texto}
    </div>
  );
}

export default async function PlanesPage() {
  const usuario = await getUsuario();
  if (!usuario) redirect("/onboarding");

  const supabase = await createClient();
  const sb = createServiceClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  const [planesRes, uf, cuota] = await Promise.all([
    supabase.from("planes_config").select("*").eq("activo", true),
    getUfClp(),
    estadoCuota(sb, usuario.empresa_id),
  ]);
  const planes = (planesRes.data ?? []).slice().sort((a, b) => a.uf_mensual - b.uf_mensual);

  const planActual = planes.find((p) => p.codigo === cuota.plan) ?? null;
  const trial = cuota.trial;

  // Aviso de contexto: trial / suscripción no activa.
  let aviso: string | null = null;
  if (cuota.suscripcionEstado === "morosa") {
    aviso = "Tu suscripción está morosa — regulariza el pago para reactivar la emisión.";
  } else if (cuota.suscripcionEstado === "pausada") {
    aviso = "Tu suscripción está pausada — reactívala para seguir emitiendo boletas.";
  } else if (trial && trial.activo && trial.inicio) {
    aviso = `Período de prueba activo — ${trial.diasRestantes} ${trial.diasRestantes === 1 ? "día restante" : "días restantes"} · ${trial.boletasUsadas} de ${trial.boletasMax} boletas usadas`;
  } else if (trial && trial.activo && !trial.inicio) {
    aviso = `Prueba gratis: tu primera emisión masiva activa ${trial.diasRestantes} días o ${trial.boletasMax} boletas, lo que ocurra primero.`;
  } else if (trial && !trial.activo) {
    aviso = "Tu período de prueba terminó — contrata un plan para seguir emitiendo boletas.";
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "32px 20px",
        background: "var(--background)",
        color: "var(--foreground)",
      }}
    >
      <div style={{ width: "100%", maxWidth: 900 }}>
        <div style={{ textAlign: "center", marginBottom: 20 }}>
          <style>{`.massdte-logo{filter:none}.dark .massdte-logo{filter:invert(1)}`}</style>
          <Image
            src="/massdte-logo.png"
            alt="massDTE"
            width={160}
            height={24}
            priority
            className="massdte-logo"
            style={{ margin: "0 auto 6px", display: "block" }}
          />
          <h1 style={{ fontSize: 22, fontWeight: 800, letterSpacing: "-0.02em", marginTop: 4 }}>Planes</h1>
          <p style={{ fontSize: 12, color: "var(--muted)", marginTop: 4 }}>
            Boletas desde tus cartolas, boletas manuales cuando las necesites y comprobantes por Telegram según tu plan. Precios en UF + IVA, cobrados en pesos al valor del día
            (UF hoy: {fmtClp(uf)}).
          </p>
        </div>

        {aviso && <Aviso texto={aviso} />}

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 14 }}>
          {planes.map((plan) => {
            const esActual = cuota.suscripcionActiva && cuota.plan === plan.codigo;
            return (
              <div
                key={plan.codigo}
                style={{
                  border: esActual ? "1px solid rgba(232,85,62,.45)" : "1px solid var(--border)",
                  background: "var(--surface)",
                  borderRadius: 14,
                  padding: "20px 18px",
                  display: "flex",
                  flexDirection: "column",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <span
                    style={{
                      fontSize: 10,
                      fontWeight: 700,
                      letterSpacing: ".08em",
                      textTransform: "uppercase",
                      color: "var(--muted)",
                    }}
                  >
                    {plan.nombre}
                  </span>
                  {esActual && (
                    <span
                      style={{
                        fontSize: 9,
                        fontWeight: 700,
                        color: "#E8553E",
                        border: "1px solid rgba(232,85,62,.35)",
                        borderRadius: 999,
                        padding: "3px 8px",
                        textTransform: "uppercase",
                        letterSpacing: ".05em",
                      }}
                    >
                      Tu plan
                    </span>
                  )}
                </div>

                <div style={{ marginTop: 12, display: "flex", alignItems: "baseline", gap: 6 }}>
                  <span style={{ fontSize: 27, fontWeight: 800, letterSpacing: "-0.03em" }}>
                    UF {plan.uf_mensual}
                  </span>
                  <span style={{ fontSize: 11, color: "var(--muted-light)" }}>/mes + IVA</span>
                </div>
                <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>
                  ≈ {fmtClp(clpConIva(plan.uf_mensual, uf))} /mes con IVA
                </div>

                <div
                  style={{
                    marginTop: 14,
                    paddingTop: 12,
                    borderTop: "1px solid var(--border)",
                    display: "flex",
                    flexDirection: "column",
                    gap: 6,
                    flex: 1,
                  }}
                >
                  <Linea destacada texto={`${plan.cuota_masivas.toLocaleString("es-CL")} boletas desde cartolas al mes`} />
                  <Linea texto="Boletas manuales ilimitadas" />
                  <Linea texto={`${plan.empresas_incluidas} empresa incluida`} />
                  <Linea texto={`${plan.personas_incluidas} persona incluida`} />
                  {plan.telegram_comprobantes > 0 ? (
                    <Linea texto={`${plan.telegram_comprobantes.toLocaleString("es-CL")} comprobantes por Telegram al mes`} />
                  ) : (
                    <Linea texto="Sin comprobantes por Telegram" />
                  )}
                  {plan.equipo && <Linea texto="Equipo habilitado" />}
                  {plan.multiempresa && <Linea texto="Multiempresa con add-ons" />}
                  <Linea texto={`Extra: +${plan.refill_boletas.toLocaleString("es-CL")} boletas desde cartolas por ${fmtClp(plan.refill_clp_neto * 1.19)}`} />
                  {featuresDe(plan.features).map((f) => (
                    <Linea key={f} texto={f} />
                  ))}
                </div>

                <div style={{ marginTop: 16 }}>
                  <CheckoutButton tipo="plan" plan={plan.codigo} actual={esActual} />
                </div>
              </div>
            );
          })}
        </div>

        {cuota.suscripcionActiva && planActual && (
          <div style={{ marginTop: 16, display: "grid", gap: 10 }}>
            <div
              style={{
                border: "1px solid var(--border)",
                background: "var(--surface)",
                borderRadius: 12,
                padding: "14px 18px",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 14,
                flexWrap: "wrap",
              }}
            >
              <div>
                <div style={{ fontSize: 11, fontWeight: 700 }}>
                  Extra — +{planActual.refill_boletas.toLocaleString("es-CL")} boletas desde cartolas este mes
                </div>
                <div style={{ fontSize: 10, color: "var(--muted)", marginTop: 2 }}>
                  Usaste {cuota.uso.toLocaleString("es-CL")} de {(cuota.cuota + cuota.refills).toLocaleString("es-CL")}{" "}
                  este mes · quedan {cuota.disponible.toLocaleString("es-CL")} ·{" "}
                  {fmtClp(planActual.refill_clp_neto * 1.19)} con IVA, pago único
                </div>
              </div>
              <div style={{ minWidth: 180 }}>
                <CheckoutButton tipo="refill" />
              </div>
            </div>

            {planActual.equipo && (
              <div
                style={{
                  border: "1px solid var(--border)",
                  background: "var(--surface)",
                  borderRadius: 12,
                  padding: "14px 18px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 14,
                  flexWrap: "wrap",
                }}
              >
                <div>
                  <div style={{ fontSize: 11, fontWeight: 700 }}>
                    Extra — 1 persona adicional
                  </div>
                  <div style={{ fontSize: 10, color: "var(--muted)", marginTop: 2 }}>
                    Solo la cuenta pagadora puede comprarlo · {fmtClp(clpConIva(UF_PERSONA_ADICIONAL, uf))} con IVA
                  </div>
                </div>
                <div style={{ minWidth: 180 }}>
                  <CheckoutButton tipo="persona_adicional" label="Comprar persona" />
                </div>
              </div>
            )}
          </div>
        )}

        <p style={{ textAlign: "center", fontSize: 10, color: "var(--muted-light)", marginTop: 18 }}>
          Pagos procesados por Mercado Pago · cancela cuando quieras.
          {(cuota.suscripcionActiva || usuario.empresas?.plan_activo) && (
            <>
              {" · "}
              <Link href="/massdte" style={{ color: "var(--muted)", textDecoration: "underline" }}>
                Volver al escritorio
              </Link>
            </>
          )}
        </p>
      </div>
    </div>
  );
}
