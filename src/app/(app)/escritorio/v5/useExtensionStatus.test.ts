import { describe, expect, it } from "vitest";
import { delayDePolling, estadoTrasSilencio, PING_TIMEOUT_MS, POLL_READY_MS } from "./extension-estado-reglas";

// Incidente 2026-09-24: chip con "v0.2.3" teniendo la 0.2.4, y ✕ a una clienta que
// sí emitía. El hook no volvía a preguntar una vez "ready".
describe("chequeo de la extensión: sigue preguntando estando ready", () => {
  it("ready con bóveda → re-pregunta cada 60 s (antes: nunca)", () => {
    expect(delayDePolling("ready", true, 5_000)).toBe(POLL_READY_MS);
    expect(delayDePolling("ready", null, 500_000)).toBe(POLL_READY_MS);
  });
  it("sin extensión o sin bóveda → rápido el primer minuto, después cada 15 s", () => {
    expect(delayDePolling("missing", null, 10_000)).toBe(2500);
    expect(delayDePolling("missing", null, 90_000)).toBe(15_000);
    expect(delayDePolling("ready", false, 10_000)).toBe(2500);
  });
  it("un silencio estando ready NO apaga el ✓ (service worker frío); dos seguidos sí", () => {
    expect(estadoTrasSilencio("ready", 1)).toBe("ready");
    expect(estadoTrasSilencio("ready", 2)).toBe("missing");
  });
  it("checking sin respuesta → missing; missing se queda missing", () => {
    expect(estadoTrasSilencio("checking", 1)).toBe("missing");
    expect(estadoTrasSilencio("missing", 5)).toBe("missing");
  });
  it("el ping espera 3 s, no 1,2 s (un service worker MV3 frío tarda más)", () => {
    expect(PING_TIMEOUT_MS).toBeGreaterThanOrEqual(3000);
  });
});
