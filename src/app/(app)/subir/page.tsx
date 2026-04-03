import { requireActiveEmpresa } from "@/lib/dal";
import SubirClient from "./SubirClient";

export default async function SubirPage() {
  const usuario = await requireActiveEmpresa();

  return <SubirClient empresaId={usuario.empresa_id} />;
}
