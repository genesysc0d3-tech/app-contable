import { requireActiveEmpresa } from "@/lib/dal";
import PageTransition from "@/components/PageTransition";
import SubirClient from "./SubirClient";

export default async function SubirPage() {
  const usuario = await requireActiveEmpresa();

  return <PageTransition><SubirClient empresaId={usuario.empresa_id} /></PageTransition>;
}
