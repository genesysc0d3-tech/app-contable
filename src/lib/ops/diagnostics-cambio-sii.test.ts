import { describe, expect, it, vi } from "vitest";

// diagnostics.ts es código de servidor; "server-only" no existe fuera de Next.
vi.mock("server-only", () => ({}));
vi.mock("@/lib/r2", () => ({ isR2Configured: () => false, r2ObjetoMasNuevo: vi.fn() }));

const { agruparCambioSii, AUTO_PAUSA_UMBRAL, AUTO_PAUSA_WINDOW_MS, CAMBIO_SII_UMBRAL, CAMBIO_SII_WINDOW_MS } = await import("./diagnostics");

const t = "2026-09-10T15:00:00Z";
const row = (empresa: string, ancla: string, extra: Record<string, unknown> = {}) => ({
  empresa_id: empresa,
  metadata: { ancla, portal: "boletas", ...extra },
  created_at: t,
});

describe("agruparCambioSii — qué cuenta para 'el portal probablemente cambió'", () => {
  it("2 empresas distintas con la MISMA ancla → critical", () => {
    const f = agruparCambioSii([row("e1", "botones.emitir"), row("e2", "botones.emitir")]);
    const c = f.find((x) => x.eventName === "sii_posible_cambio_portal");
    expect(c?.severity).toBe("critical");
    expect(c?.summary).toContain("probablemente cambió");
    expect(c?.metadata?.empresas_distintas).toBe(2);
  });

  it("posible_cambio_sii === false NO cuenta: va al finding de errores pre-emit (warn)", () => {
    const f = agruparCambioSii([
      row("e1", "botones.emitir", { posible_cambio_sii: false }),
      row("e2", "botones.emitir", { posible_cambio_sii: false }),
      row("e3", "botones.emitir", { posible_cambio_sii: false }),
    ]);
    expect(f.find((x) => x.eventName === "sii_posible_cambio_portal")).toBeUndefined();
    const pre = f.find((x) => x.eventName === "sii_errores_pre_emit");
    expect(pre?.severity).toBe("warn");
    expect(pre?.metadata?.eventos).toBe(3);
    expect(pre?.metadata?.empresas_distintas).toBe(3);
  });

  it("ancla 'otro' (o sin ancla) NUNCA es 'probablemente cambió'", () => {
    const f = agruparCambioSii([row("e1", "otro"), row("e2", "otro"), { empresa_id: "e3", metadata: {}, created_at: t }]);
    expect(f.find((x) => x.eventName === "sii_posible_cambio_portal")).toBeUndefined();
    expect(f.find((x) => x.eventName === "sii_errores_pre_emit")?.metadata?.eventos).toBe(3);
  });

  it("mezcla: solo las estructurales con posible_cambio_sii ≠ false suman al umbral", () => {
    const f = agruparCambioSii([
      row("e1", "botones.emitir"),
      row("e2", "botones.emitir", { posible_cambio_sii: false }),
      row("e3", "otro"),
    ]);
    const c = f.find((x) => x.eventName === "sii_posible_cambio_portal");
    expect(c?.severity).toBe("warn");
    expect(c?.metadata?.empresas_distintas).toBe(1);
    expect(f.find((x) => x.eventName === "sii_errores_pre_emit")?.metadata?.eventos).toBe(2);
  });

  it("sin eventos → sin findings; un evento viejo sin la clave posible_cambio_sii sí cuenta", () => {
    expect(agruparCambioSii([])).toEqual([]);
    const f = agruparCambioSii([row("e1", "forms.formulario")]);
    expect(f).toHaveLength(1);
    expect(f[0].eventName).toBe("sii_posible_cambio_portal");
  });
});

describe("umbrales del auto-kill vs. panel", () => {
  it("el auto-kill es MÁS estricto que el panel (3 empresas / 2 h vs 2 / 24 h)", () => {
    expect(AUTO_PAUSA_UMBRAL).toBe(3);
    expect(AUTO_PAUSA_WINDOW_MS).toBe(2 * 60 * 60 * 1000);
    expect(CAMBIO_SII_UMBRAL).toBe(2);
    expect(CAMBIO_SII_WINDOW_MS).toBe(24 * 60 * 60 * 1000);
    expect(AUTO_PAUSA_UMBRAL).toBeGreaterThan(CAMBIO_SII_UMBRAL);
    expect(AUTO_PAUSA_WINDOW_MS).toBeLessThan(CAMBIO_SII_WINDOW_MS);
  });
});
