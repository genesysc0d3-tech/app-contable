import { describe, expect, it } from "vitest";
import {
  MARGEN_ADOPCION_MS,
  NO_SALIO_FIN_TRAS_MS,
  adopcionDeOrigen,
  decidirAdopcion,
  interpretarVerificacion,
  jobAdoptadoDeOrigen,
  origenAdopcion,
  validarVeredictoNoSalio,
  verificableEnAMedias,
  type JobAdoptable,
  type JobVerificacion,
} from "./adopcion";

// 28-sep-2026, 15:00 Chile (UTC−3) = 18:00Z. Job de 15 min: 14:40 → 14:55 Chile.
const CREADO = "2026-09-28T17:40:00Z";
const VENCE = "2026-09-28T17:55:00Z";
const venceMs = Date.parse(VENCE);
const viejo: JobAdoptable = {
  job_id: "server:sii_local:viejo",
  estado: "running",
  propuesta_id: "prop-1",
  usuario_id: "u1",
  cuenta_id: "c1",
  empresa_id: "e1",
  created_at: CREADO,
  expires_at: VENCE,
};
const pedido = { userId: "u1", cuentaId: "c1", empresaId: "e1", propuestaId: "prop-1" };

describe("decidirAdopcion — B1: nunca un job que puede estar vivo", () => {
  it("job VIVO de 1 min → rechazo (EMISION_EN_CURSO_PROPIA)", () => {
    const vivo = { ...viejo, created_at: "2026-09-28T17:59:00Z", expires_at: "2026-09-28T18:14:00Z" };
    const d = decidirAdopcion({ ...pedido, job: vivo, ahora: new Date("2026-09-28T18:00:00Z") });
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.code).toBe("EMISION_EN_CURSO_PROPIA");
  });
  it("vencido hace +1 min → rechazo (el worker del SII pudo seguir), y dice desde cuándo", () => {
    const d = decidirAdopcion({ ...pedido, job: viejo, ahora: new Date(venceMs + 60_000) });
    expect(d.ok).toBe(false);
    if (!d.ok) {
      expect(d.code).toBe("EMISION_EN_CURSO_PROPIA");
      expect(d.libreDesde).toBe(new Date(venceMs + MARGEN_ADOPCION_MS).toISOString());
    }
  });
  it("vencido hace +3 min → ok: ventana created_at → expires_at, fecha Chile del intento", () => {
    const ahora = new Date(venceMs + 3 * 60_000);
    const d = decidirAdopcion({ ...pedido, job: viejo, ahora });
    expect(d).toEqual({
      ok: true,
      jobViejoId: viejo.job_id,
      ventana: { desde_ms: Date.parse(CREADO), hasta_ms: venceMs },
      fechaIntento: "2026-09-28",
      via: "vencido",
    });
  });
  it("otro usuario de OTRA cuenta → rechazo, aunque esté vencido", () => {
    const ajeno = { ...viejo, usuario_id: "u9", cuenta_id: "c9", empresa_id: "e9" };
    const d = decidirAdopcion({ ...pedido, job: ajeno, ahora: new Date(venceMs + 10 * 60_000) });
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.code).toBe("JOB_AJENO");
  });
  it("otra persona de la MISMA cuenta (equipo, rol de emisión) → ok si venció", () => {
    const d = decidirAdopcion({ ...pedido, userId: "u2", job: viejo, ahora: new Date(venceMs + 3 * 60_000) });
    expect(d.ok).toBe(true);
  });
  it("misma cuenta pero OTRA empresa → rechazo", () => {
    const d = decidirAdopcion({ ...pedido, empresaId: "e2", job: viejo, ahora: new Date(venceMs + 3 * 60_000) });
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.code).toBe("JOB_AJENO");
  });
  it("otra propuesta → rechazo", () => {
    const d = decidirAdopcion({ ...pedido, propuestaId: "prop-2", job: viejo, ahora: new Date(venceMs + 3 * 60_000) });
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.code).toBe("PROPUESTA_DISTINTA");
  });
  it("job cerrado (completed / failed / revision_pendiente) → no adoptable", () => {
    for (const estado of ["completed", "failed", "cancelled", "revision_pendiente"]) {
      const d = decidirAdopcion({ ...pedido, job: { ...viejo, estado }, ahora: new Date(venceMs + 3 * 60_000) });
      expect(d.ok).toBe(false);
      if (!d.ok) expect(d.code).toBe("NO_ADOPTABLE");
    }
  });
  it("job anterior al corte de lápidas (no protege) → no se adopta por vencido", () => {
    const antiguo = { ...viejo, created_at: "2026-09-27T20:00:00Z", expires_at: "2026-09-27T20:15:00Z" };
    const d = decidirAdopcion({ ...pedido, job: antiguo, ahora: new Date("2026-09-27T21:00:00Z") });
    expect(d.ok).toBe(false);
  });
  it("intento de AYER → OTRO_DIA (/reportes solo muestra hoy)", () => {
    const ayer = { ...viejo, created_at: "2026-09-28T02:37:07Z", expires_at: "2026-09-28T02:52:07Z" }; // 27-sep 23:37 Chile
    const d = decidirAdopcion({ ...pedido, job: ayer, ahora: new Date("2026-09-28T12:00:00Z") });
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.code).toBe("OTRO_DIA");
  });
  it("fin confirmado por la extensión (mismo usuario) → ok aunque siga vivo; ventana hasta AHORA", () => {
    const ahora = new Date("2026-09-28T17:45:00Z");
    const d = decidirAdopcion({ ...pedido, job: viejo, finConfirmado: true, ahora });
    expect(d).toMatchObject({ ok: true, via: "fin_confirmado", ventana: { desde_ms: Date.parse(CREADO), hasta_ms: ahora.getTime() } });
  });
  it("fin confirmado lo afirma OTRA persona → rechazo (no fue su navegador)", () => {
    const d = decidirAdopcion({ ...pedido, userId: "u2", job: viejo, finConfirmado: true, ahora: new Date("2026-09-28T17:45:00Z") });
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.code).toBe("JOB_DE_OTRA_PERSONA");
  });
  it("ventana con tope de 30 min", () => {
    const largo = { ...viejo, created_at: "2026-09-28T16:00:00Z" };
    const d = decidirAdopcion({ ...pedido, job: largo, ahora: new Date(venceMs + 3 * 60_000) });
    expect(d.ok && d.ventana.hasta_ms - d.ventana.desde_ms).toBe(30 * 60_000);
  });
  it("sin job → 404", () => {
    const d = decidirAdopcion({ ...pedido, job: null, ahora: new Date() });
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.status).toBe(404);
  });
});

describe("origen de la verificación: el enlace nace con el job", () => {
  it("ida y vuelta", () => {
    expect(jobAdoptadoDeOrigen(origenAdopcion("server:sii_local:abc", "vencido"))).toBe("server:sii_local:abc");
    expect(adopcionDeOrigen(origenAdopcion("server:sii_local:abc", "fin_confirmado"))).toEqual({ jobId: "server:sii_local:abc", via: "fin_confirmado" });
    expect(adopcionDeOrigen(origenAdopcion("server:sii_local:abc", "vencido"))).toEqual({ jobId: "server:sii_local:abc", via: "vencido" });
  });
  it("un origin cualquiera no es adopción", () => {
    expect(jobAdoptadoDeOrigen("verificacion_lote")).toBeNull();
    expect(jobAdoptadoDeOrigen("emision_lote")).toBeNull();
    expect(jobAdoptadoDeOrigen("verificacion_adopta:")).toBeNull();
    expect(jobAdoptadoDeOrigen("verificacion_adopta:server:sii_local:abc")).toBeNull(); // sin vía: no vale
    expect(jobAdoptadoDeOrigen(null)).toBeNull();
  });
});

describe("interpretarVerificacion — una línea para la clienta", () => {
  const ventana = { desde_ms: Date.parse(CREADO), hasta_ms: venceMs };
  it("emitida → emitida", () => {
    expect(interpretarVerificacion({ desenlace: "emitida", fechaIntento: "2026-09-28", ventana, ahoraMs: venceMs + 3 * 60_000 })).toBe("emitida");
  });
  it("no salió el mismo día → no_salio", () => {
    expect(interpretarVerificacion({ desenlace: "no_salio", fechaIntento: "2026-09-28", ventana, ahoraMs: venceMs + 3 * 60_000 })).toBe("no_salio");
  });
  it("'no la encontré' con intento de AYER → a medias (nunca re-emitible)", () => {
    const ayer = { desde_ms: Date.parse("2026-09-28T02:37:07Z"), hasta_ms: Date.parse("2026-09-28T02:52:07Z") };
    expect(interpretarVerificacion({ desenlace: "no_salio", fechaIntento: "2026-09-27", ventana: ayer, ahoraMs: Date.parse("2026-09-28T12:00:00Z") })).toBe("a_medias");
  });
  it("revisar → a medias", () => {
    expect(interpretarVerificacion({ desenlace: "revisar", fechaIntento: "2026-09-28", ventana, ahoraMs: venceMs + 3 * 60_000 })).toBe("a_medias");
  });
});

describe("validarVeredictoNoSalio — el server baja la lápida SOLO con este veredicto", () => {
  // Vía vencido: el veredicto recién vale con expires_at + 30 min (misma vara que la
  // declaración humana).
  const ahora = new Date(venceMs + 31 * 60_000);
  const verif: JobVerificacion = {
    job_id: "server:sii_local:verif",
    estado: "running",
    origin: origenAdopcion(viejo.job_id, "vencido"),
    propuesta_id: "prop-1",
    usuario_id: "u1",
    cuenta_id: "c1",
    empresa_id: "e1",
    created_at: new Date(venceMs + 30 * 60_000).toISOString(),
    expires_at: new Date(venceMs + 45 * 60_000).toISOString(),
  };
  it("verificación propia, abierta, que adoptó a ese job, mismo día → ok", () => {
    expect(validarVeredictoNoSalio({ verificacion: verif, viejo, userId: "u1", ahora })).toEqual({ ok: true });
  });
  it("un job cualquiera (no de verificación) no puede cerrar lápidas", () => {
    const r = validarVeredictoNoSalio({ verificacion: { ...verif, origin: "emision_lote" }, viejo, userId: "u1", ahora });
    expect(r).toMatchObject({ ok: false, code: "NO_ES_VERIFICACION" });
  });
  it("verificación que adoptó OTRO job → rechazo", () => {
    const r = validarVeredictoNoSalio({ verificacion: { ...verif, origin: origenAdopcion("otro", "vencido") }, viejo, userId: "u1", ahora });
    expect(r.ok).toBe(false);
  });
  it("verificación de otra persona → rechazo", () => {
    expect(validarVeredictoNoSalio({ verificacion: verif, viejo, userId: "u2", ahora }).ok).toBe(false);
  });
  it("verificación ya cerrada → rechazo", () => {
    expect(validarVeredictoNoSalio({ verificacion: { ...verif, estado: "failed" }, viejo, userId: "u1", ahora }).ok).toBe(false);
  });
  it("job viejo ya registrado o sellado → rechazo", () => {
    for (const estado of ["completed", "revision_pendiente", "failed"]) {
      expect(validarVeredictoNoSalio({ verificacion: verif, viejo: { ...viejo, estado }, userId: "u1", ahora }).ok).toBe(false);
    }
  });
  it("propuesta distinta → rechazo", () => {
    expect(validarVeredictoNoSalio({ verificacion: { ...verif, propuesta_id: "prop-2" }, viejo, userId: "u1", ahora }).ok).toBe(false);
  });
  it("intento de ayer, veredicto de hoy → rechazo (medianoche)", () => {
    const ayer = { ...viejo, created_at: "2026-09-28T02:37:07Z", expires_at: "2026-09-28T02:52:07Z" };
    const r = validarVeredictoNoSalio({ verificacion: verif, viejo: ayer, userId: "u1", ahora });
    expect(r).toMatchObject({ ok: false, code: "OTRO_DIA" });
  });
});

describe("B1 del veredicto: leer a +2 min, devolver a Listas recién con plazo", () => {
  const verifTemprana: JobVerificacion = {
    job_id: "server:sii_local:verif",
    estado: "running",
    origin: origenAdopcion(viejo.job_id, "vencido"),
    propuesta_id: "prop-1",
    usuario_id: "u1",
    cuenta_id: "c1",
    empresa_id: "e1",
    created_at: new Date(venceMs + 3 * 60_000).toISOString(),
    expires_at: new Date(venceMs + 18 * 60_000).toISOString(),
  };
  it("vía vencido, 'no salió' a +4 min → MUY_PRONTO, desde expires_at + 30 min", () => {
    const r = validarVeredictoNoSalio({ verificacion: verifTemprana, viejo, userId: "u1", ahora: new Date(venceMs + 4 * 60_000) });
    expect(r).toEqual({ ok: false, code: "MUY_PRONTO", detalle: expect.any(String), desdeMs: venceMs + 30 * 60_000 });
  });
  it("vía vencido, a +29 min → todavía MUY_PRONTO", () => {
    const r = validarVeredictoNoSalio({ verificacion: { ...verifTemprana, created_at: new Date(venceMs + 28 * 60_000).toISOString(), expires_at: new Date(venceMs + 43 * 60_000).toISOString() }, viejo, userId: "u1", ahora: new Date(venceMs + 29 * 60_000) });
    expect(r).toMatchObject({ ok: false, code: "MUY_PRONTO" });
  });
  const verifFin: JobVerificacion = {
    ...verifTemprana,
    origin: origenAdopcion(viejo.job_id, "fin_confirmado"),
    created_at: "2026-09-28T17:44:00Z",
    expires_at: "2026-09-28T17:59:00Z",
  };
  it("vía fin confirmado, 'no salió' a 5 min del intento → MUY_PRONTO (desde created_at + 10 min)", () => {
    const r = validarVeredictoNoSalio({ verificacion: verifFin, viejo, userId: "u1", ahora: new Date("2026-09-28T17:45:00Z") });
    expect(r).toMatchObject({ ok: false, code: "MUY_PRONTO", desdeMs: Date.parse(CREADO) + NO_SALIO_FIN_TRAS_MS });
  });
  it("vía fin confirmado, a 11 min del intento → ok", () => {
    const r = validarVeredictoNoSalio({ verificacion: verifFin, viejo, userId: "u1", ahora: new Date("2026-09-28T17:51:00Z") });
    expect(r).toEqual({ ok: true });
  });
  it("vía fin: un latido reciente del intento corre el plazo", () => {
    const conLatido = { ...viejo, heartbeat_at: "2026-09-28T17:48:00Z" };
    const r = validarVeredictoNoSalio({ verificacion: verifFin, viejo: conLatido, userId: "u1", ahora: new Date("2026-09-28T17:51:00Z") });
    expect(r).toMatchObject({ ok: false, code: "MUY_PRONTO", desdeMs: Date.parse("2026-09-28T17:58:00Z") });
  });
});

describe("verificableEnAMedias — el botón solo donde sirve", () => {
  const it0 = { motivo: "sin_respuesta" as const, tipo_dte: 41, lapida_at: CREADO, expires_at: VENCE };
  it("sin respuesta de hoy, vencida hace 31 min → botón", () => {
    expect(verificableEnAMedias(it0, new Date(venceMs + 31 * 60_000))).toBe("ya");
  });
  it("vencida hace 3 min → todavía no: el botón espera el plazo del 'no salió' (expires_at + 30 min)", () => {
    expect(verificableEnAMedias(it0, new Date(venceMs + 3 * 60_000))).toEqual({ desdeMs: venceMs + 30 * 60_000 });
    expect(verificableEnAMedias(it0, new Date(venceMs + 60_000))).toEqual({ desdeMs: venceMs + 30 * 60_000 });
  });
  it("de AYER → no aparece (/reportes muestra solo hoy)", () => {
    expect(verificableEnAMedias({ ...it0, lapida_at: "2026-09-28T02:37:07Z", expires_at: "2026-09-28T02:52:07Z" }, new Date("2026-09-28T12:00:00Z"))).toBe("no");
  });
  it("a medias (revision_pendiente) o factura → no aparece", () => {
    expect(verificableEnAMedias({ ...it0, motivo: "a_medias" }, new Date(venceMs + 3 * 60_000))).toBe("no");
    expect(verificableEnAMedias({ ...it0, tipo_dte: 33 }, new Date(venceMs + 3 * 60_000))).toBe("no");
  });
});
