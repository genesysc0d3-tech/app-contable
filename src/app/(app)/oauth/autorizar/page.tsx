import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createClient as createServiceClient, type SupabaseClient } from "@supabase/supabase-js";
import AutorizarForm from "./AutorizarForm";

// Pantalla de consentimiento OAuth: "«Claude» quiere conectarse a tu massDTE".
// Requiere sesión (sin sesión → login con next de vuelta acá). El botón
// Autorizar corre el server action que acuña el código y redirige al conector.

export default async function AutorizarPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const get = (k: string) => (typeof params[k] === "string" ? (params[k] as string) : "");
  const clientId = get("client_id");
  const redirectUri = get("redirect_uri");
  const state = get("state") || null;
  const codeChallenge = get("code_challenge");
  const method = get("code_challenge_method") || "S256";
  const responseType = get("response_type") || "code";

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    const self = `/oauth/autorizar?${new URLSearchParams(Object.entries(params).filter(([, v]) => typeof v === "string") as [string, string][]).toString()}`;
    redirect(`/auth/login?next=${encodeURIComponent(self)}`);
  }

  const invalida =
    !clientId || !redirectUri || !codeChallenge || method !== "S256" || responseType !== "code";

  let clienteNombre: string | null = null;
  if (!invalida) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (url && key) {
      const svc = createServiceClient(url, key) as unknown as SupabaseClient;
      const { data } = await svc.from("oauth_clients").select("client_name").eq("id", clientId).maybeSingle();
      clienteNombre = data?.client_name ?? null;
    }
  }

  return (
    <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", background: "var(--bg, #0d0d0f)", padding: 24 }}>
      <div style={{ width: "min(440px, 94vw)", borderRadius: 20, border: "1px solid var(--border, #26262b)", background: "var(--surface, #161619)", padding: "28px 26px", color: "var(--text, #f1efeb)" }}>
        {invalida || !clienteNombre ? (
          <>
            <h1 style={{ margin: 0, fontSize: 17, fontWeight: 800, letterSpacing: "-.02em" }}>Solicitud de conexión inválida</h1>
            <p style={{ marginTop: 10, fontSize: 13, color: "var(--text2, #8b867e)", lineHeight: 1.55 }}>
              {invalida
                ? "Al enlace le faltan datos o usa un método no soportado. Vuelve a tu asistente e intenta conectar de nuevo."
                : "El conector no está registrado. Vuelve a tu asistente e intenta conectar de nuevo."}
            </p>
          </>
        ) : (
          <AutorizarForm
            clienteNombre={clienteNombre}
            solicitud={{ client_id: clientId, redirect_uri: redirectUri, state, code_challenge: codeChallenge }}
          />
        )}
      </div>
    </div>
  );
}
