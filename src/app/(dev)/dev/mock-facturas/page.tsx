import { notFound } from "next/navigation";
import { getDevOperatorContext } from "@/lib/dev/support-mode";
import MockFacturasClient from "./MockFacturasClient";

export const dynamic = "force-dynamic";

/**
 * MOCK VIVO de la mesa Facturas (solo dev, cero impacto en producto).
 * Regla del fundador: los previews del escritorio se hacen con los
 * componentes REALES del v5, no con imitaciones HTML. Esta página monta
 * CalendarStrip y GlowWrap de producción + el brand calcado del código real
 * de EmpresaBrand (con el conmutador BO|FA propuesto), todo con data falsa.
 * NO toca ningún archivo existente.
 */
export default async function MockFacturasPage() {
  const operador = await getDevOperatorContext();
  if (!operador.ok) notFound();
  return <MockFacturasClient />;
}
