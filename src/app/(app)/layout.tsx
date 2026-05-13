import { requireActiveEmpresa } from "@/lib/dal";
import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import BottomNav from "@/components/layout/BottomNav";
import ThemeToggle from "@/components/ThemeToggle";
import SettingsMenu from "@/components/SettingsMenu";
import { Buildings } from "@phosphor-icons/react/dist/ssr";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const usuario = await requireActiveEmpresa();
  const supabase = await createClient();
  const { count } = await supabase
    .from("propuestas_ia")
    .select("id", { count: "exact", head: true })
    .eq("empresa_id", usuario.empresa_id)
    .eq("estado", "pendiente");

  return (
    <>
      <div className="fixed top-4 right-4 z-50 flex items-center gap-2">
        <Link
          href="/empresa"
          className="p-2 rounded-xl bg-white dark:bg-white/10 shadow-[0_1px_4px_rgba(0,0,0,0.06)] dark:shadow-none hover:scale-105 active:scale-95 transition-transform duration-150"
          aria-label="Empresa"
        >
          <Buildings size={20} weight="bold" className="text-[#888]" />
        </Link>
        <SettingsMenu />
        <ThemeToggle />
      </div>
      {children}
      <BottomNav initialPendientes={count ?? 0} />
    </>
  );
}
