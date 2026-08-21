import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import ThemeInitializer from "@/components/ThemeInitializer";
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
        <ThemeInitializer />
        <ToastProvider>
          {children}
        </ToastProvider>
      </body>
    </html>
  );
}
