import { requireActiveEmpresa } from "@/lib/dal";
import BottomNav from "@/components/layout/BottomNav";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireActiveEmpresa();

  return (
    <>
      {children}
      <BottomNav />
    </>
  );
}
