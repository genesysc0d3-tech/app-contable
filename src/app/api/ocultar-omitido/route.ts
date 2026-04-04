import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";

export async function POST(request: Request) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  const body = await request.json();
  const { documento_id, fecha, monto, descripcion, ocultar } = body;

  if (!documento_id || !descripcion || monto == null) {
    return NextResponse.json({ error: "Campos requeridos" }, { status: 400 });
  }

  const svc = createServiceClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const { data: doc } = await svc
    .from("documentos_subidos")
    .select("progreso_ia")
    .eq("id", documento_id)
    .single();

  if (!doc?.progreso_ia) {
    return NextResponse.json({ error: "Documento sin progreso" }, { status: 404 });
  }

  const progreso = doc.progreso_ia as Record<string, unknown>;
  const detalle = progreso.duplicados_detalle as Array<Record<string, unknown>> | undefined;

  if (!detalle || !Array.isArray(detalle)) {
    return NextResponse.json({ error: "Sin duplicados" }, { status: 404 });
  }

  const montoNum = Number(monto);
  const shouldHide = ocultar !== false; // default true

  const updated = detalle.map((d) => {
    if (d.descripcion === descripcion && Number(d.monto) === montoNum && d.fecha === fecha) {
      return { ...d, oculto: shouldHide };
    }
    return d;
  });

  await svc
    .from("documentos_subidos")
    .update({
      progreso_ia: { ...progreso, duplicados_detalle: updated } as unknown as Database["public"]["Tables"]["documentos_subidos"]["Update"]["progreso_ia"],
    })
    .eq("id", documento_id);

  return NextResponse.json({ ok: true });
}
