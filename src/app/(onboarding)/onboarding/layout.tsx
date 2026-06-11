import { redirect } from "next/navigation";
import { getUsuario } from "@/lib/dal";

// El onboarding solo debe verse UNA vez, al crear la cuenta (cuando aún no hay
// empresa). Si el usuario ya tiene empresa, nunca mostrarlo → directo al
// dashboard. Así en logins posteriores no reaparece.
export default async function OnboardingLayout({ children }: { children: React.ReactNode }) {
  const usuario = await getUsuario();
  if (usuario?.empresas) redirect("/massdte");
  // Misma estética que la landing/login: negro + coral + blanco, siempre oscuro.
  return (
    <div className="dark min-h-screen flex flex-col bg-[#0a0a0a] text-white">
      {children}
    </div>
  );
}
