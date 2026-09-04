import Link from "next/link";
import Image from "next/image";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { getUsuario } from "@/lib/dal";
import { getUfClp } from "@/lib/sii/uf";
import { clpConIva, estadoCuota } from "@/lib/pagos/metering";
import { cuentaIdDeEmpresa } from "@/lib/entitlements";
import { Check, X, RefreshCw } from "lucide-react";
import CheckoutButton from "./CheckoutButton";
import CancelarPlan from "./CancelarPlan";
import { flowConfigurado } from "@/lib/pagos/flow";

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

// Pago rechazado PERSISTENTE (Matías, 2026-09-01): el aviso de la vuelta de la
// pasarela vive en la URL y se pierde al navegar; si el último pago de la
// cuenta (72 h) quedó rechazado, /planes lo dice aunque entres días después.
// Helper fuera del componente: el lint prohíbe Date.now() durante el render.
async function ultimoPagoRechazado(sb: ReturnType<typeof createServiceClient<Database>>, cuentaId: string): Promise<boolean> {
  const { data } = await sb
    .from("pagos")
    .select("estado, created_at")
    .eq("cuenta_id", cuentaId)
    .gte("created_at", new Date(Date.now() - 72 * 3600_000).toISOString())
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data?.estado === "rechazado";
}

export default async function PlanesPage({ searchParams }: { searchParams: Promise<{ plan?: string; tarjeta?: string; cobro?: string }> }) {
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

  // Plan que el usuario eligió en el landing: llega por ?plan= (link directo) o por
  // la cookie massdte_plan que dejó el registro (el onboarding ya no pasa por acá:
  // va directo al escritorio, así que la cookie se lee recién cuando viene a pagar).
  const sp = await searchParams;
  const porFlow = flowConfigurado();
  const jar = await cookies();
  const planCookie = (jar.get("massdte_plan")?.value ?? "").toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 24) || null;
  const planPedido = typeof sp.plan === "string" ? sp.plan.toLowerCase() : planCookie;
  const recomendadoCodigo = planPedido && planes.some((p) => p.codigo === planPedido) ? planPedido : "pro";

  let aviso: string | null = null;
  // La vuelta de la pasarela manda sobre el resto del aviso: es lo que el
  // cliente acaba de hacer y necesita saber cómo terminó. Sin esto vuelve a una
  // página igual a la que dejó y no sabe si funcionó.
  if (sp.cobro === "rechazado") {
    aviso = "Tu tarjeta quedó registrada, pero el banco rechazó el primer cobro. Si es tarjeta de débito, revisa que tengas saldo y vuelve a intentar.";
  } else if (sp.tarjeta === "rechazada" || sp.tarjeta === "error") {
    aviso = "No se completó el registro de la tarjeta. Puedes intentarlo de nuevo — no se te cobró nada.";
  } else if (sp.tarjeta === "ok") {
    aviso = "Tu tarjeta quedó registrada. Elige un plan para activarlo.";
  } else if (cuota.suscripcionEstado === "morosa") aviso = "Tu suscripción está morosa — regulariza el pago para reactivar la emisión.";
  else if (cuota.suscripcionEstado === "pausada") aviso = "Tu suscripción está pausada — reactívala para seguir emitiendo.";
  // El reloj corre desde que se abrió la cuenta (2026-09-04): ya no existe el
  // estado "prueba disponible pero sin empezar", así que tampoco su aviso.
  else if (trial && trial.activo) aviso = `Período de prueba activo — ${trial.diasRestantes} ${trial.diasRestantes === 1 ? "día restante" : "días restantes"} · ${trial.boletasUsadas} de ${trial.boletasMax} boletas usadas`;
  else if (trial && !trial.activo) aviso = "Tu período de prueba terminó — contrata un plan para seguir emitiendo.";

  // El trial (disponible o corriendo) también da acceso al escritorio: quien está
  // probando no debe quedar atrapado en el paywall.
  // El botón de cancelar necesita dos datos que `estadoCuota` no expone y que
  // no vale la pena meterle, porque la usa media app: hasta cuándo va el
  // período pagado, y si ya pidió cancelar.
  // Ambas consultas van con service client ⇒ SIEMPRE acotadas a la cuenta del
  // usuario (sin el .eq de cuenta, la primera devolvía la suscripción activa
  // más nueva de CUALQUIER cuenta — bug cazado 2026-09-01).
  const cuentaId = await cuentaIdDeEmpresa(sb, usuario.empresa_id);
  const { data: suscripcionViva } = cuentaId
    ? await sb
        .from("suscripciones")
        .select("periodo_hasta, cancela_al_terminar")
        .eq("cuenta_id", cuentaId)
        .eq("estado", "activa")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle()
    : { data: null };

  if (!aviso && cuentaId && !cuota.suscripcionActiva && (await ultimoPagoRechazado(sb, cuentaId))) {
    aviso = "Tu último pago fue rechazado por el banco — no se te cobró nada. Revisa cupo o compras por internet, o intenta con otra tarjeta.";
  }

  const tienePlan = cuota.suscripcionActiva || Boolean(usuario.empresas?.plan_activo);
  const puedeVolver = tienePlan || Boolean(trial?.activo);

  return (
    <div className="dark" style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: "48px 20px", background: "#0a0a0a", color: "#fff", fontFamily: "var(--font-geist-sans), sans-serif" }}>
      <style>{`.massdte-logo{filter:invert(1)}`}</style>
      <div style={{ width: "100%", maxWidth: 1120 }}>
        <div style={{ textAlign: "center", marginBottom: 28 }}>
          <Image src="/massdte-logo.png" alt="massDTE" width={150} height={22} priority className="massdte-logo" style={{ margin: "0 auto 14px", display: "block" }} />
          <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: ".14em", textTransform: "uppercase", color: RED }}>Inversión en gestión</div>
          <h1 style={{ fontSize: 34, fontWeight: 800, letterSpacing: "-0.03em", marginTop: 6 }}>Elige tu plan</h1>
          <p style={{ fontSize: 14, color: "rgba(255,255,255,.55)", marginTop: 8, maxWidth: 560, margin: "8px auto 0" }}>
            El número del plan son las boletas y facturas que salen de tus cartolas. Las que emites de a una no descuentan: son ilimitadas. Cobrado en pesos al valor del día (UF hoy: {fmtClp(uf)}).
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
            const recommended = plan.codigo === recomendadoCodigo;
            const neto = Math.round(plan.uf_mensual * uf);
            const iva = Math.round(neto * 0.19);
            const total = neto + iva;
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
                  <div style={{ fontSize: 22, fontWeight: 700 }}>{fmtNum(plan.cuota_masivas)} boletas o facturas</div>
                  <div style={{ marginTop: 3, fontSize: 12.5, color: "rgba(255,255,255,.55)" }}>salidas de tus cartolas, al mes</div>
                  {/*
                    Acá decía "≈ N horas ahorradas al mes", con N = la cuota
                    ENTERA × 2,5 min. Solo es cierto si gastas el cupo completo,
                    o sea para casi nadie. El landing ya lo había sacado por eso
                    mismo; en la app quedó vivo. Lo que sí es verdad en todos los
                    casos es el rendimiento por documento.
                  */}
                  <div style={{ marginTop: 5, fontSize: 14, fontWeight: 600, color: RED }}>2,5 minutos menos de tecleo por cada una</div>
                  <div style={{ marginTop: 2, fontSize: 13, color: "rgba(255,255,255,.45)" }}>~{fmtNum(porDia)} por día hábil si usas el cupo completo</div>
                </div>

                <ul style={{ marginTop: 18, display: "flex", flexDirection: "column", gap: 9, flex: 1, listStyle: "none", padding: 0 }}>
                  <Feat t="Emitir de a una: ilimitado, no descuenta" />
                  <Feat t={`${plan.empresas_incluidas} ${plan.empresas_incluidas === 1 ? "empresa incluida" : "empresas incluidas"}`} />
                  <Feat t={`${plan.personas_incluidas} ${plan.personas_incluidas === 1 ? "persona incluida" : "personas incluidas"}`} />
                  {plan.telegram_comprobantes > 0 ? (
                    <Feat t={`${fmtNum(plan.telegram_comprobantes)} comprobantes por Telegram / mes`} />
                  ) : (
                    <Feat t="Comprobantes por Telegram" ok={false} />
                  )}
                  {plan.equipo && <Feat t="Equipo habilitado" />}
                  {plan.multiempresa && <Feat t="Multiempresa con add-ons" />}
                  {plan.multiempresa && (
                    <li style={{ marginTop: -3, marginLeft: 26, fontSize: 12, lineHeight: 1.45, color: "rgba(255,255,255,.45)" }}>
                      Para emitir por cada empresa, tu RUT tiene que estar autorizado en el SII en esa empresa. Ese permiso se da en el sitio del SII.
                    </li>
                  )}
                  <Feat t={`Extra: +${fmtNum(plan.refill_boletas)} por ${fmtClp(plan.refill_clp_neto * 1.19)}`} />
                  {featuresDe(plan.features)
                    .filter((f) => !/boleta|empresa|persona|manual|telegram|refill|equipo|\bextra\b/i.test(f))
                    .map((f) => (
                      <Feat key={f} t={f} />
                    ))}
                </ul>

                <div style={{ marginTop: 18 }}>
                  <CheckoutButton tipo="plan" plan={plan.codigo} actual={esActual} recommended={recommended} inscribeTarjeta={porFlow} />
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

        {!tienePlan && trial?.activo && (
          <div style={{ textAlign: "center", marginTop: 26 }}>
            <Link
              href="/massdte"
              style={{ display: "inline-block", borderRadius: 11, border: "1px solid rgba(232,85,62,.45)", background: "rgba(232,85,62,.10)", color: RED, padding: "11px 22px", fontSize: 13, fontWeight: 700 }}
            >
              Empezar gratis →
            </Link>
          </div>
        )}

        <p style={{ textAlign: "center", fontSize: 12, color: "rgba(255,255,255,.4)", marginTop: 24 }}>
          {/*
            Decía "Pagos procesados por Mercado Pago · cancela cuando quieras".
            Dos cosas falsas en una línea: la pasarela era Flow desde el
            2026-08-25, y no existía ningún botón para cancelar — la página
            afirmaba que ya estaba. Ahora el botón existe, así que la frase
            volvió a ser verdad.
          */}
          Pagos procesados por {porFlow ? "Flow" : "Mercado Pago"} · cancelas desde acá cuando quieras.
          {puedeVolver && (
            <>
              {" · "}
              <Link href="/massdte" style={{ color: "rgba(255,255,255,.6)", textDecoration: "underline" }}>Volver al escritorio</Link>
            </>
          )}
        </p>

        {cuota.suscripcionActiva && (
          <CancelarPlan
            cancelada={suscripcionViva?.cancela_al_terminar === true}
            hasta={suscripcionViva?.periodo_hasta ?? null}
          />
        )}
      </div>
    </div>
  );
}
