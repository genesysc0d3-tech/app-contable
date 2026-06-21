import { Suspense } from "react";
import { getAppEmpresaContext } from "@/lib/dal";
import SubirClient from "./SubirClient";
import MobileHero from "@/components/MobileHero";

export default async function SubirPage() {
  const { empresaId, empresa } = await getAppEmpresaContext();
  return (
    <>
      <Suspense fallback={null}>
        <MobileHero empresaId={empresaId} empresa={empresa.razon_social} />
      </Suspense>
      <SubirClient empresaId={empresaId} />
    </>
  );
}
