import Link from "next/link";
import type { ReactNode } from "react";

const C = {
  bg: "#fbfaf8",
  text: "#171717",
  muted: "#5f6368",
  border: "rgba(20,20,20,.12)",
  accent: "#E8553E",
} as const;

export function LegalShell({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main style={{ minHeight: "100dvh", background: C.bg, color: C.text, fontFamily: "'DM Sans','Inter',sans-serif" }}>
      <div style={{ maxWidth: 880, margin: "0 auto", padding: "28px 18px 56px" }}>
        <nav style={{ display: "flex", gap: 14, flexWrap: "wrap", fontSize: 13, marginBottom: 28 }}>
          <Link href="/auth/login" style={{ color: C.accent, fontWeight: 800, textDecoration: "none" }}>MassDTE</Link>
          <Link href="/legal/privacidad" style={{ color: C.muted, textDecoration: "none" }}>Privacidad</Link>
          <Link href="/legal/terminos" style={{ color: C.muted, textDecoration: "none" }}>Terminos</Link>
          <Link href="/legal/seguridad" style={{ color: C.muted, textDecoration: "none" }}>Seguridad</Link>
        </nav>

        <header style={{ borderBottom: `1px solid ${C.border}`, paddingBottom: 18, marginBottom: 24 }}>
          <div style={{ color: C.muted, fontSize: 12, fontWeight: 800, textTransform: "uppercase", letterSpacing: ".08em" }}>
            Legal Chile
          </div>
          <h1 style={{ margin: "8px 0 0", fontSize: 34, lineHeight: 1.05, letterSpacing: 0 }}>{title}</h1>
          <p style={{ margin: "12px 0 0", color: C.muted, fontSize: 14, lineHeight: 1.6 }}>
            Version inicial para beta controlada. Estos textos pueden ajustarse con revision legal externa.
          </p>
        </header>

        <article style={{ display: "flex", flexDirection: "column", gap: 22, fontSize: 15, lineHeight: 1.65 }}>
          {children}
        </article>
      </div>
    </main>
  );
}

export function LegalSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h2 style={{ margin: "0 0 8px", fontSize: 20, lineHeight: 1.2, letterSpacing: 0 }}>{title}</h2>
      <div style={{ color: C.muted }}>{children}</div>
    </section>
  );
}
