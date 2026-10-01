import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { cargarSiSigueVigente } from "./mesa-frescura";
import { hrefCambioMesa } from "./mesa-url";

// Bug fundador 2026-10-01: "me voy a otra fecha y a unos minutos me manda a hoy".
const leer = (f: string) => readFileSync(join(__dirname, f), "utf8");

function diferida<T>() {
  let resolver!: (v: T) => void;
  const promesa = new Promise<T>((r) => { resolver = r; });
  return { promesa, resolver };
}

describe("cargarSiSigueVigente", () => {
  it("si el usuario navegó mientras cargaba, NO aplica (pero sí guarda en caché)", async () => {
    let vigente = "day|2026-10-01";
    const d = diferida<string>();
    const aplicadas: string[] = [];
    const guardadas: string[] = [];
    const p = cargarSiSigueVigente({ vigente: () => vigente, cargar: () => d.promesa, aplicar: (r) => aplicadas.push(r), guardar: (r) => guardadas.push(r) });
    vigente = "month|2026-08"; // se fue a agosto
    d.resolver("mesa de hoy");
    expect(await p).toBe(false);
    expect(aplicadas).toEqual([]);
    expect(guardadas).toEqual(["mesa de hoy"]);
  });

  it("si nadie se movió, aplica", async () => {
    const aplicadas: string[] = [];
    expect(await cargarSiSigueVigente({ vigente: () => "k", cargar: async () => "m", aplicar: (r) => aplicadas.push(r) })).toBe(true);
    expect(aplicadas).toEqual(["m"]);
  });

  it("respuesta fallida (null) no aplica ni guarda", async () => {
    const tocadas: string[] = [];
    expect(await cargarSiSigueVigente<string>({ vigente: () => "k", cargar: async () => null, aplicar: (r) => tocadas.push(r), guardar: (r) => tocadas.push(r) })).toBe(false);
    expect(tocadas).toEqual([]);
  });

  it("navegación: clic en 5 (lento) → clic en 6 (rápido): la de 5 no pisa la de 6", async () => {
    let ultimo = "";
    const mesa: string[] = [];
    const lenta = diferida<string>();
    ultimo = "day|05";
    const p5 = cargarSiSigueVigente({ vigente: () => ultimo, cargar: () => lenta.promesa, aplicar: (r) => mesa.push(r) });
    ultimo = "day|06";
    await cargarSiSigueVigente({ vigente: () => ultimo, cargar: async () => "mesa 6", aplicar: (r) => mesa.push(r) });
    lenta.resolver("mesa 5");
    await p5;
    expect(mesa).toEqual(["mesa 6"]);
  });
});

describe("hrefCambioMesa: cambiar boleta ↔ factura conserva el rango", () => {
  it("conserva date/month/view y cambia la mesa", () => {
    expect(hrefCambioMesa("?date=2026-08-14&month=2026-7&view=week&mesa=boleta", "factura"))
      .toBe("/massdte?date=2026-08-14&month=2026-7&view=week&mesa=factura");
  });
  it("sin rango en la URL → solo la mesa (como antes)", () => {
    expect(hrefCambioMesa("", "boleta")).toBe("/massdte?mesa=boleta");
  });
  it("no arrastra otros parámetros", () => {
    expect(hrefCambioMesa("?view=month&foo=1", "factura")).toBe("/massdte?view=month&mesa=factura");
  });
});

describe("cableado en la fuente", () => {
  const ctrl = leer("MesaController.tsx");
  it("la escalera de vigilancia recarga el rango VIGENTE, no el día de la subida", () => {
    expect(ctrl).toMatch(/timers\.push\(setTimeout\(\(\) => recargador\(\)\.pedir\(\), ms\)\)/);
    expect(ctrl).not.toMatch(/setTimeout\(\(\) => recargarDia\(/);
  });
  it("la carga post-subida y navigate pasan por cargarSiSigueVigente", () => {
    expect(ctrl.match(/cargarSiSigueVigente\(\{/g)?.length).toBe(2);
    expect(ctrl).toMatch(/ultimoPedidoRef\.current = key;/);
  });
  it("onUploaded borra el flag del remount", () => {
    const onUploaded = ctrl.slice(ctrl.indexOf("const onUploaded"), ctrl.indexOf('window.addEventListener("massdte:uploaded"'));
    expect(onUploaded).toMatch(/sessionStorage\.removeItem\("massdte:uploaded-at"\)/);
  });
  it("EmpresaBrand no navega a /massdte?mesa= a secas", () => {
    const brand = leer("EmpresaBrand.tsx");
    expect(brand).not.toMatch(/\/massdte\?mesa=\$\{/);
    expect(brand.match(/hrefCambioMesa\(searchActual\(\)/g)?.length).toBe(2);
  });
  it("las ventas del rango se leen paginadas (PostgREST corta en 1000)", () => {
    expect(leer("mesa-data.ts")).toMatch(/traerTodasLasFilas<\{ monto_total: number \| null \}>\(\(desde, hasta\) => supabase\.from\("boletas_emitidas"\)[^\n]*\.order\("id"\)\.range\(desde, hasta\)\)/);
  });
});
