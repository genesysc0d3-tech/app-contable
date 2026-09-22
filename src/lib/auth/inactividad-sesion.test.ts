import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  INACTIVIDAD_MAXIMA_MS,
  REFRESCO_ULTIMO_ACCESO_MS,
  debeRefrescarUltimoAcceso,
  diasSinAparecerRestantes,
  sesionVencidaPorInactividad,
  ultimaVezVisto,
} from "./inactividad-sesion";

const HACE_DIAS = (d: number) => new Date(Date.now() - d * 24 * 60 * 60 * 1000).toISOString();
const HACE_MIN = (m: number) => new Date(Date.now() - m * 60 * 1000).toISOString();

describe("cierre de sesión por inactividad", () => {
  it("entró ayer → sigue adentro", () => {
    expect(sesionVencidaPorInactividad(HACE_DIAS(1))).toBe(false);
  });

  it("entró hace 6 días → sigue adentro (el contador semanal no se topa con esto)", () => {
    expect(sesionVencidaPorInactividad(HACE_DIAS(6))).toBe(false);
  });

  it("no aparece hace 10 días → a login", () => {
    expect(sesionVencidaPorInactividad(HACE_DIAS(10))).toBe(true);
  });

  it("sin dato NO se cierra: nadie queda encerrado fuera por una migración", () => {
    expect(sesionVencidaPorInactividad(null)).toBe(false);
    expect(sesionVencidaPorInactividad(undefined)).toBe(false);
    expect(sesionVencidaPorInactividad("no-es-una-fecha")).toBe(false);
  });

  it("acepta Date además de texto", () => {
    expect(sesionVencidaPorInactividad(new Date(Date.now() - 8 * 24 * 60 * 60 * 1000))).toBe(true);
  });

  it("el tope es de 7 días", () => {
    expect(INACTIVIDAD_MAXIMA_MS).toBe(7 * 24 * 60 * 60 * 1000);
  });
});

// Incidente 2026-09-22: 4 usuarios encerrados. Nada escribía ultimo_acceso al
// INICIAR sesión → quien volvía tras 7+ días entraba por Google y el middleware
// lo cerraba al instante, en cada intento, para siempre.
describe("un login recién hecho nunca está vencido (last_sign_in_at)", () => {
  it("ultimo_acceso hace 21 días + login hace 1 minuto → ADENTRO", () => {
    expect(sesionVencidaPorInactividad(HACE_DIAS(21), Date.now(), HACE_MIN(1))).toBe(false);
  });
  it("ultimo_acceso hace 21 días + último login también viejo → a login", () => {
    expect(sesionVencidaPorInactividad(HACE_DIAS(21), Date.now(), HACE_DIAS(20))).toBe(true);
  });
  it("sin ultimo_acceso pero con login viejo → manda el login (a login)", () => {
    expect(sesionVencidaPorInactividad(null, Date.now(), HACE_DIAS(10))).toBe(true);
  });
  it("sin login informado → se comporta como antes", () => {
    expect(sesionVencidaPorInactividad(HACE_DIAS(10), Date.now(), null)).toBe(true);
    expect(sesionVencidaPorInactividad(HACE_DIAS(1), Date.now(), undefined)).toBe(false);
  });
  it("ultimaVezVisto = el más reciente de los dos", () => {
    const viejo = HACE_DIAS(21), nuevo = HACE_MIN(1);
    expect(ultimaVezVisto(viejo, nuevo)).toBe(Date.parse(nuevo));
    expect(ultimaVezVisto(nuevo, viejo)).toBe(Date.parse(nuevo));
    expect(ultimaVezVisto(null, null)).toBeNull();
  });
  it("el guard y el middleware le pasan last_sign_in_at (si no, el bug vuelve)", () => {
    for (const ruta of ["src/lib/api/account-guard.ts", "src/lib/supabase/proxy.ts"]) {
      expect(readFileSync(ruta, "utf8")).toMatch(/sesionVencidaPorInactividad\([^;]*user\.last_sign_in_at/);
    }
  });
});

describe("refresco de ultimo_acceso", () => {
  it("recién visto hace 5 minutos → NO se vuelve a escribir", () => {
    expect(debeRefrescarUltimoAcceso(HACE_MIN(5))).toBe(false);
  });

  it("hace más de media hora → se refresca", () => {
    expect(debeRefrescarUltimoAcceso(HACE_MIN(45))).toBe(true);
  });

  it("sin dato → se escribe la primera vez", () => {
    expect(debeRefrescarUltimoAcceso(null)).toBe(true);
  });

  it("el refresco es cada 30 minutos, no en cada request", () => {
    expect(REFRESCO_ULTIMO_ACCESO_MS).toBe(30 * 60 * 1000);
  });
});

describe("aviso al usuario", () => {
  it("dice cuántos días le quedan", () => {
    expect(diasSinAparecerRestantes(HACE_DIAS(5))).toBe(2);
    expect(diasSinAparecerRestantes(HACE_DIAS(30))).toBe(0);
    expect(diasSinAparecerRestantes(null)).toBeNull();
  });
});

/**
 * QUE NO SE NOS OLVIDE.
 *
 * La debilidad de tener esta regla en nuestro código —y no en el interruptor de
 * Supabase, que es insaltable— es que alguien la desconecte sin darse cuenta.
 * Estos tests son el recordatorio.
 *
 * Mirar si el NOMBRE aparece en el archivo NO basta: la línea del `import` lo
 * mantiene aunque nadie llame. (Comprobado: la primera versión de estos tests
 * seguía pasando con la regla desconectada a mano.) Por eso se borran los
 * imports y recién ahí se busca la LLAMADA.
 */
const sinImports = (ruta: string) =>
  readFileSync(ruta, "utf8").replace(/^\s*import[\s\S]*?;\s*$/gm, "");

describe("la regla sigue enchufada donde corresponde", () => {
  it("el guard de las rutas la LLAMA (de ahí la hereda /api/extension/vault-key)", () => {
    expect(sinImports("src/lib/api/account-guard.ts")).toContain("sesionVencidaPorInactividad(");
  });

  it("el middleware la LLAMA y cierra la sesión (signOut revoca también para la extensión)", () => {
    const proxy = sinImports("src/lib/supabase/proxy.ts");
    expect(proxy).toContain("sesionVencidaPorInactividad(");
    expect(proxy).toContain("signOut(");
  });

  it("los dos refrescan ultimo_acceso, o el reloj nunca avanza", () => {
    expect(sinImports("src/lib/api/account-guard.ts")).toContain("debeRefrescarUltimoAcceso(");
    expect(sinImports("src/lib/supabase/proxy.ts")).toContain("debeRefrescarUltimoAcceso(");
  });

  it("la ruta de la bóveda sigue pasando por el guard y no por su propia puerta", () => {
    expect(readFileSync("src/app/api/extension/vault-key/route.ts", "utf8")).toContain("requireAccountApiAccess");
  });
});
