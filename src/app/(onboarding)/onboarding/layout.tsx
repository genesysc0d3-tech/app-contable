import { redirect } from "next/navigation";
import { getUsuario } from "@/lib/dal";

// El onboarding solo debe verse UNA vez, al crear la cuenta (cuando aún no hay
// empresa). Si el usuario ya tiene empresa, nunca mostrarlo → directo al
// dashboard. Así en logins posteriores no reaparece.
export default async function OnboardingLayout({ children }: { children: React.ReactNode }) {
  const usuario = await getUsuario();
  if (usuario?.empresas) redirect("/massdte");
  return <>{children}</>;
}
