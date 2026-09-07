import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

/**
 * "Colaboras en" (fundador 2026-09-06): una persona con cuenta propia puede
 * ser invitada a otros teams. Reglas que este censo sostiene: (1) aceptar no
 * rebota ni la mueve de casa; (2) el selector lista los teams ajenos y la
 * casa; (3) cambiar de empresa cruza cuentas juzgando contra la cuenta del
 * DESTINO (membresía, plan, tick), sin exigir multiempresa; (4) el popup
 * siempre muestra "Colaboras en" (gris si nadie te invitó) y "← Volver a tu
 * cuenta" cuando estás en una ajena; (5) al quitarte, vuelves a casa.
 */
const EMPRESA = "src/app/(app)/empresa/actions.ts";
const V5 = "src/app/(app)/escritorio/v5/actions.ts";
const BRAND = "src/app/(app)/escritorio/v5/EmpresaBrand.tsx";
const MIG = "supabase/migrations/20260907090000_team_quitar_vuelve_a_casa.sql";
const DOWN = "supabase/migrations/20260907090000_team_quitar_vuelve_a_casa_DOWN.sql";

describe("1. aceptar con cuenta propia", () => {
  const src = readFileSync(EMPRESA, "utf8");
  const fn = src.slice(src.indexOf("async function aceptarInvitacionPor"));

  it("ya no rebota por 'pertenece a otra empresa'", () => {
    expect(fn).not.toMatch(/ya pertenece a otra empresa/);
  });

  it("con casa propia se queda en casa: solo se mueve si no tenía empresa", () => {
    expect(fn).toMatch(/if \(!existing\.empresa_id\) \{\s*await sb\.from\("usuarios"\)\.update\(\{ empresa_id: empresaInicial \}\)/);
    expect(fn).not.toMatch(/if \(empresaInicial !== existing\.empresa_id\)/);
  });
});

describe("2. el selector conoce todas mis cuentas", () => {
  const src = readFileSync(V5, "utf8");
  const fn = src.slice(src.indexOf("async function mapaDeCuentas"), src.indexOf("export async function cambiarEmpresaActiva"));

  it("colaboraciones = cuentas donde NO soy titular, solo con empresas con tick; la casa = principal donde SÍ soy titular", () => {
    expect(fn).toMatch(/if \(titularDe\.has\(c\.id\)\) \{[\s\S]*?cuentaPropia = \{ empresaId: principal\.empresa_id/);
    expect(fn).toMatch(/const propias = vs\.filter\(\(v\) => tickSet\.has\(`\$\{c\.id\}:\$\{v\.empresa_id\}`\)\)/);
    expect(fn).toMatch(/if \(propias\.length === 0\) continue;/);
  });

  it("en modo soporte no se ofrecen colaboraciones", () => {
    expect(src).toMatch(/ctx\.supportMode \? \{ colaboraciones: \[\] as Colaboracion\[\], cuentaPropia: null, cuentaActualNombre: "" \} : await mapaDeCuentas/);
  });
});

describe("3. cambiar de empresa cruzando cuentas", () => {
  const src = readFileSync(V5, "utf8");
  const fn = src.slice(src.indexOf("export async function cambiarEmpresaActiva"), src.indexOf("type CrearEmpresaAdicionalResult"));

  it("resuelve la cuenta del destino y juzga contra ELLA: membresía+plan (validarAccesoCuenta) y titular-o-tick", () => {
    expect(fn).toMatch(/\.select\("cuenta_id, empresa_id, activa"\)\s*\.eq\("empresa_id", targetEmpresaId\)/);
    expect(fn).toMatch(/const cruzaCuenta = target\.cuenta_id !== acceso\.cuentaId;/);
    expect(fn).toMatch(/const accesoDestino = await validarAccesoCuenta\(ctx\.sb, ctx\.userId, targetEmpresaId\)/);
    expect(fn).toMatch(/esTitularDeCuenta\(ctx\.sb, target\.cuenta_id, ctx\.userId\)/);
    expect(fn).toMatch(/ticksDeUsuario\(ctx\.sb, target\.cuenta_id, ctx\.userId\)/);
  });

  it("multiempresa solo se exige DENTRO de la cuenta; soporte no cruza cuentas", () => {
    expect(fn).toMatch(/if \(!cruzaCuenta\) \{\s*const multiempresa = await planPermiteMultiempresa/);
    expect(fn).toMatch(/if \(cruzaCuenta && ctx\.supportMode\) return \{ ok: false, error: "EMPRESA_NO_DISPONIBLE" \}/);
  });

  it("el guard del tick sigue ANTES del update de empresa_id", () => {
    expect(fn.indexOf('error: "EMPRESA_SIN_TICK"')).toBeLessThan(fn.indexOf(".update({ empresa_id: targetEmpresaId })"));
  });
});

describe("4. el popup", () => {
  const src = readFileSync(BRAND, "utf8");
  it("siempre muestra 'Colaboras en' (gris si nadie te invitó) y 'Volver a tu cuenta' en cuenta ajena", () => {
    const colab = readFileSync("src/app/(app)/escritorio/v5/ColaborasEn.tsx", "utf8");
    expect(colab).toMatch(/No te han invitado a ningún team/);
    expect(src).toMatch(/<ColaborasEn colaboraciones=\{colaboraciones\} pending=\{pending\} onIr=\{switchEmpresa\} \/>/);
    expect(src).toMatch(/\{enCuentaAjena && cuentaPropia && \([\s\S]*?Volver a tu cuenta/);
    expect(src).toMatch(/Team de \$\{cuentaActualNombre \|\| "otra cuenta"\}/);
  });

  it("vive TAMBIÉN en el wizard de configuración de empresa, como paso Team, con los MISMOS componentes (fundador 2026-09-07)", () => {
    const wizard = readFileSync("src/app/(app)/escritorio/v5/EmpresaPopup.tsx", "utf8");
    expect(wizard).toMatch(/title: "Team",\s*sub: "Quién trabaja contigo · Business"/);
    expect(wizard).toMatch(/\{ key: "team", content: <TeamConfigPanel \/> \}/);
    const panel = readFileSync("src/app/(app)/escritorio/v5/TeamConfigPanel.tsx", "utf8");
    expect(panel).toMatch(/<TeamSection team=\{team\} \/>/);
    expect(panel).toMatch(/<ColaborasEn colaboraciones=\{colab\.colaboraciones\}/);
    expect(panel).toMatch(/Promise\.all\(\[estadoTeam\(\), listarEmpresasSelector\(\)\]\)/);
  });
});

describe("5. al quitarte, vuelves a casa (migración NO aplicada aún en prod)", () => {
  it("la RPC reapunta empresa_id a la principal de la cuenta donde es titular, solo si estaba parado en la cuenta que lo quita", () => {
    const sql = readFileSync(MIG, "utf8");
    expect(sql).toMatch(/where ce\.cuenta_id = p_cuenta_id and ce\.empresa_id = v_empresa_actual/);
    expect(sql).toMatch(/and cu\.cuenta_id <> p_cuenta_id\s+and \(cu\.es_titular or c\.owner_usuario_id = p_usuario_id\)/);
    expect(sql).toMatch(/order by ce\.es_principal desc, ce\.created_at asc/);
    expect(sql).toMatch(/if v_casa is not null then\s+update public\.usuarios set empresa_id = v_casa/);
    expect(readFileSync(DOWN, "utf8")).toMatch(/create or replace function public\.team_quitar_miembro/);
  });
});
