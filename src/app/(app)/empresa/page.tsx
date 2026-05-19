import { getUsuario } from "@/lib/dal";
import { createClient } from "@/lib/supabase/server";
import EmisorForm from "./EmisorForm";
import CertificadoToggle from "./CertificadoToggle";
import CAFPanel, { type CAFRow } from "./CAFPanel";
import AiKeyConfig from "./AiKeyConfig";
import EmpresaFormatoCartola from "./EmpresaFormatoCartola";

export default async function EmpresaPage() {
  const usuario = (await getUsuario())!;
  const empresa = usuario.empresas;

  const supabase = await createClient();
  const { data: cafs } = await supabase
    .from("boletas_caf_mock")
    .select("id, tipo_dte, folio_desde, folio_hasta, folio_actual, estado, fecha_vence")
    .eq("empresa_id", empresa.id)
    .order("fecha_solicitud", { ascending: false });

  const inicial = {
    rut: empresa.rut,
    razon_social: empresa.razon_social,
    giro: empresa.giro,
    direccion: empresa.direccion,
    comuna: empresa.comuna,
    email_sii: empresa.email_sii,
  };

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
        <h2 className="text-sm font-semibold mb-2">Certificado digital SII</h2>
        <CertificadoToggle inicial={empresa.tiene_certificado_sii} />
      </section>

      <section>
        <div className="flex items-baseline justify-between mb-3">
          <h2 className="text-sm font-semibold">Formatos de cartola</h2>
          <span className="text-xs text-[#888] dark:text-white/60">Subí 1 ejemplo y mapeá</span>
        </div>
        <EmpresaFormatoCartola empresaId={empresa.id} />
      </section>

      <section>
        <div className="flex items-baseline justify-between mb-3">
          <h2 className="text-sm font-semibold">Folios CAF</h2>
          <span className="text-xs text-[#888] dark:text-white/60">Gestión automática</span>
        </div>
        <CAFPanel cafs={(cafs ?? []) as CAFRow[]} />
      </section>

      <AiKeyConfig />
    </main>
  );
}
