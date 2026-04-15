import { Suspense } from "react";
import { getUsuario } from "@/lib/dal";
import SubirClient from "./SubirClient";
import MobileHero from "@/components/MobileHero";

export default async function SubirPage() {
  const usuario = (await getUsuario())!;
  return (
    <>
      <Suspense fallback={null}>
        <MobileHero empresaId={usuario.empresa_id} empresa={usuario.empresas.razon_social} />
      </Suspense>
      <SubirClient empresaId={usuario.empresa_id} />
    </>
  );
}
