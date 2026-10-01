/**
 * Seguridad de emisión 2026-09-30 (revisión adversarial A + B). Prueba la RUTA de
 * verdad (POST y PATCH de /api/emision/jobs) con Supabase falso:
 *  - punto 1: boleta única con una lápida viva → 409 BOLETA_A_MEDIAS (no se abre otra).
 *  - punto 2: el lote manda monto/receptor/glosa; si no calzan con la propuesta
 *    guardada → 409 DATOS_CAMBIARON, sin tomar el candado.
 *  - punto 3/5: el latido de un job que perdió el candado (otro job lo tomó, venció, o
 *    alguien lo "liberó" desde otro computador) → 409 LEASE_PERDIDO, sin renovar nada.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

type Resp = { data?: unknown; error: { message: string; code?: string } | null; count?: number | null };
type Llamada = { tabla: string; op: "select" | "update" | "delete" | "insert"; filtros: Record<string, unknown>; valores?: unknown };

const { estado } = vi.hoisted(() => ({
  estado: {
    llamadas: [] as Llamada[],
    resp: (() => ({ data: null, error: null })) as (l: Llamada) => Resp,
    acquire: vi.fn(async () => ({ ok: true, jobId: "server:sii_local:NUEVO", lockedUntil: "2026-09-30T13:00:00Z" })),
    emitible: { ok: true } as Record<string, unknown>,
  },
}));

function fakeSb() {
  return {
    rpc: async () => ({ data: null, error: null }),
    from(tabla: string) {
      const l: Llamada = { tabla, op: "select", filtros: {} };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const q: any = {};
      q.select = () => q;
      q.update = (v: unknown) => { l.op = "update"; l.valores = v; return q; };
      q.delete = () => { l.op = "delete"; return q; };
      q.insert = (v: unknown) => { l.op = "insert"; l.valores = v; return q; };
      for (const m of ["eq", "neq", "in", "is", "gte", "gt", "lt", "not", "order", "limit"]) {
        q[m] = (c: string, v: unknown) => { l.filtros[`${m}:${c}`] = v; return q; };
      }
      q.maybeSingle = () => q;
      q.single = () => q;
      q.then = (ok: (v: Resp) => unknown, ko: (e: unknown) => unknown) => {
        estado.llamadas.push(l);
        return Promise.resolve(estado.resp(l)).then(ok, ko);
      };
      return q;
    },
  };
}

vi.mock("@/lib/dev/support-mode", () => ({ getDevSupportWriteBlock: async () => null }));
vi.mock("@/lib/security/rate-limit", () => ({ enforceRateLimit: () => null, rateLimitKey: () => "k" }));
vi.mock("@/lib/ops/events", () => ({ recordOpsEvent: vi.fn(async () => undefined), recordOpsError: vi.fn(async () => undefined) }));
vi.mock("@/lib/ops/alertas", () => ({ enviarAlertaCritica: vi.fn(async () => ({ enviada: false, errores: [] })) }));
vi.mock("@/lib/ops/emision-pausas", async (orig) => ({
  ...(await orig<typeof import("@/lib/ops/emision-pausas")>()),
  pausaActivaParaEmpresa: async () => ({ pausada: false }),
}));
vi.mock("@/lib/intermediario/client", () => ({ obtenerConfigEmision: async () => ({}), providerForTipoDte: () => "sii_local" }));
vi.mock("@/lib/emission/authorizations", () => ({
  CURRENT_EMISSION_AUTHORIZATION_VERSION: "v",
  getEmissionAuthorizationStatus: async () => ({ authorized: true }),
}));
vi.mock("@/lib/emission/propuesta-emitible", () => ({
  revisarPropuestaEmitible: async () => estado.emitible,
  revisarPostCandado: async () => ({ ok: true }),
  revisarYaEmitida: async () => ({ ok: true }),
}));
vi.mock("@/lib/pagos/metering", () => ({ verificarEmisionMasiva: async () => ({ ok: true }) }));
vi.mock("@/lib/emission/locks", async (orig) => ({
  ...(await orig<typeof import("@/lib/emission/locks")>()),
  acquireCuentaEmissionLock: estado.acquire,
  releaseCuentaEmissionLock: vi.fn(async () => undefined),
}));
vi.mock("@/lib/api/account-guard", () => ({
  requireAccountApiAccess: async () => ({ ok: true, userId: "U1", cuentaId: "C1", empresaId: "E1", plan: null, service: fakeSb() }),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: { id: "U1" } } }) } }),
}));
vi.mock("@supabase/supabase-js", () => ({ createClient: () => fakeSb() }));

process.env.NEXT_PUBLIC_SUPABASE_URL = "http://x";
process.env.SUPABASE_SERVICE_ROLE_KEY = "k";

import { PATCH, POST } from "./route";

const PROP = "11111111-1111-4111-8111-111111111111";
const propuesta = {
  id: PROP, empresa_id: "E1", estado: "aprobado", mesa: "boleta", tipo_dte: 41, total: 10000,
  notas: null, detalle: null, receptor_rut: null, clientes: null,
  movimientos_raw: { monto: 10000, documentos_subidos: { glosa_comun: null, glosa_activa: false } },
};

function req(method: string, body: unknown) {
  return new Request("http://x/api/emision/jobs", { method, body: JSON.stringify(body) });
}

function escenario(over: (l: Llamada) => Resp | undefined = () => undefined) {
  estado.resp = (l) => {
    const o = over(l);
    if (o) return o;
    if (l.tabla === "empresas") return { data: { rut: "11.111.111-1", tipo_contribuyente: "exento", boletas_tipo_default: null, facturas_tipo_default: null }, error: null };
    if (l.tabla === "propuestas_ia") return { data: propuesta, error: null };
    if (l.tabla === "emision_jobs" && l.op === "select") return { data: [], error: null };
    if (l.tabla === "boletas_emitidas") return { data: [], error: null };
    return { data: null, error: null };
  };
}

beforeEach(() => {
  estado.llamadas = [];
  estado.acquire.mockClear();
  estado.emitible = { ok: true };
  escenario();
});

describe("POST /api/emision/jobs — el servidor manda en los datos (punto 2)", () => {
  const lote = (datos?: unknown) => ({ provider: "sii_local", tipo_dte: 41, origin: "emision_lote", propuesta_id: PROP, ...(datos === undefined ? {} : { datos }) });

  it("los mismos datos que la propuesta guardada → abre el job", async () => {
    const res = await POST(req("POST", lote({ monto: 10000, receptor_rut: null, glosa: "Venta exenta" })));
    expect(res.status).toBe(200);
    expect(estado.acquire).toHaveBeenCalledTimes(1);
  });

  it("monto viejo de la caché → 409 DATOS_CAMBIARON y NO toma el candado", async () => {
    const res = await POST(req("POST", lote({ monto: 9000, receptor_rut: null, glosa: "Venta exenta" })));
    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.error).toBe("DATOS_CAMBIARON");
    expect(json.campos).toEqual(["monto"]);
    expect(estado.acquire).not.toHaveBeenCalled();
  });

  it("pestaña con JS viejo (no manda datos) → 409 DATOS_CAMBIARON (recargar)", async () => {
    const res = await POST(req("POST", lote()));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("DATOS_CAMBIARON");
    expect(estado.acquire).not.toHaveBeenCalled();
  });
});

describe("POST /api/emision/jobs — boleta única con lápida (punto 1)", () => {
  const unica = { provider: "sii_local", tipo_dte: 41, origin: "emision_directa" };

  it("una boleta única a medias en la empresa → 409 BOLETA_A_MEDIAS, sin candado nuevo", async () => {
    escenario((l) => (l.tabla === "emision_jobs" && l.op === "select"
      ? { data: [{ job_id: "J-A-MEDIAS", estado: "revision_pendiente", propuesta_id: null, created_at: "2026-09-30T12:00:00Z" }], error: null }
      : undefined));
    const res = await POST(req("POST", unica));
    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.error).toBe("BOLETA_A_MEDIAS");
    expect(json.job_id).toBe("J-A-MEDIAS");
    expect(estado.acquire).not.toHaveBeenCalled();
  });

  it("sin lápida → abre el job normal", async () => {
    const res = await POST(req("POST", unica));
    expect(res.status).toBe(200);
    expect(estado.acquire).toHaveBeenCalledTimes(1);
  });
});

describe("PATCH /api/emision/jobs — latido con candado perdido (puntos 3 y 5)", () => {
  const job = (estadoJob: string) => ({ job_id: "J1", cuenta_id: "C1", usuario_id: "U1", estado: estadoJob, provider: "sii_local" });

  it("candado vivo y propio → renueva (200)", async () => {
    escenario((l) => {
      if (l.tabla === "emision_jobs" && l.op === "select") return { data: job("running"), error: null };
      if (l.tabla === "emision_locks" && l.op === "update") return { data: [{ job_id: "J1" }], error: null };
      return undefined;
    });
    const res = await PATCH(req("PATCH", { job_id: "J1", status: "submitting" }));
    expect(res.status).toBe(200);
    expect(estado.llamadas.some((l) => l.tabla === "emision_jobs" && l.op === "update")).toBe(true);
    const lockUpd = estado.llamadas.find((l) => l.tabla === "emision_locks" && l.op === "update");
    expect(lockUpd?.filtros["eq:job_id"]).toBe("J1");
    expect(lockUpd?.filtros["gt:locked_until"]).toBeTruthy();
  });

  it("el candado ya es de otro job o venció → 409 LEASE_PERDIDO y NO renueva el job", async () => {
    escenario((l) => {
      if (l.tabla === "emision_jobs" && l.op === "select") return { data: job("running"), error: null };
      if (l.tabla === "emision_locks" && l.op === "update") return { data: [], error: null };
      return undefined;
    });
    const res = await PATCH(req("PATCH", { job_id: "J1", status: "submitting" }));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("LEASE_PERDIDO");
    expect(estado.llamadas.some((l) => l.tabla === "emision_jobs" && l.op === "update")).toBe(false);
  });

  it("job cancelado desde otro computador ('liberar candado') → 409 LEASE_PERDIDO", async () => {
    escenario((l) => (l.tabla === "emision_jobs" && l.op === "select" ? { data: job("cancelled"), error: null } : undefined));
    const res = await PATCH(req("PATCH", { job_id: "J1", status: "sii_page_ready" }));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("LEASE_PERDIDO");
  });

  it("job completed o lápida → 200 closed (un latido tardío normal no alarma)", async () => {
    for (const e of ["completed", "revision_pendiente"]) {
      escenario((l) => (l.tabla === "emision_jobs" && l.op === "select" ? { data: job(e), error: null } : undefined));
      const res = await PATCH(req("PATCH", { job_id: "J1", status: "closed" }));
      expect(res.status).toBe(200);
      expect((await res.json()).closed).toBe(true);
    }
  });
});

// ── Revisión adversarial del fix (2026-09-30) ──
describe("POST — pestañas viejas, ya emitida primero, intento de la boleta única", () => {
  const lote = (datos?: unknown) => ({ provider: "sii_local", tipo_dte: 41, origin: "emision_lote", propuesta_id: PROP, ...(datos === undefined ? {} : { datos }) });

  it("JS viejo sin datos → code EMISION_PAUSADA + «recarga la página» (el clasificador viejo lo entiende como pausa limpia)", async () => {
    const res = await POST(req("POST", lote()));
    const json = await res.json();
    expect(res.status).toBe(409);
    expect(json.code).toBe("EMISION_PAUSADA");
    expect(json.detalle).toContain("Recarga la página");
  });

  it("ya emitida va ANTES que los datos: se salta (no frena el lote) aunque los datos difieran", async () => {
    estado.emitible = { ok: false, status: 409, error: "PROPUESTA_YA_EMITIDA", detalle: "ya", folio: 7 };
    const res = await POST(req("POST", lote({ monto: 1, receptor_rut: null, glosa: "x" })));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("PROPUESTA_YA_EMITIDA");
  });

  it("boleta única: guarda el intento (monto/tipo/receptor) en el job recién creado", async () => {
    const intento = { monto: 10000, tipo_dte: 41, receptor_rut: null, receptor_nombre: "Ana", detalle: "Clase" };
    const res = await POST(req("POST", { provider: "sii_local", tipo_dte: 41, origin: "emision_directa", intento }));
    expect(res.status).toBe(200);
    const upd = estado.llamadas.find((l) => l.tabla === "emision_jobs" && l.op === "update" && (l.valores as { intento?: unknown })?.intento);
    expect(upd?.filtros["eq:job_id"]).toBe("server:sii_local:NUEVO");
    expect((upd?.valores as { intento: unknown }).intento).toEqual(intento);
  });

  it("BOLETA_A_MEDIAS trae qué buscar en el SII y quién la lanzó", async () => {
    const intento = { monto: 10000, tipo_dte: 41, receptor_rut: null, receptor_nombre: "Ana", detalle: "Clase" };
    escenario((l) => {
      if (l.tabla === "emision_jobs" && l.op === "select") return { data: [{ job_id: "J9", estado: "revision_pendiente", propuesta_id: null, created_at: "2026-09-30T17:05:00Z", usuario_id: "U2", intento }], error: null };
      if (l.tabla === "usuarios") return { data: { nombre: "Marge" }, error: null };
      return undefined;
    });
    const res = await POST(req("POST", { provider: "sii_local", tipo_dte: 41, origin: "emision_directa" }));
    const json = await res.json();
    expect(json.error).toBe("BOLETA_A_MEDIAS");
    expect(json.intento).toEqual(intento);
    expect(json.lanzada_por).toBe("Marge");
    expect(json.es_mia).toBe(false);
    expect(json.detalle).toContain("$10.000");
  });
});

describe("PATCH — carrera con /result (rev 2 M3)", () => {
  it("lease perdido pero el job ya quedó completed (el resultado ganó) → 200 closed, sin alarma", async () => {
    let lecturas = 0;
    escenario((l) => {
      if (l.tabla === "emision_jobs" && l.op === "select") {
        lecturas++;
        return { data: { job_id: "J1", cuenta_id: "C1", usuario_id: "U1", estado: lecturas === 1 ? "running" : "completed", provider: "sii_local" }, error: null };
      }
      if (l.tabla === "emision_locks" && l.op === "update") return { data: [], error: null };
      return undefined;
    });
    const res = await PATCH(req("PATCH", { job_id: "J1", status: "result_awaiting_ack" }));
    expect(res.status).toBe(200);
    expect((await res.json()).closed).toBe(true);
  });
});
