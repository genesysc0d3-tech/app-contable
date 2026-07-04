import { describe, expect, it } from "vitest";
import { buildVisibleEmissionLock } from "./lock-visibility";

const lock = {
  job_id: "job-1",
  provider: "sii_local",
  locked_until: "2026-06-16T20:00:00.000Z",
  heartbeat_at: "2026-06-16T19:55:00.000Z",
  usuario_id: "user-a",
};

describe("buildVisibleEmissionLock", () => {
  it("no expone nombre ni equipo fuera de Business", () => {
    const visible = buildVisibleEmissionLock({
      lock,
      businessMode: false,
      currentUserId: "user-b",
      usuario: { nombre: "Juan Perez", email: "juan@example.com" },
    });

    expect(visible.usuario_nombre).toBeUndefined();
    expect(visible.mensaje).not.toContain("Juan");
    expect(visible.mensaje).not.toContain("juan@example.com");
    expect(visible.mensaje).toContain("emision en curso");
    expect(visible.is_mine).toBe(false);
  });

  it("expone mensaje humano para equipo Business", () => {
    const visible = buildVisibleEmissionLock({
      lock,
      businessMode: true,
      currentUserId: "user-b",
      usuario: { nombre: "Juan Perez", email: "juan@example.com" },
    });

    expect(visible.usuario_nombre).toBe("Juan Perez");
    expect(visible.mensaje).toContain("Juan Perez esta emitiendo");
    expect(visible.is_mine).toBe(false);
  });

  it("marca el lock propio", () => {
    const visible = buildVisibleEmissionLock({
      lock,
      businessMode: true,
      currentUserId: "user-a",
      usuario: { nombre: "Take" },
    });

    expect(visible.is_mine).toBe(true);
  });
});
