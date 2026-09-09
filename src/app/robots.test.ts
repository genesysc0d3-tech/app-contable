import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import robots from "./robots";

/** La app no es superficie de SEO (2026-09-09): cerrada a buscadores y el guard deja pasar /robots.txt. */
describe("app no indexable", () => {
  it("robots.txt cierra todo y el guard de sesión lo deja pasar", () => {
    expect(robots()).toEqual({ rules: [{ userAgent: "*", disallow: "/" }] });
    expect(readFileSync("src/proxy.ts", "utf8")).toMatch(/favicon\.ico\|robots\.txt\$\|/);
    expect(readFileSync("src/app/layout.tsx", "utf8")).toMatch(/robots: \{ index: false, follow: false \},/);
  });
});
