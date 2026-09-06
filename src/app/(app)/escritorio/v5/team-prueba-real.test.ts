import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

/**
 * Lo que cazó la PRUEBA REAL a dos navegadores (2026-09-06, Genesys en Canary
 * y Paula en Chrome). Tres hoyos que ningún censo anterior veía:
 *  1. El invitado que entraba antes de abrir el link caía en "Tu empresa" sin
 *     salida: el onboarding ahora ofrece "Unirme al team" si hay invitación
 *     pendiente para su correo.
 *  2. Abrir una conversación nunca marcaba leído en el servidor: la decisión
 *     se tomaba dentro del updater de setState (corre después).
 *  3. El salto a un doc del MISMO mes pero de otro día, con la mesa en vista
 *     día, quedaba mudo: si el doc no está en la mesa se navega al mes.
 */
const ONBOARDING = "src/app/(onboarding)/onboarding/page.tsx";
const EMPRESA = "src/app/(app)/empresa/actions.ts";
const HOOK = "src/app/(app)/escritorio/v5/useTeamChat.ts";
const CONTROLLER = "src/app/(app)/escritorio/v5/MesaController.tsx";

describe("1. onboarding: unirse al team en vez de crear empresa", () => {
  it("la página pregunta por la invitación pendiente y ofrece 'Unirme al team' arriba del formulario", () => {
    const src = readFileSync(ONBOARDING, "utf8");
    expect(src).toMatch(/invitacionPendienteParaMi\(\)\.then\(setInvitacion\)/);
    const tarjeta = src.indexOf("Unirme al team");
    const form = src.indexOf('name="rut"');
    expect(tarjeta).toBeGreaterThan(-1);
    expect(tarjeta).toBeLessThan(form);
    // sin invitación, igual dice cómo se hace
    expect(src).toMatch(/¿Te vas a unir a un team\?/);
  });

  it("unirse por id pasa por la MISMA aceptación que por link (correo de la sesión = invitado, confirmado, pendiente, vigente)", () => {
    const src = readFileSync(EMPRESA, "utf8");
    expect(src).toMatch(/export async function aceptarInvitacionEmpresa\(token: string\)[\s\S]*?return aceptarInvitacionPor\(\{ tokenHash: hashInviteToken\(token\) \}\);/);
    expect(src).toMatch(/export async function unirseAlTeamPendiente\(invitacionId: string\)[\s\S]*?return aceptarInvitacionPor\(\{ id \}\);/);
    const comun = src.slice(src.indexOf("async function aceptarInvitacionPor"));
    expect(comun).toMatch(/Debes iniciar sesión con el email invitado/);
    expect(comun).toMatch(/Confirma tu email antes de aceptar/);
    expect(comun).toMatch(/invitacion\.estado !== "pendiente"/);
    expect(comun).toMatch(/Invitación expirada/);
  });

  it("la invitación pendiente se busca por el correo de la SESIÓN, no por un parámetro", () => {
    const src = readFileSync(EMPRESA, "utf8");
    const fn = src.slice(src.indexOf("export async function invitacionPendienteParaMi"), src.indexOf("export async function unirseAlTeamPendiente"));
    expect(fn).toMatch(/\.ilike\("email", user\.email\)/);
    expect(fn).toMatch(/\.eq\("estado", "pendiente"\)/);
    expect(fn).not.toMatch(/searchParams|formData/);
  });
});

describe("2. leer marca en el servidor", () => {
  it("decide con la lista actual (ref) ANTES del setState y llama a marcarLeidosTeam fuera del updater", () => {
    const src = readFileSync(HOOK, "utf8");
    const fn = src.slice(src.indexOf("const leer = useCallback"), src.indexOf("return { mensajes"));
    expect(fn).toMatch(/const habia = mensajesRef\.current\.some\(/);
    expect(fn).toMatch(/if \(!habia\) return;/);
    expect(fn).toMatch(/void marcarLeidosTeam\(de\);/);
    // el patrón roto: una variable mutada dentro del updater
    expect(fn).not.toMatch(/let habia = false/);
  });
});

describe("3. el salto navega si el doc no está en la mesa", () => {
  it("mismo mes pero doc ausente (vista día) → navigate al mes", () => {
    const src = readFileSync(CONTROLLER, "utf8");
    const fn = src.slice(src.indexOf("const onOpenDoc = (e: Event)"), src.indexOf('window.addEventListener("massdte:open-doc"'));
    expect(fn).toMatch(/const enMesa = Boolean\(detail\?\.documentoId && \(mesa\.docsAgregados as Array<\{ id: string \}>\)\.some\(\(d\) => d\.id === detail\.documentoId\)\)/);
    expect(fn).toMatch(/else if \(!enMesa\) navigate\(\{ view: "month", month: detail\?\.month \?\? cur \}\)/);
  });
});
