import Link from "next/link";
import Image from "next/image";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { getUsuario } from "@/lib/dal";
import { getUfClp } from "@/lib/sii/uf";
import { clpConIva, estadoCuota } from "@/lib/pagos/metering";
import { Check, X, RefreshCw } from "lucide-react";
import CheckoutButton from "./CheckoutButton";

/**
 * /planes — paywall y catálogo de planes massDTE.
 * Server component: lee planes_config, la UF del día y el estado de cuota/trial.
 * Estilo alineado al landing (oscuro, cards premium, recomendado con glow).
 */

export const dynamic = "force-dynamic";

const UF_PERSONA_ADICIONAL = 0.2;
const RED = "#E8553E";

const fmtClp = (n: number) => `$${Math.round(n).toLocaleString("es-CL")}`;
const fmtNum = (n: number) => n.toLocaleString("es-CL");
function featuresDe(features: unknown): string[] {
  return Array.isArray(features) ? features.filter((f): f is string => typeof f === "string") : [];
}

function Feat({ t, ok = true, strong = false }: { t: string; ok?: boolean; strong?: boolean }) {
  return (
    <li style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13, lineHeight: 1.3, color: !ok ? "rgba(255,255,255,.3)" : strong ? "#fff" : "rgba(255,255,255,.8)", fontWeight: strong ? 600 : 400 }}>
      <span style={{ display: "grid", placeItems: "center", width: 18, height: 18, borderRadius: 999, flexShrink: 0, background: ok ? "rgba(232,85,62,.15)" : "rgba(255,255,255,.06)", color: ok ? RED : "rgba(255,255,255,.4)" }}>
        {ok ? <Check size={11} strokeWidth={3} /> : <X size={11} strokeWidth={3} />}
      </span>
      {t}
    </li>
  );
}

export default async function PlanesPage() {
  const usuario = await getUsuario();
  if (!usuario) redirect("/onboarding");

  const supabase = await createClient();
  const sb = createServiceClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

  const [planesRes, uf, cuota] = await Promise.all([
    supabase.from("planes_config").select("*").eq("activo", true),
    getUfClp(),
    estadoCuota(sb, usuario.empresa_id),
  ]);
  const planes = (planesRes.data ?? []).slice().sort((a, b) => a.uf_mensual - b.uf_mensual);
  const planActual = planes.find((p) => p.codigo === cuota.plan) ?? null;
  const trial = cuota.trial;

  let aviso: string | null = null;
  if (cuota.suscripcionEstado === "morosa") aviso = "Tu suscripción está morosa — regulariza el pago para reactivar la emisión.";
  else if (cuota.suscripcionEstado === "pausada") aviso = "Tu suscripción está pausada — reactívala para seguir emitiendo boletas.";
  else if (trial && trial.activo && trial.inicio) aviso = `Período de prueba activo — ${trial.diasRestantes} ${trial.diasRestantes === 1 ? "día restante" : "días restantes"} · ${trial.boletasUsadas} de ${trial.boletasMax} boletas usadas`;
  else if (trial && trial.activo && !trial.inicio) aviso = `Prueba gratis: tu primera emisión masiva activa ${trial.diasRestantes} días o ${trial.boletasMax} boletas, lo que ocurra primero.`;
  else if (trial && !trial.activo) aviso = "Tu período de prueba terminó — contrata un plan para seguir emitiendo boletas.";

  return (
    <div className="dark" style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: "48px 20px", background: "#0a0a0a", color: "#fff", fontFamily: "'DM Sans','Inter',sans-serif" }}>
      <style>{`.massdte-logo{filter:invert(1)}`}</style>
      <div style={{ width: "100%", maxWidth: 1120 }}>
        <div style={{ textAlign: "center", marginBottom: 28 }}>
          <Image src="/massdte-logo.png" alt="massDTE" width={150} height={22} priority className="massdte-logo" style={{ margin: "0 auto 14px", display: "block" }} />
          <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: ".14em", textTransform: "uppercase", color: RED }}>Inversión en gestión</div>
          <h1 style={{ fontSize: 34, fontWeight: 800, letterSpacing: "-0.03em", marginTop: 6 }}>Elige tu plan</h1>
          <p style={{ fontSize: 14, color: "rgba(255,255,255,.55)", marginTop: 8, maxWidth: 560, margin: "8px auto 0" }}>
            Tarifa plana en UF — la cuota cuenta solo lo masivo, las boletas únicas son ilimitadas. Cobrado en pesos al valor del día (UF hoy: {fmtClp(uf)}).
          </p>
        </div>

        {aviso && (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, border: "1px solid rgba(232,85,62,.25)", background: "rgba(232,85,62,.07)", borderRadius: 12, padding: "10px 16px", marginBottom: 22, fontSize: 12.5, color: "rgba(255,255,255,.75)" }}>
            <span style={{ width: 6, height: 6, borderRadius: 999, background: RED, flexShrink: 0 }} />
            {aviso}
          </div>
        )}

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 18, alignItems: "stretch" }}>
          {planes.map((plan) => {
            const esActual = cuota.suscripcionActiva && cuota.plan === plan.codigo;
            const recommended = plan.codigo === "pro";
            const neto = Math.round(plan.uf_mensual * uf);
            const iva = Math.round(neto * 0.19);
            const total = neto + iva;
            const horas = Math.round((plan.cuota_masivas * 2.5) / 60);
            const porBoleta = plan.cuota_masivas > 0 ? Math.round(neto / plan.cuota_masivas) : 0;
            const porDia = Math.round(plan.cuota_masivas / 22);

            return (
              <div
                key={plan.codigo}
                style={{
                  position: "relative",
                  display: "flex",
                  flexDirection: "column",
                  borderRadius: 18,
                  padding: 24,
                  border: recommended ? "1px solid rgba(232,85,62,.6)" : esActual ? "1px solid rgba(232,85,62,.4)" : "1px solid rgba(255,255,255,.1)",
                  background: recommended ? "rgba(232,85,62,.06)" : "rgba(255,255,255,.02)",
                  boxShadow: recommended ? "0 0 60px -15px rgba(232,85,62,.45)" : "none",
                }}
              >
                {esActual ? (
                  <span style={{ position: "absolute", top: -12, left: "50%", transform: "translateX(-50%)", borderRadius: 999, background: "#22c55e", padding: "4px 12px", fontSize: 11, fontWeight: 700, color: "#fff" }}>Tu plan</span>
                ) : recommended ? (
                  <span style={{ position: "absolute", top: -12, left: "50%", transform: "translateX(-50%)", borderRadius: 999, background: RED, padding: "4px 12px", fontSize: 11, fontWeight: 700, color: "#fff" }}>Recomendado</span>
                ) : null}

                <span style={{ fontSize: 12, fontWeight: 600, textTransform: "uppercase", letterSpacing: ".06em", color: "rgba(255,255,255,.5)" }}>{plan.nombre}</span>
                <div style={{ marginTop: 8, fontSize: 40, fontWeight: 700, lineHeight: 1, letterSpacing: "-0.02em" }}>
                  {fmtNum(plan.uf_mensual)} <span style={{ fontSize: 18, fontWeight: 600, color: "rgba(255,255,255,.55)" }}>UF</span>
                </div>
                <div style={{ marginTop: 10, fontSize: 14, color: "rgba(255,255,255,.7)" }}>~{fmtClp(neto)} neto / mes</div>
                <div style={{ fontSize: 13, color: "rgba(255,255,255,.4)" }}>+ IVA 19% → {fmtClp(iva)}</div>
                <div style={{ marginTop: 12, borderRadius: 10, border: "1px solid rgba(255,255,255,.1)", background: "rgba(0,0,0,.3)", padding: "8px 12px", fontSize: 13, color: "rgba(255,255,255,.7)" }}>
                  Total con IVA: <span style={{ fontWeight: 700, color: "#fff" }}>~{fmtClp(total)} / mes</span>
                </div>

                <div style={{ marginTop: 18, paddingTop: 16, borderTop: "1px solid rgba(255,255,255,.1)" }}>
                  <div style={{ fontSize: 22, fontWeight: 700 }}>{fmtNum(plan.cuota_masivas)} boletas masivas</div>
                  <div style={{ marginTop: 5, fontSize: 14, fontWeight: 600, color: RED }}>≈ {horas} horas de digitación ahorradas al mes</div>
                  <div style={{ marginTop: 2, fontSize: 13, color: "rgba(255,255,255,.45)" }}>~{fmtNum(porDia)} por día hábil · {fmtClp(porBoleta)} por boleta</div>
                </div>

                <ul style={{ marginTop: 18, display: "flex", flexDirection: "column", gap: 9, flex: 1, listStyle: "none", padding: 0 }}>
                  <Feat t="Boletas manuales ilimitadas" />
                  <Feat t={`${plan.empresas_incluidas} ${plan.empresas_incluidas === 1 ? "empresa incluida" : "empresas incluidas"}`} />
                  <Feat t={`${plan.personas_incluidas} ${plan.personas_incluidas === 1 ? "persona incluida" : "personas incluidas"}`} />
                  {plan.telegram_comprobantes > 0 ? (
                    <Feat t={`${fmtNum(plan.telegram_comprobantes)} comprobantes por Telegram / mes`} />
                  ) : (
                    <Feat t="Comprobantes por Telegram" ok={false} />
                  )}
                  {plan.equipo && <Feat t="Equipo habilitado" />}
                  {plan.multiempresa && <Feat t="Multiempresa con add-ons" />}
                  <Feat t={`Extra: +${fmtNum(plan.refill_boletas)} boletas por ${fmtClp(plan.refill_clp_neto * 1.19)}`} />
                  {featuresDe(plan.features)
                    .filter((f) => !/boleta|empresa|persona|manual|telegram|refill|equipo|\bextra\b/i.test(f))
                    .map((f) => (
                      <Feat key={f} t={f} />
                    ))}
                </ul>

                <div style={{ marginTop: 18 }}>
                  <CheckoutButton tipo="plan" plan={plan.codigo} actual={esActual} recommended={recommended} />
                </div>
              </div>
            );
          })}
        </div>

        {cuota.suscripcionActiva && planActual && (
          <div style={{ marginTop: 18, display: "grid", gap: 12 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, flexWrap: "wrap", borderRadius: 16, border: "1px solid rgba(255,255,255,.1)", background: "rgba(255,255,255,.02)", padding: "16px 20px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <span style={{ display: "grid", placeItems: "center", width: 40, height: 40, borderRadius: 12, background: "rgba(232,85,62,.12)", color: RED, flexShrink: 0 }}><RefreshCw size={18} /></span>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 700 }}>Extra — +{fmtNum(planActual.refill_boletas)} boletas este mes</div>
                  <div style={{ fontSize: 12, color: "rgba(255,255,255,.5)", marginTop: 2 }}>
                    Usaste {fmtNum(cuota.uso)} de {fmtNum(cuota.cuota + cuota.refills)} · quedan {fmtNum(cuota.disponible)} · {fmtClp(planActual.refill_clp_neto * 1.19)} con IVA, pago único
                  </div>
                </div>
              </div>
              <div style={{ minWidth: 190 }}><CheckoutButton tipo="refill" /></div>
            </div>

            {planActual.equipo && (
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, flexWrap: "wrap", borderRadius: 16, border: "1px solid rgba(255,255,255,.1)", background: "rgba(255,255,255,.02)", padding: "16px 20px" }}>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 700 }}>Extra — 1 persona adicional</div>
                  <div style={{ fontSize: 12, color: "rgba(255,255,255,.5)", marginTop: 2 }}>Solo la cuenta pagadora puede comprarlo · {fmtClp(clpConIva(UF_PERSONA_ADICIONAL, uf))} con IVA</div>
                </div>
                <div style={{ minWidth: 190 }}><CheckoutButton tipo="persona_adicional" label="Comprar persona" /></div>
              </div>
            )}
          </div>
        )}

        <p style={{ textAlign: "center", fontSize: 12, color: "rgba(255,255,255,.4)", marginTop: 24 }}>
          Pagos procesados por Mercado Pago · cancela cuando quieras.
          {(cuota.suscripcionActiva || usuario.empresas?.plan_activo) && (
            <>
              {" · "}
              <Link href="/massdte" style={{ color: "rgba(255,255,255,.6)", textDecoration: "underline" }}>Volver al escritorio</Link>
            </>
          )}
        </p>
      </div>
    </div>
  );
}
