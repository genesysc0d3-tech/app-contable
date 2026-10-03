import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AdapterConfig } from "@/lib/parsers/types";

// Vuelta 6b (A2 + M1): un PDF SIN marca propia de banco que el lector leyó.
//  - el popup nunca lo pinta "cuadra con tu banco" y pregunta si es de su banco;
//  - "Sí, es mi cartola" queda en el mapa del CLIENTE (revision_cliente.es_banco)
//    y vale para los siguientes PDFs del formato de ESA empresa (no de otra);
//  - "No es una cartola" saca el formato del lector (flujo de antes).

const EMPRESA = "emp-cliente";
let archivo: ArrayBuffer;
let ruta = "p-0.pdf";
let n = 0;
const upserts: Record<string, unknown>[] = [];
let adapterCache: Record<string, unknown> | null = null;

function tabla(nombre: string) {
  const b: Record<string, unknown> = {};
  for (const op of ["select", "order", "limit", "not", "in", "eq"]) b[op] = () => b;
  b.single = async () => nombre === "usuarios"
    ? { data: { empresa_id: EMPRESA }, error: null }
    : { data: { id: "doc-1", tipo: "pdf", storage_provider: "supabase", storage_path: ruta, empresa_id: EMPRESA }, error: null };
  b.maybeSingle = b.single;
  return b;
}
const sbFalso = {
  auth: { getUser: async () => ({ data: { user: { id: "u1" } } }) },
  from: (t: string) => tabla(t),
  storage: { from: () => ({ download: async () => ({ data: null, error: null }) }) },
};
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => sbFalso }));
vi.mock("@/lib/dev/support-mode", () => ({ getDevSupportMode: async () => null, getDevSupportWriteBlock: async () => null }));
vi.mock("@/lib/security/rate-limit-global", () => ({ enforceRateLimitGlobal: async () => null }));
vi.mock("@/lib/storage", () => ({ descargarDocumento: async () => Buffer.from(archivo) }));
vi.mock("@/lib/audit/account", () => ({ recordCuentaAudit: async () => {} }));
vi.mock("@/lib/ops/events", () => ({ recordOpsEvent: async () => {} }));
vi.mock("@/lib/parsers/adapter-store", () => ({
  upsertManualAdapter: async (a: Record<string, unknown>) => { upserts.push(a); return "ad-1"; },
  adapterDelDocumento: async () => null,
  getAdapterByFingerprint: async () => adapterCache,
  getAdaptersConfirmadosEmpresa: async () => [],
  saveAdapter: async () => null,
  reusarAdapterPropio: async () => null,
  adapterPropioMismoMapa: async () => null,
  promoverMapaGlobalSiHayConsenso: async () => false,
  incrementAdapterSuccess: async () => {},
  decrementAdapterConfianza: async () => {},
  confirmarAdapter: async () => {},
  logParserEvent: async () => {},
}));

/** PDF que CUADRA por saldo; `enc` = encabezado (sin marca de banco por defecto). */
async function pdf(enc: string[] = ["Movimientos"]) {
  const { jsPDF } = await import("jspdf");
  const d = new jsPDF({ unit: "pt", format: "a4" }); d.setFontSize(8);
  enc.forEach((t, k) => d.text(t, 40, 30 + k * 12));
  const y0 = 30 + enc.length * 12;
  d.text("Saldo anterior", 40, y0 + 4); d.text("$ 1.000.000", 140, y0 + 4);
  ["Fecha", "Descripción", "Cargos", "Abonos", "Saldo"].forEach((x, i) => d.text(x, [40, 110, 330, 400, 470][i], y0 + 30));
  let s = 1_000_000;
  for (let i = 0; i < 10; i++) {
    const m = 50_000 + i * 1_370; const c = i % 2 === 0; s += c ? -m : m;
    [`${String(1 + i).padStart(2, "0")}/09/2026`, `Movimiento ${i}`, c ? `$ ${m.toLocaleString("es-CL")}` : "", c ? "" : `$ ${m.toLocaleString("es-CL")}`, `$ ${s.toLocaleString("es-CL")}`]
      .forEach((t, k) => t && d.text(t, [40, 110, 330, 400, 470][k], y0 + 44 + i * 13));
  }
  return new Uint8Array(d.output("arraybuffer"));
}
const usar = (u: Uint8Array) => { archivo = u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength) as ArrayBuffer; ruta = `p-${++n}.pdf`; };
const post = (url: string, body: unknown) => new Request(`http://localhost${url}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

/** El mapa con que el lector leyó el PDF (lo que el popup propone). */
async function mapaDe(u: Uint8Array): Promise<AdapterConfig> {
  const { parsePdfCartola } = await import("@/lib/parsers");
  const r = await parsePdfCartola(u);
  return r!.censo!.mapa!.config as AdapterConfig;
}

beforeEach(() => {
  upserts.length = 0;
  adapterCache = null;
  vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 200 })));
});

describe("popup con un PDF sin marca de banco (A2)", () => {
  it("/resumen: nunca «comprobada» aunque cuadre; avisa sinMarcaBanco con el motivo", async () => {
    const u = await pdf(); usar(u);
    const { POST } = await import("./resumen/route");
    const j = await (await POST(post("/api/parser/resumen", { documento_id: "doc-1", config: await mapaDe(u) }))).json();
    expect(j.valido).toBe(true);
    expect(j.estado).not.toBe("comprobada");
    expect(j.sinMarcaBanco).toBe(true);
    expect(j.motivo).toMatch(/no dice de qué banco es/);
  });
  it("/resumen: el mismo PDF CON «Banco de Chile» en el encabezado sí queda comprobado", async () => {
    const u = await pdf(["Banco de Chile", "Movimientos"]); usar(u);
    const { POST } = await import("./resumen/route");
    const j = await (await POST(post("/api/parser/resumen", { documento_id: "doc-1", config: await mapaDe(u) }))).json();
    expect(j.estado).toBe("comprobada");
    expect(j.sinMarcaBanco).toBeUndefined();
  });
  it("/save-mapping: sin la respuesta «Sí, es mi cartola» → 422 y no guarda", async () => {
    const u = await pdf(); usar(u);
    const { POST } = await import("./save-mapping/route");
    const res = await POST(post("/api/parser/save-mapping", { documento_id: "doc-1", config: await mapaDe(u) }));
    expect(res.status).toBe(422);
    expect((await res.json()).pregunta_banco).toBe(true);
    expect(upserts).toHaveLength(0);
  });
  it("/save-mapping con es_banco → guarda revision_cliente.es_banco en el mapa del cliente", async () => {
    const u = await pdf(); usar(u);
    const { POST } = await import("./save-mapping/route");
    const res = await POST(post("/api/parser/save-mapping", { documento_id: "doc-1", config: await mapaDe(u), es_banco: true }));
    expect(res.status).toBe(200);
    expect(upserts[0]).toMatchObject({ empresaId: EMPRESA, config: { revision_cliente: { documento_id: "doc-1", es_banco: true } } });
  });
  it("/no-es-cartola → guarda no_es_cartola en el mapa del cliente y reprocesa", async () => {
    const u = await pdf(); usar(u);
    const { POST } = await import("./no-es-cartola/route");
    const res = await POST(post("/api/parser/no-es-cartola", { documento_id: "doc-1", config: await mapaDe(u) }));
    expect(res.status).toBe(200);
    expect(upserts[0]).toMatchObject({ empresaId: EMPRESA, config: { revision_cliente: { no_es_cartola: true } } });
  });
  it("/no-es-cartola sobre un PDF CON marca de banco → 422", async () => {
    const u = await pdf(["Banco de Chile", "Movimientos"]); usar(u);
    const { POST } = await import("./no-es-cartola/route");
    expect((await POST(post("/api/parser/no-es-cartola", { documento_id: "doc-1", config: await mapaDe(u) }))).status).toBe(422);
  });
});

describe("la respuesta del cliente vale para los siguientes PDFs de su formato (M1)", () => {
  const propio = (cfg: AdapterConfig, rev: Record<string, unknown>, empresa = EMPRESA) => ({
    id: "ad-propio", fingerprint: "x", source: "manual", estado: "confirmado", confirmado_por: "cliente", confianza: 1,
    creado_por_empresa_id: empresa, config: { ...cfg, revision_cliente: { documento_id: "doc-viejo", firma: "", ...rev } },
  });
  it("«Sí, es mi cartola» (otro documento, misma empresa) → el PDF del mes siguiente sella por saldo", async () => {
    const u = await pdf();
    const cfg = await mapaDe(u);
    adapterCache = propio(cfg, { es_banco: true });
    const { parsePdfCartola } = await import("@/lib/parsers");
    const r = await parsePdfCartola(u, { empresa_id: EMPRESA, documento_id: "doc-nuevo" });
    expect(r?.censo?.verificacion?.tipo).toBe("saldo");
  });
  it("la confirmación de OTRA empresa no vale", async () => {
    const u = await pdf();
    const cfg = await mapaDe(u);
    adapterCache = propio(cfg, { es_banco: true }, "otra-empresa");
    const { parsePdfCartola } = await import("@/lib/parsers");
    const r = await parsePdfCartola(u, { empresa_id: EMPRESA, documento_id: "doc-nuevo" });
    expect(r?.censo?.verificacion?.tipo).not.toBe("saldo");
  });
  it("«No es una cartola» → el lector no lo lee (null: flujo de texto de antes)", async () => {
    const u = await pdf();
    const cfg = await mapaDe(u);
    adapterCache = propio(cfg, { no_es_cartola: true });
    const { parsePdfCartola } = await import("@/lib/parsers");
    expect(await parsePdfCartola(u, { empresa_id: EMPRESA, documento_id: "doc-nuevo" })).toBeNull();
  });
});

describe("el popup no vuelve a preguntar lo que el cliente ya respondió", () => {
  const confirmado = (cfg: AdapterConfig, empresa = EMPRESA) => ({
    id: "ad-propio", fingerprint: "x", source: "manual", estado: "confirmado", confirmado_por: "cliente", confianza: 1,
    creado_por_empresa_id: empresa, config: { ...cfg, revision_cliente: { documento_id: "doc-viejo", firma: "", es_banco: true } },
  });
  it("/resumen y /preview: formato ya confirmado «es de mi banco» → sin pregunta y comprobada", async () => {
    const u = await pdf(); usar(u);
    const cfg = await mapaDe(u);
    adapterCache = confirmado(cfg);
    const { POST } = await import("./resumen/route");
    const j = await (await POST(post("/api/parser/resumen", { documento_id: "doc-1", config: cfg }))).json();
    expect(j.sinMarcaBanco).toBeUndefined();
    expect(j.estado).toBe("comprobada");
    const prev = await import("./preview/route");
    const p = await (await prev.POST(post("/api/parser/preview", { documento_id: "doc-1" }))).json();
    expect(p.sinMarcaBanco).toBeUndefined();
  });
  it("/preview: sin confirmación → sinMarcaBanco (la pregunta aparece)", async () => {
    const u = await pdf(); usar(u);
    const prev = await import("./preview/route");
    const p = await (await prev.POST(post("/api/parser/preview", { documento_id: "doc-1" }))).json();
    expect(p.sinMarcaBanco).toBe(true);
  });
  it("/save-mapping: ya confirmado → guarda sin preguntar y la confirmación viaja al mapa", async () => {
    const u = await pdf(); usar(u);
    const cfg = await mapaDe(u);
    adapterCache = confirmado(cfg);
    const { POST } = await import("./save-mapping/route");
    const res = await POST(post("/api/parser/save-mapping", { documento_id: "doc-1", config: cfg }));
    expect(res.status).toBe(200);
    expect(upserts[0]).toMatchObject({ config: { revision_cliente: { documento_id: "doc-1", es_banco: true } } });
  });
  it("la confirmación de OTRA empresa no salta la pregunta", async () => {
    const u = await pdf(); usar(u);
    const cfg = await mapaDe(u);
    adapterCache = confirmado(cfg, "otra-empresa");
    const { POST } = await import("./resumen/route");
    expect((await (await POST(post("/api/parser/resumen", { documento_id: "doc-1", config: cfg }))).json()).sinMarcaBanco).toBe(true);
  });
});

describe("evento pdf_ruta (B1)", () => {
  it("marca_banco es campo propio del evento", async () => {
    const { leerCartolaPdf } = await import("@/lib/document-processing/cartola-pdf");
    const eventos: { metadata: Record<string, unknown> }[] = [];
    await leerCartolaPdf({
      pdf: new Uint8Array(), documento_id: "d", empresa_id: EMPRESA,
      parse: async (_p, o) => { o.diagnostico({ tipo: "cartola", motivo: "senales_cartola", senales: [], marca_banco: null, paginas: 1, ms: 1 }); return null; },
      registrar: async (e) => { eventos.push(e); },
    });
    expect(eventos[0].metadata).toHaveProperty("marca_banco", null);
  });
});
