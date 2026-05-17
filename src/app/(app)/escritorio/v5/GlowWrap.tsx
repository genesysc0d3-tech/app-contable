"use client";

import { ReactNode } from "react";

export default function GlowWrap({
  children, style, glow,
}: {
  children: ReactNode; style?: React.CSSProperties; glow?: boolean;
}) {
  return <div className={glow ? "ep-glow-card" : ""} style={{ position: "relative", ...style }}>{children}</div>;
}
