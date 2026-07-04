import { redirect } from "next/navigation";
import { requireActiveEmpresa } from "@/lib/dal";

export default async function Home() {
  // requireActiveEmpresa usa getUsuario (con fallback service-role keyed a
  // user.id) y redirige solo si de verdad corresponde: /auth/login (sin sesión),
  // /onboarding (sin empresa), /bloqueado (vetado) o /planes (plan inactivo).
  await requireActiveEmpresa();
  redirect("/massdte");
}
