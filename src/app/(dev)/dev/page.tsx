import { redirect } from "next/navigation";

export default function DevPage() {
  redirect("/dev/cuentas");
}

export const dynamic = "force-dynamic";
