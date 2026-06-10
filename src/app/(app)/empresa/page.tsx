import { getUsuario } from "@/lib/dal";
import { createClient } from "@/lib/supabase/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import EmisorForm from "./EmisorForm";
import CAFPanel, { type CAFRow } from "./CAFPanel";
import AiKeyConfig from "./AiKeyConfig";
import EmpresaFormatoCartola from "./EmpresaFormatoCartola";
import EmissionProviderConfig from "./EmissionProviderConfig";
import MiembrosPanel from "./MiembrosPanel";
import type { BoletasEmisionProveedor, FacturasEmisionProveedor } from "./actions";

function mapBoletasProveedor(raw: string | null | undefined): BoletasEmisionProveedor {
  if (raw === "sii_local") return "sii_local";
  if (raw === "simpleapi") return "simpleapi";
  return "mock";
}

function mapFacturasProveedor(raw: string | null | undefined): FacturasEmisionProveedor {
  if (raw === "simpleapi") return "simpleapi";
  return "mock";
}

export default async function EmpresaPage() {
  const usuario = (await getUsuario())!;
  const empresa = usuario.empresas;

  const supabase = await createClient();
  const serviceUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const admin = serviceUrl && serviceKey
    ? createServiceClient<Database>(serviceUrl, serviceKey)
    : supabase;
  const { data: cafs } = await supabase
    .from("boletas_caf_mock")
    .select("id, tipo_dte, folio_desde, folio_hasta, folio_actual, estado, fecha_vence")
    .eq("empresa_id", empresa.id)
    .order("fecha_solicitud", { ascending: false });
  const { data: miembros } = await admin
    .from("usuarios")
    .select("id, email, nombre, rol")
    .eq("empresa_id", empresa.id)
    .order("created_at", { ascending: true });
  const { data: invitaciones } = await admin
    .from("empresa_invitaciones")
    .select("id, email, rol, estado, expires_at")
    .eq("empresa_id", empresa.id)
    .eq("estado", "pendiente")
    .order("created_at", { ascending: false });

  const inicial = {
    rut: empresa.rut,
    razon_social: empresa.razon_social,
    giro: empresa.giro,
    direccion: empresa.direccion,
    comuna: empresa.comuna,
    email_sii: empresa.email_sii,
    tipo_contribuyente: empresa.tipo_contribuyente ?? "auto",
  };
  const boletasProveedor = mapBoletasProveedor(empresa.boletas_emision_proveedor ?? empresa.emision_proveedor);
  const facturasProveedor = mapFacturasProveedor(empresa.facturas_emision_proveedor);
  const devMode = usuario.dev_mode === true;

  return (
    <main className="max-w-lg mx-auto px-4 py-6 pb-24 space-y-6">
      <header>
        <h1 className="text-2xl font-bold">Empresa</h1>
        <p className="text-sm text-[#888] dark:text-white/60 mt-1">
          Configuración inicial de tu empresa.
        </p>
      </header>

      <section className="p-4 rounded-xl bg-white dark:bg-white/5 border border-black/5 dark:border-white/10">
        <h2 className="text-sm font-semibold mb-3">Datos del emisor</h2>
        <EmisorForm inicial={inicial} />
      </section>

      <section>
        <div className="flex items-baseline justify-between mb-3">
          <h2 className="text-sm font-semibold">Formatos de cartola</h2>
          <span className="text-xs text-[#888] dark:text-white/60">Sube 1 ejemplo y mapea</span>
        </div>
        <EmpresaFormatoCartola empresaId={empresa.id} />
      </section>

      <section>
        <div className="flex items-baseline justify-between mb-3">
          <h2 className="text-sm font-semibold">Folios CAF</h2>
          <span className="text-xs text-[#888] dark:text-white/60">{boletasProveedor === "sii_local" ? "Automático en SII" : boletasProveedor === "simpleapi" ? "SimpleAPI" : "Modo de prueba"}</span>
        </div>
        <CAFPanel cafs={(cafs ?? []) as CAFRow[]} proveedor={boletasProveedor} />
      </section>

      <EmissionProviderConfig
        inicial={{ boletasProveedor, facturasProveedor, baseapiSandbox: false }}
        devMode={devMode}
      />

      <MiembrosPanel miembros={miembros ?? []} invitaciones={invitaciones ?? []} />

      <AiKeyConfig />
    </main>
  );
}
