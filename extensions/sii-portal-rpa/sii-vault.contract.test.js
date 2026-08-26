// PRUEBA SINTÉTICA del flujo "Conectar clave del SII" (bóveda v2 envelope).
//
// Carga el módulo REAL sii-vault.js contra chrome/fetch falsos y simula el
// camino completo que recorre un cliente de beta: conectar la clave en un
// Chrome recién abierto, sin sesión, con campos malos, y el round-trip
// criptográfico entero (cifrar → guardar → desbloquear → leer credenciales).
// Nació del incidente 2026-08-12: APP_ORIGIN_DESCONOCIDO con la clienta —
// este arnés lo habría cazado antes de empaquetar el zip.
import { describe, it, expect, beforeEach } from "vitest";

const PROD_ORIGIN = "https://app.massdte.cl"; // 0.1.7: dominio oficial (mudanza 2026-08-20)
const RUT_PERSONA = "11.111.111-1"; // DV válido (módulo 11)
const RUT_EMPRESA = "78.366.835-1"; // DV válido

// ── Fakes de chrome.storage (MV3, API de promesas) y fetch ──────────────────
function storageArea(store) {
  return {
    async get(key) {
      const keys = Array.isArray(key) ? key : [key];
      const out = {};
      for (const k of keys) if (store.has(k)) out[k] = store.get(k);
      return out;
    },
    async set(obj) { for (const [k, v] of Object.entries(obj)) store.set(k, v); },
    async remove(key) { store.delete(key); },
  };
}

const localStore = new Map();
const sessionStore = new Map();
const fetches = [];
// Respuesta programable del servidor /api/extension/vault-key
let serverImpl = null;

globalThis.chrome = {
  storage: {
    local: storageArea(localStore),
    session: storageArea(sessionStore),
  },
};
globalThis.fetch = async (url, opts) => {
  fetches.push({ url, opts });
  const r = serverImpl ? serverImpl(url, opts) : { status: 200, body: { ok: true } };
  return {
    ok: r.status >= 200 && r.status < 300,
    status: r.status,
    json: async () => r.body,
  };
};

const vault = await import("./modules/sii-vault.js");

// WS estable de 32 bytes (la mitad del servidor)
const WS_B64 = Buffer.from(new Uint8Array(32).fill(7)).toString("base64");
const USER_ID = "user-sintetico-1";

function servidorOk() {
  serverImpl = (url, opts) => {
    const body = JSON.parse(opts.body);
    if (body.action === "register" || body.action === "get") {
      return { status: 200, body: { ok: true, user_id: USER_ID, ws: WS_B64 } };
    }
    return { status: 200, body: { ok: true } };
  };
}

const PAYLOAD = { rut: RUT_PERSONA, clave: "clave-secreta-sii", empresa_rut: RUT_EMPRESA };

beforeEach(() => {
  localStore.clear();
  sessionStore.clear();
  fetches.length = 0;
  servidorOk();
});

describe("conectar clave — Chrome recién abierto (regresión APP_ORIGIN_DESCONOCIDO)", () => {
  it("sin origen aprendido ni pestaña de la app, conecta igual usando producción", async () => {
    const r = await vault.handleSiiVaultMessage({ type: "APP_CONTABLE_SII_VAULT_SAVE", payload: PAYLOAD });
    expect(r.ok).toBe(true);
    expect(fetches[0].url.startsWith(`${PROD_ORIGIN}/api/extension/vault-key`)).toBe(true);
    expect(r.status.configured).toBe(true);
    expect(r.status.has_rut).toBe(true);
    expect(r.status.has_clave).toBe(true);
  });

  it("si aprendió un origen (dev/localhost), ese gana sobre el fallback", async () => {
    await vault.rememberAppOrigin("http://localhost:3000");
    const r = await vault.handleSiiVaultMessage({ type: "APP_CONTABLE_SII_VAULT_SAVE", payload: PAYLOAD });
    expect(r.ok).toBe(true);
    expect(fetches[0].url.startsWith("http://localhost:3000/")).toBe(true);
  });
});

describe("conectar clave — errores con causa real", () => {
  it("servidor 401 (sin sesión de la app) → SESSION_EXPIRED, no un código críptico", async () => {
    serverImpl = () => ({ status: 401, body: { ok: false, error: "NO_AUTH" } });
    const r = await vault.handleSiiVaultMessage({ type: "APP_CONTABLE_SII_VAULT_SAVE", payload: PAYLOAD });
    expect(r.ok).toBe(false);
    expect(r.error).toBe("SESSION_EXPIRED");
  });

  it("RUT de empresa vacío → OK (0.1.8: la app es la fuente única del emisor)", async () => {
    const r = await vault.handleSiiVaultMessage({
      type: "APP_CONTABLE_SII_VAULT_SAVE",
      payload: { ...PAYLOAD, empresa_rut: "  " },
    });
    // 0.1.8: el campo desapareció de la UI; vacío o ausente ya no es error.
    expect(r.error).not.toBe("EMPRESA_RUT_REQUIRED");
  });

  it("RUT de empresa con dígito verificador malo → EMPRESA_RUT_INVALID", async () => {
    const r = await vault.handleSiiVaultMessage({
      type: "APP_CONTABLE_SII_VAULT_SAVE",
      payload: { ...PAYLOAD, empresa_rut: "78.366.835-8" },
    });
    expect(r.ok).toBe(false);
    expect(r.error).toBe("EMPRESA_RUT_INVALID");
  });
});

describe("round-trip criptográfico completo (conectar → desbloquear → emitir)", () => {
  it("las credenciales vuelven intactas tras el envelope entero", async () => {
    const save = await vault.handleSiiVaultMessage({ type: "APP_CONTABLE_SII_VAULT_SAVE", payload: PAYLOAD });
    expect(save.ok).toBe(true);

    const creds = await vault.getUnlockedSiiCredentials();
    expect(creds.ok).toBe(true);
    expect(creds.rut).toBe(RUT_PERSONA);
    expect(creds.clave).toBe("clave-secreta-sii");
  });

  it("desbloqueo sin VK cacheada re-pide WS al servidor y desenvuelve igual", async () => {
    await vault.handleSiiVaultMessage({ type: "APP_CONTABLE_SII_VAULT_SAVE", payload: PAYLOAD });
    sessionStore.delete("app_contable_sii_vk"); // simula Chrome reiniciado (cache muerta)
    sessionStore.delete("app_contable_sii_app_origin"); // y sin origen aprendido

    const creds = await vault.getUnlockedSiiCredentials();
    expect(creds.ok).toBe(true);
    expect(creds.clave).toBe("clave-secreta-sii");
    // El re-pedido de WS también salió al fallback de producción
    const getCall = fetches.find((f) => JSON.parse(f.opts.body).action === "get");
    expect(getCall.url.startsWith(`${PROD_ORIGIN}/`)).toBe(true);
  });

  it("bóveda revocada en el servidor (404) → VAULT_REVOKED", async () => {
    await vault.handleSiiVaultMessage({ type: "APP_CONTABLE_SII_VAULT_SAVE", payload: PAYLOAD });
    sessionStore.clear();
    serverImpl = () => ({ status: 404, body: { ok: false } });
    const creds = await vault.getUnlockedSiiCredentials();
    expect(creds.ok).toBe(false);
    expect(creds.error).toBe("VAULT_REVOKED");
  });

  it("otro usuario logueado en la app → VAULT_OTHER_USER (no pisa la bóveda ajena)", async () => {
    await vault.handleSiiVaultMessage({ type: "APP_CONTABLE_SII_VAULT_SAVE", payload: PAYLOAD });
    sessionStore.clear();
    serverImpl = (url, opts) => ({ status: 200, body: { ok: true, user_id: "OTRO-user", ws: WS_B64 } });
    const creds = await vault.getUnlockedSiiCredentials();
    expect(creds.ok).toBe(false);
    expect(creds.error).toBe("VAULT_OTHER_USER");
  });
});

describe("clave del certificado digital (0.2.0 — carril de facturas)", () => {
  it("round-trip CON clave del certificado: vuelve intacta y el status la declara", async () => {
    const save = await vault.handleSiiVaultMessage({
      type: "APP_CONTABLE_SII_VAULT_SAVE",
      payload: { ...PAYLOAD, clave_certificado: "clave-del-cert" },
    });
    expect(save.ok).toBe(true);
    expect(save.status.has_clave_certificado).toBe(true);

    const creds = await vault.getUnlockedSiiCredentials();
    expect(creds.ok).toBe(true);
    expect(creds.clave).toBe("clave-secreta-sii");
    expect(creds.clave_certificado).toBe("clave-del-cert");
  });

  it("vault SIN certificado (0.1.x): sigue 100% válido y la clave viene null", async () => {
    const save = await vault.handleSiiVaultMessage({ type: "APP_CONTABLE_SII_VAULT_SAVE", payload: PAYLOAD });
    expect(save.ok).toBe(true);
    expect(save.status.has_clave_certificado).toBe(false);

    const creds = await vault.getUnlockedSiiCredentials();
    expect(creds.ok).toBe(true);
    expect(creds.clave_certificado).toBe(null);
  });

  it("clave del certificado vacía → CLAVE_CERTIFICADO_INVALID (nada de estados engañosos)", async () => {
    const r = await vault.handleSiiVaultMessage({
      type: "APP_CONTABLE_SII_VAULT_SAVE",
      payload: { ...PAYLOAD, clave_certificado: "" },
    });
    expect(r.ok).toBe(false);
    expect(r.error).toBe("CLAVE_CERTIFICADO_INVALID");
  });

  it("la clave del certificado JAMÁS queda en claro en el disco", async () => {
    await vault.handleSiiVaultMessage({
      type: "APP_CONTABLE_SII_VAULT_SAVE",
      payload: { ...PAYLOAD, clave_certificado: "clave-del-cert" },
    });
    const slot = localStore.get("app_contable_sii_vault_v2");
    expect(JSON.stringify(slot)).not.toContain("clave-del-cert");
    expect(JSON.stringify(slot)).not.toContain("clave-secreta-sii");
  });

  it("la capability sii_vault_cert_password viaja en el catálogo de la bóveda", () => {
    expect(vault.SII_VAULT_CAPABILITIES).toContain("sii_vault_cert_password");
  });
});

describe("re-guardado no pierde la clave del certificado", () => {
  it("reconectar solo RUT+clave arrastra la clave del certificado ya guardada", async () => {
    await vault.handleSiiVaultMessage({
      type: "APP_CONTABLE_SII_VAULT_SAVE",
      payload: { ...PAYLOAD, clave_certificado: "clave-del-cert" },
    });
    // Segundo guardado SIN el campo (el flujo clásico de 0.1.x)
    const r = await vault.handleSiiVaultMessage({ type: "APP_CONTABLE_SII_VAULT_SAVE", payload: PAYLOAD });
    expect(r.ok).toBe(true);
    expect(r.status.has_clave_certificado).toBe(true);
    const creds = await vault.getUnlockedSiiCredentials();
    expect(creds.clave_certificado).toBe("clave-del-cert");
  });

  it("re-guardar CON una clave de certificado nueva la reemplaza", async () => {
    await vault.handleSiiVaultMessage({
      type: "APP_CONTABLE_SII_VAULT_SAVE",
      payload: { ...PAYLOAD, clave_certificado: "vieja" },
    });
    await vault.handleSiiVaultMessage({
      type: "APP_CONTABLE_SII_VAULT_SAVE",
      payload: { ...PAYLOAD, clave_certificado: "nueva" },
    });
    const creds = await vault.getUnlockedSiiCredentials();
    expect(creds.clave_certificado).toBe("nueva");
  });
});

describe("guardado de SOLO la clave del certificado (card Facturas)", () => {
  it("con bóveda conectada: reusa RUT + Clave Tributaria y agrega la clave del cert", async () => {
    await vault.handleSiiVaultMessage({ type: "APP_CONTABLE_SII_VAULT_SAVE", payload: PAYLOAD });
    const r = await vault.handleSiiVaultMessage({
      type: "APP_CONTABLE_SII_VAULT_SAVE",
      payload: { clave_certificado: "clave-cert-sola" },
    });
    expect(r.ok).toBe(true);
    expect(r.status.has_clave_certificado).toBe(true);
    const creds = await vault.getUnlockedSiiCredentials();
    expect(creds.rut).toBe(RUT_PERSONA);
    expect(creds.clave).toBe("clave-secreta-sii");
    expect(creds.clave_certificado).toBe("clave-cert-sola");
  });

  it("sin bóveda conectada → VAULT_NOT_CONFIGURED (primero la clave del SII)", async () => {
    const r = await vault.handleSiiVaultMessage({
      type: "APP_CONTABLE_SII_VAULT_SAVE",
      payload: { clave_certificado: "x" },
    });
    expect(r.ok).toBe(false);
    expect(r.error).toBe("VAULT_NOT_CONFIGURED");
  });

  it("cert-only vacía → CLAVE_CERTIFICADO_INVALID", async () => {
    const r = await vault.handleSiiVaultMessage({
      type: "APP_CONTABLE_SII_VAULT_SAVE",
      payload: { clave_certificado: "" },
    });
    expect(r.ok).toBe(false);
    expect(r.error).toBe("CLAVE_CERTIFICADO_INVALID");
  });
});
