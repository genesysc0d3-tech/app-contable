import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

/**
 * Guard de escritura de la configuración de empresa (fundador 2026-09-08):
 * el gris del botón en cuenta ajena era solo visual. `usuarios.rol` es GLOBAL
 * (Paula es "owner" de su cuenta y sigue "owner" transportada al team de
 * AlphaCode), así que el rol no basta: cada escritura exige ser TITULAR de la
 * cuenta a la que pertenece la empresa. Fail closed.
 */
const ACTIONS = "src/app/(app)/empresa/actions.ts";
const leer = (p: string) => readFileSync(p, "utf8");

describe("soloTitular", () => {
  const src = leer(ACTIONS);
  it("resuelve la cuenta de la empresa y exige titular; sin cuenta activa también rebota", () => {
    const h = src.slice(src.indexOf("async function soloTitular("), src.indexOf("/**\n * ¿Puede este usuario editar el emisor"));
    expect(h).toMatch(/const cuentaId = await cuentaIdDeEmpresa\(sb, empresaId\);\s*if \(!cuentaId\) return "La empresa no tiene cuenta activa";/);
    expect(h).toMatch(/if \(!\(await esTitularDeCuenta\(sb, cuentaId, userId\)\)\) return "Solo el titular de la cuenta cambia la configuración de la empresa";/);
  });

  it("las cuatro escrituras pasan por el guard ANTES de tocar la base", () => {
    for (const [fn, target, fin] of [
      ["setDatosEmisor", "empresaObjetivo", "// La subida de logo vive SOLO"],
      ["removeEmpresaLogo", "usuario.empresa_id", "export async function setCertificadoSii("],
      ["setCertificadoSii", "usuario.empresa_id", "export async function setEmisionConfig("],
      ["setEmisionConfig", "usuario.empresa_id", "export async function listFormatosCartola("],
    ] as const) {
      const a = src.indexOf(`export async function ${fn}(`);
      const seg = src.slice(a, src.indexOf(fin, a));
      const guard = seg.indexOf(`const veto = await soloTitular(sb, user.id, ${target});`);
      expect(guard, fn).toBeGreaterThan(0);
      expect(seg.slice(guard, guard + 120), fn).toMatch(/if \(veto\) return \{ error: veto \};/);
      const primeraEscritura = Math.min(...[".update(", ".upsert(", ".insert(", ".remove("].map((k) => { const i = seg.indexOf(k); return i < 0 ? Infinity : i; }));
      expect(guard, `${fn}: el guard va antes de escribir`).toBeLessThan(primeraEscritura);
    }
  });

  it("las rutas del logo y del contexto por defecto exigen titular (403)", () => {
    const logo = leer("src/app/api/empresa/upload-logo/route.ts");
    expect(logo).toMatch(/if \(!cuentaId \|\| !\(await esTitularDeCuenta\(svc, cuentaId, user\.id\)\)\) \{\s*return NextResponse\.json\(\{ error: "Solo el titular de la cuenta cambia el logo de la empresa" \}, \{ status: 403 \}\);/);
    expect(logo.indexOf("esTitularDeCuenta(svc")).toBeLessThan(logo.indexOf("formData = await request.formData()"));
    const ctx = leer("src/app/api/empresa/contexto-default/route.ts");
    expect(ctx).toMatch(/return NextResponse\.json\(\{ error: "SOLO_TITULAR" \}, \{ status: 403 \}\);/);
    expect(ctx.indexOf("SOLO_TITULAR")).toBeLessThan(ctx.indexOf('.update({ contexto_usuario_default'));
  });
});
