import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import ThemeInitializer from "@/components/ThemeInitializer";
import SwRegistrar from "@/components/SwRegistrar";
import { ToastProvider } from "@/components/Toast";

const inter = Inter({
  variable: "--font-geist-sans",
  subsets: ["latin"],
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
  display: "swap",
});

// Safari hace zoom sobre los campos chicos del formulario de Transbank y al
// volver a la app MANTIENE ese zoom: la página aparecía agrandada hasta que el
// usuario la reseteaba a mano. maximum-scale=1 hace que Safari re-encuadre al
// cargar. (iOS igual permite el pellizco del usuario — ignora maximum-scale
// para el gesto desde iOS 10 — así que no bloquea a nadie.)
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
};

export const metadata: Metadata = {
  title: { default: "MassDTE", template: "%s | MassDTE" },
  description: "De tu cartola bancaria a boletas electrónicas emitidas, en minutos. La IA clasifica, tú apruebas.",
  openGraph: {
    type: "website",
    locale: "es_CL",
    siteName: "MassDTE",
    title: "MassDTE — Tu escritorio de boletas electrónicas",
    description: "Sube tu cartola, revisa y emite el lote completo.",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="es"
      className={`${inter.variable} ${jetbrainsMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="min-h-full flex flex-col bg-[var(--background)] text-[var(--foreground)]">
        {/* Perf: el primer request client-side a Supabase (realtime, candado)
            paga DNS+TCP+TLS completo desde Chile (~300-450ms); el preconnect lo
            adelanta mientras el documento aún carga. React lo iza al <head>. */}
        {process.env.NEXT_PUBLIC_SUPABASE_URL && (
          <>
            <link rel="preconnect" href={process.env.NEXT_PUBLIC_SUPABASE_URL} crossOrigin="anonymous" />
            <link rel="dns-prefetch" href={process.env.NEXT_PUBLIC_SUPABASE_URL} />
          </>
        )}
        <ThemeInitializer />
        <SwRegistrar />
        <ToastProvider>
          {children}
        </ToastProvider>
      </body>
    </html>
  );
}
