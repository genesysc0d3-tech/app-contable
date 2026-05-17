"use client";

import { ReactNode } from "react";

export default function GlowWrap({
  children, style,
}: {
  children: ReactNode; style?: React.CSSProperties;
}) {
  return <div style={{ position: "relative", ...style }}>{children}</div>;
}
