import { getUsuario } from "@/lib/dal";

export default async function V3Test() {
  const usuario = await getUsuario();
  return (
    <div className="p-8">
      <h1 className="text-xl font-bold">V3 Test</h1>
      <p>Usuario: {usuario?.email ?? "no user"}</p>
      <p>Empresa: {usuario?.empresas?.razon_social ?? "no empresa"}</p>
    </div>
  );
}
