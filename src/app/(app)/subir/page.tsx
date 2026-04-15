import { getUsuario } from "@/lib/dal";
import SubirClient from "./SubirClient";

export default async function SubirPage() {
  const usuario = (await getUsuario())!;
  return <SubirClient empresaId={usuario.empresa_id} />;
}
