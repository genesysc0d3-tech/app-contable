/**
 * Paleta del panel /dev. Vive en su propio archivo, SIN JSX, a propósito:
 * DevCuentaActions.tsx es "use client" y si importara los colores desde ui.tsx
 * se arrastraría todo el JSX de ui.tsx al bundle del navegador.
 *
 * Antes había cuatro copias de estos valores y ya habían divergido (.07 vs .08
 * en los bordes), lo que se notaba justo donde los botones del cliente quedan
 * hombro con hombro con las tarjetas del servidor.
 */
export const C = {
  bg: "#0f1014",
  surface: "#16181d",
  border: "rgba(255,255,255,.07)",
  text: "#e8eaf0",
  text2: "#9aa0ad",
  text3: "#636878",
  accent: "#E8553E",
  accentSoft: "rgba(232,85,62,.14)",
  amber: "#f59e0b",
  amberSoft: "rgba(245,158,11,.12)",
  green: "#22c55e",
  muted: "rgba(255,255,255,.045)",
} as const;

export type Tone = "ok" | "warning" | "error" | "muted";

export function toneColor(tone: Tone) {
  if (tone === "ok") return C.green;
  if (tone === "warning") return C.amber;
  if (tone === "error") return C.accent;
  return C.text2;
}
