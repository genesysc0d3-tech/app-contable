import { beforeEach, describe, expect, it, vi } from "vitest";
import * as XLSX from "xlsx";
import type { AdapterConfig } from "@/lib/parsers/types";

// Popup "Revisa las columnas" (2026-09-30), lado server:
//  - /api/parser/resumen: SOLO LECTURA, archivo completo, dice si el mapa queda
//    comprobado y si el banco lo contradice (no guardable);
//  - /api/parser/save-mapping: valida lo mismo en el server (la UI puede
//    fallar), guarda el mapa como del CLIENTE y SOLO para su empresa, y deja la
//    marca de revisión de ESE documento para que el reproceso lo selle.

const EMPRESA = "emp-cliente";
let archivo: ArrayBuffer;
// Ruta del archivo en storage: cambia con cada archivo de prueba (el server guarda
// el archivo unos minutos en memoria por documento + ruta).
let ruta = "x-0.xlsx";
let nArchivo = 0;
let tipoDoc = "excel";
const eqs: [string, unknown][] = [];
const upserts: Record<string, unknown>[] = [];

function tabla(nombre: string) {
  const b: Record<string, unknown> = {};
  for (const op of ["select", "order", "limit", "not", "in"]) b[op] = () => b;
  b.eq = (col: string, val: unknown) => { eqs.push([`${nombre}.${col}`, val]); return b; };
  b.single = async () => nombre === "usuarios"
    ? { data: { empresa_id: EMPRESA, rol: "admin", vetado: false }, error: null }
    : { data: { id: "doc-1", tipo: tipoDoc, storage_provider: "supabase", storage_path: ruta, empresa_id: EMPRESA }, error: null };
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
  getAdapterByFingerprint: async () => null,
  getAdaptersConfirmadosEmpresa: async () => [],
  saveAdapter: async () => null,
  promoverMapaGlobalSiHayConsenso: async () => false,
  incrementAdapterSuccess: async () => {},
  decrementAdapterConfianza: async () => {},
  confirmarAdapter: async () => {},
  logParserEvent: async () => {},
}));

const cl = (n: number) => n.toLocaleString("es-CL");
const f = (d: number) => `${String(d).padStart(2, "0")}/09/2026`;
function libro(filas: (string | number)[][]) {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(filas), "Cartola");
  return XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
}
function conSaldo() {
  const filas: (string | number)[][] = [["Fecha", "Glosa", "Cargos", "Abonos", "Saldo"], ["", "Saldo anterior", "", "", cl(500_000)]];
  let s = 500_000;
  for (let i = 1; i <= 20; i++) { const c = i % 3 === 0; const m = 12_000 + i * 91; s += c ? -m : m; filas.push([f(i), `Mov ${i}`, c ? cl(m) : "", c ? "" : cl(m), cl(s)]); }
  return filas;
}
const bien: AdapterConfig = { header_row: 0, skip_rows_before_data: 2, date_format: "dd/mm/yyyy", number_format: "chilean", layout: "two_cols", columns: { fecha: 0, descripcion: 1, n_documento: -1, cargo: 2, abono: 3, saldo: 4 } };
const alReves: AdapterConfig = { ...bien, columns: { ...bien.columns, cargo: 3, abono: 2 } };
const post = (url: string, body: unknown) => new Request(`http://localhost${url}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

const usar = (buf: ArrayBuffer) => { archivo = buf; ruta = `x-${++nArchivo}.xlsx`; };

beforeEach(() => {
  usar(libro(conSaldo()));
  tipoDoc = "excel";
  eqs.length = 0;
  upserts.length = 0;
  vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 200 })));
});

describe("/api/parser/resumen (solo lectura)", () => {
  it("con el mapa bueno: resumen del archivo completo, comprobada y guardable", async () => {
    const { POST } = await import("./resumen/route");
    const res = await POST(post("/api/parser/resumen", { documento_id: "doc-1", config: bien }));
    expect(res.status).toBe(200);
    const j = await res.json();
    expect(j.entradas.n + j.salidas.n).toBe(20);
    expect(j.estado).toBe("comprobada");
    expect(j.guardable).toBe(true);
    // Solo lee: nada se guarda.
    expect(upserts).toHaveLength(0);
    // El documento se busca en la empresa del usuario.
    expect(eqs).toContainEqual(["documentos_subidos.empresa_id", EMPRESA]);
  });

  it("con un mapa que el banco CONTRADICE: lo dice y no es guardable", async () => {
    const { POST } = await import("./resumen/route");
    const j = await (await POST(post("/api/parser/resumen", { documento_id: "doc-1", config: alReves }))).json();
    expect(j.contradice).toBe(true);
    expect(j.guardable).toBe(false);
  });

  it("config inválido → 400", async () => {
    const { POST } = await import("./resumen/route");
    expect((await POST(post("/api/parser/resumen", { documento_id: "doc-1", config: { nada: 1 } }))).status).toBe(400);
  });
});

describe("/api/parser/save-mapping (Listo)", () => {
  it("el server rechaza un mapa que el banco contradice (aunque la UI falle): 422 y no guarda", async () => {
    const { POST } = await import("./save-mapping/route");
    const res = await POST(post("/api/parser/save-mapping", { documento_id: "doc-1", config: alReves, reprocess: true }));
    expect(res.status).toBe(422);
    expect(upserts).toHaveLength(0);
  });

  it("guarda el mapa como del CLIENTE, solo para SU empresa, con la revisión de este documento", async () => {
    const { POST } = await import("./save-mapping/route");
    const res = await POST(post("/api/parser/save-mapping", { documento_id: "doc-1", config: bien, reprocess: true }));
    expect(res.status).toBe(200);
    expect(upserts).toHaveLength(1);
    const u = upserts[0] as { empresaId: string; confirmadoPor: string; config: AdapterConfig };
    expect(u.empresaId).toBe(EMPRESA);
    expect(u.confirmadoPor).toBe("cliente");
    expect(u.config.revision_cliente?.documento_id).toBe("doc-1");
    expect(u.config.revision_cliente?.firma).toMatch(/^20\|/);
    // Nunca global: no hay forma de pedir otro dueño desde el body.
    const u2 = await POST(post("/api/parser/save-mapping", { documento_id: "doc-1", config: bien, empresa_id: "otra", global: true }));
    expect(u2.status).toBe(200);
    expect((upserts[1] as { empresaId: string }).empresaId).toBe(EMPRESA);
  });

  it("'solo abonos' solo si la cartola de verdad viene filtrada (misma regla en el server)", async () => {
    const { POST } = await import("./save-mapping/route");
    const res = await POST(post("/api/parser/save-mapping", { documento_id: "doc-1", config: bien, solo_abonos: true }));
    expect(res.status).toBe(422);
    expect(upserts).toHaveLength(0);

    let s = 1_000_000;
    const filas: (string | number)[][] = [["Fecha", "Glosa", "Cargos", "Abonos", "Saldo"]];
    for (let i = 1; i <= 20; i++) { const m = 50_000 + i * 1000; s += m; if (i % 5 === 0) s -= 30_000; filas.push([f(i), `Venta ${i}`, "", cl(m), cl(s)]); }
    usar(libro(filas));
    const ok = await POST(post("/api/parser/save-mapping", { documento_id: "doc-1", config: { ...bien, skip_rows_before_data: 1 }, solo_abonos: true }));
    expect(ok.status).toBe(200);
    expect((upserts[0] as { config: AdapterConfig }).config.revision_cliente?.solo_abonos).toBe(true);
  });
});

describe("cartola CSV (revisión adversarial 2026-09-30)", () => {
  // Un CSV pasa por el MISMO lector que el Excel (queue.ts) y su cuadre puede pedir
  // "Revisa las columnas": si las rutas del popup lo rechazan ("Solo planillas"),
  // la cartola queda con el CTA para siempre y sin Editar/Aprobar.
  const csv = () => {
    const filas = conSaldo().map((r) => r.map((c) => `"${String(c)}"`).join(";")).join("\n");
    return new TextEncoder().encode(filas).buffer as ArrayBuffer;
  };
  it("resumen, vista previa y Listo aceptan un CSV", async () => {
    tipoDoc = "csv";
    usar(csv());
    const { POST: resumen } = await import("./resumen/route");
    expect((await resumen(post("/api/parser/resumen", { documento_id: "doc-1", config: bien }))).status).toBe(200);
    const { POST: preview } = await import("./preview/route");
    expect((await preview(post("/api/parser/preview", { documento_id: "doc-1" }))).status).toBe(200);
    const { POST: guardar } = await import("./save-mapping/route");
    const res = await guardar(post("/api/parser/save-mapping", { documento_id: "doc-1", config: bien, reprocess: true }));
    expect(res.status).not.toBe(400);
  });
  it("un PDF sigue sin popup de columnas", async () => {
    tipoDoc = "pdf";
    const { POST } = await import("./save-mapping/route");
    expect((await POST(post("/api/parser/save-mapping", { documento_id: "doc-1", config: bien }))).status).toBe(400);
  });
});
