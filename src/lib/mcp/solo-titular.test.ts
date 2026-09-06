import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

/**
 * Fundador 2026-09-06: "el MCP solo cuenta principal; para todos los del team
 * es pérdida de tiempo y sobreingeniería". Tres puertas con la misma regla
 * (esTitularDeCuenta) — la API (fail-closed), el consentimiento OAuth y el
 * panel — y la marca visual: el glifo MCP arriba del titular en Equipo.
 */
const AUTH = "src/lib/mcp/auth.ts";
const AUTORIZAR = "src/app/(app)/oauth/autorizar/actions.ts";
const PANEL_ACTIONS = "src/app/(app)/empresa/conector-mcp-actions.ts";
const PANEL = "src/app/(app)/empresa/ConectorMcpConfig.tsx";
const EQUIPO = "src/app/(app)/escritorio/v5/TeamBusinessPanel.tsx";
const V5 = "src/app/(app)/escritorio/v5/actions.ts";

describe("el conector es solo del titular", () => {
  it("la API del MCP rechaza 403 SOLO_TITULAR después del plan y ANTES de entregar contexto", () => {
    const src = readFileSync(AUTH, "utf8");
    const plan = src.indexOf('error: "PLAN_INACTIVO"');
    const titular = src.indexOf('error: "SOLO_TITULAR"');
    const okLine = src.indexOf("return { ok: true, svc, usuarioId");
    expect(titular).toBeGreaterThan(plan);
    expect(okLine).toBeGreaterThan(titular);
    expect(src).toMatch(/if \(!\(await esTitularDeCuenta\(svc, acceso\.cuentaId, usuario\.id\)\)\) return \{ ok: false, status: 403, error: "SOLO_TITULAR" \}/);
  });

  it("el consentimiento OAuth no emite código a un miembro no titular", () => {
    const src = readFileSync(AUTORIZAR, "utf8");
    const gate = src.indexOf("return { error: MCP_SOLO_TITULAR }");
    const code = src.indexOf("const code = generarCodigoAutorizacion()");
    expect(gate).toBeGreaterThan(-1);
    expect(code).toBeGreaterThan(gate);
  });

  it("el panel se apaga (gris, sin botones) si no es titular, con el copy del fundador", () => {
    expect(readFileSync(PANEL_ACTIONS, "utf8")).toMatch(/esTitular = acceso\.ok && \(await esTitularDeCuenta\(svc, acceso\.cuentaId, user\.id\)\)/);
    const panel = readFileSync(PANEL, "utf8");
    expect(panel).toMatch(/const apagado = planActivo === false \|\| esTitular === false;/);
    expect(panel).toMatch(/\{MCP_SOLO_TITULAR\}/);
    expect(panel).not.toMatch(/disabled=\{planActivo === false\}/);
  });

  it("en la tarjeta Equipo el glifo MCP va arriba del titular, y de nadie más", () => {
    const eq = readFileSync(EQUIPO, "utf8");
    expect(eq).toMatch(/\{persona\.esTitular && \([\s\S]*?<LogoMcp size=\{8\} \/>/);
    expect(readFileSync(V5, "utf8")).toMatch(/esTitular: titulares\.has\(usuario\.id\),/);
  });
});
