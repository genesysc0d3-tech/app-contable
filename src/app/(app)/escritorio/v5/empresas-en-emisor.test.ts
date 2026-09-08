import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

/**
 * Empresas en el paso Emisor del wizard (fundador 2026-09-07): la lista
 * Empresa 1/2/3 vive TAMBIÉN en el botón de configuración; tocar una abre su
 * emisor sin cambiar de mesa; se agrega desde ahí con el mismo formulario del
 * logo; con el cupo lleno el botón lleva a Facturación y uso.
 */
const V5 = "src/app/(app)/escritorio/v5/";
const leer = (p: string) => readFileSync(p, "utf8");

describe("1. guardar el emisor de OTRA empresa de mi cuenta: solo titular y misma cuenta (fail closed)", () => {
  const src = leer("src/app/(app)/empresa/actions.ts");
  const guard = src.slice(src.indexOf("async function empresaDeMiCuentaComoTitular"), src.indexOf("export async function datosEmisorDeEmpresa"));

  it("misma cuenta que la activa + titular (owner o es_titular activo); cualquier duda = false", () => {
    expect(guard).toMatch(/if \(!activa\?\.cuenta_id \|\| !target\?\.cuenta_id \|\| activa\.cuenta_id !== target\.cuenta_id\) return false;/);
    expect(guard).toMatch(/return cuenta\?\.owner_usuario_id === userId \|\| membresia\?\.es_titular === true;/);
    expect(guard).toMatch(/\.eq\("usuario_id", userId\)\.eq\("activo", true\)/);
  });

  it("setDatosEmisor escribe en la empresa objetivo y rebota si no es editable; la lectura también", () => {
    const set = src.slice(src.indexOf("export async function setDatosEmisor"), src.indexOf("// La subida de logo vive SOLO"));
    expect(set).toMatch(/const empresaObjetivo = empresaId \?\? usuario\.empresa_id;/);
    expect(set).toMatch(/if \(empresaObjetivo !== usuario\.empresa_id && !\(await empresaDeMiCuentaComoTitular\(sb, user\.id, usuario\.empresa_id, empresaObjetivo\)\)\)/);
    expect(set).toMatch(/\.update\(update\)\s*\.eq\("id", empresaObjetivo\)/);
    expect(set).not.toMatch(/\.eq\("id", usuario\.empresa_id\)/);
    const get = src.slice(src.indexOf("export async function datosEmisorDeEmpresa"), src.indexOf("export async function setDatosEmisor"));
    expect(get).toMatch(/if \(empresaId !== usuario\.empresa_id && !\(await empresaDeMiCuentaComoTitular\(sb, user\.id, usuario\.empresa_id, empresaId\)\)\)/);
  });
});

describe("2. el paso Emisor del wizard", () => {
  it("usa EmisorStep: formulario + lista, y el cupo lleno va a Facturación y uso (paso 5)", () => {
    const popup = leer(V5 + "EmpresaPopup.tsx");
    expect(popup).toMatch(/\{ key: "emisor", content: <EmisorStep inicial=\{inicial\} empresaId=\{empresaId\} submitRef=\{submitRef\} onIrAFacturacion=\{\(\) => \{ void goToStep\(5\); \}\} semillaEmpresas=\{semilla\?\.empresasSelector \?\? null\} \/> \}/);
    expect(popup).toMatch(/title: "Facturación y uso"/);
  });

  it("elegir otra empresa guarda lo pendiente primero y NO cambia la mesa (nada de cambiarEmpresaActiva)", () => {
    const step = leer(V5 + "EmisorStep.tsx");
    expect(step).toMatch(/const submit = submitRef\.current;\s*if \(submit && !\(await submit\(\)\)\) return;/);
    expect(step).toMatch(/const r = await datosEmisorDeEmpresa\(id\);/);
    expect(step).not.toMatch(/cambiarEmpresaActiva/);
    expect(step).toMatch(/<EmisorForm key=\{otra\.id\} inicial=\{otra\.datos\} variant="popup" submitRef=\{submitRef\} empresaId=\{otra\.id\} \/>/);
  });

  it("EmisorForm guarda en la empresa indicada y en otra empresa no ofrece subir logo (la subida es de la activa)", () => {
    const form = leer("src/app/(app)/empresa/EmisorForm.tsx");
    expect(form).toMatch(/const r = await setDatosEmisor\(datos, empresaId\);/);
    expect(form).toMatch(/\{otraEmpresa \? \(\s*<div[^>]*>\s*El logo se sube desde la mesa de esta empresa\./);
  });
});

describe("3. la lista de empresas", () => {
  const panel = leer(V5 + "EmpresasCuentaPanel.tsx");

  it("chips numerados ARRIBA del formulario (1, 2, 3…), con principal y 'en la mesa'; el mismo formulario de alta que el logo", () => {
    expect(panel).toMatch(/data-empresa-chip=\{e\.id\}/);
    expect(panel).toMatch(/\$\{e\.esPrincipal \? " · Principal" : ""\}\$\{e\.activaActual \? " · En la mesa" : ""\}/);
    const step = leer(V5 + "EmisorStep.tsx");
    expect(step.indexOf("<EmpresasCuentaPanel")).toBeLessThan(step.indexOf("<EmisorForm key={otra.id}"));
    expect(panel).toMatch(/import AgregarEmpresaForm from "\.\/AgregarEmpresaForm";/);
    expect(leer(V5 + "EmpresaBrand.tsx")).toMatch(/import AgregarEmpresaForm from "\.\/AgregarEmpresaForm";/);
    expect(leer(V5 + "EmpresaBrand.tsx")).not.toMatch(/function AgregarEmpresaForm\(/);
  });

  it("agregar solo con cupo; cupo lleno → Facturación y uso; fuera de Business o en cuenta ajena NO se pinta nada", () => {
    expect(panel).toMatch(/if \(estado\.fase !== "ok" \|\| !estado\.multiempresa \|\| estado\.enCuentaAjena\) return null;/);
    expect(panel).toMatch(/\{puedeAgregar && \(\s*<button type="button" onClick=\{\(\) => setAgregando\(\(v\) => !v\)\} data-accion="agregar-empresa"/);
    expect(panel).toMatch(/const cupoLleno = !puedeAgregar && !!cupo && cupo\.activas >= cupo\.incluidas;/);
    expect(panel).toMatch(/\{cupoLleno && \(\s*<button type="button" onClick=\{onIrAFacturacion\} data-accion="cupo-lleno"/);
    expect(panel).not.toMatch(/business-cta/);
  });

  it("el selector expone el cupo (activas/incluidas) para el titular multiempresa", () => {
    const actions = leer(V5 + "actions.ts");
    expect(actions).toMatch(/cupoEmpresas: \{ activas: number; incluidas: number \} \| null;/);
    expect(actions).toMatch(/if \(cuenta\) cupoEmpresas = \{ activas: cuenta\.empresasActivas, incluidas: cuenta\.empresasIncluidas \};/);
  });
});
