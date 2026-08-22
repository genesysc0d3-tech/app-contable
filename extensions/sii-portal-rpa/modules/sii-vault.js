"use strict";

import { isRutValido, normalizeRut } from "./rut.js";

export const SII_VAULT_CAPABILITIES = [
  "sii_vault_status",
  "sii_vault_encrypted",
  "sii_vault_envelope_v2",
  "sii_vault_session_unlock",
];

// ── Bóveda SII v2 "llave partida" (envelope encryption) ──────────────────────
// Las credenciales SII se cifran con una llave aleatoria VK. VK se envuelve bajo
// KEK = HKDF(WS, salt), donde WS (32 bytes) vive SOLO en el servidor (tabla
// extension_vault_keys) y se obtiene con la sesión de la app. Ni el disco solo
// (no tiene WS) ni el servidor solo (no tiene el ciphertext ni la Clave
// Tributaria) pueden descifrar. Adiós passphrase manual: la sesión de la app es
// lo único que desbloquea, y VK se cachea en chrome.storage.session (sobrevive la
// muerte del service worker MV3 —el bug del "10 min" falso—, se borra al cerrar
// el navegador, invisible a content scripts).
const STORAGE_KEY = "app_contable_sii_vault_v2"; // slot único, etiquetado con user_id
const LEGACY_V1_KEY = "app_contable_sii_vault_v1";
const DEVICE_ID_KEY = "app_contable_sii_device_id";
const APP_ORIGIN_KEY = "app_contable_sii_app_origin"; // último origen de app visto (session)
const VK_CACHE_KEY = "app_contable_sii_vk"; // { vk, user_id, expiresAt } en storage.session
// TTL corto: el cache existe para no re-pedir WS a cada rato, pero también acota la
// ventana ciega del kill-switch (tras revocar, la VK cacheada dejaría de servir en
// ≤ este tiempo). Con el masivo deshabilitado, las emisiones son una a una y minutos
// aparte, así que re-pedir WS cada 90s no molesta y hace la revocación casi inmediata.
const VK_TTL_MS = 90 * 1000;

// ── Identidad de dispositivo (estable por navegador, compartida entre usuarios) ─
async function ensureDeviceId() {
  const stored = await chrome.storage.local.get(DEVICE_ID_KEY);
  const existing = stored?.[DEVICE_ID_KEY];
  if (typeof existing === "string" && /^[A-Za-z0-9_-]{8,64}$/.test(existing)) return existing;
  const id = bytesToBase64Url(crypto.getRandomValues(new Uint8Array(18)));
  await chrome.storage.local.set({ [DEVICE_ID_KEY]: id });
  return id;
}

// El origen de la app (para el fetch de WS) lo aprende el background de los
// mensajes de la pestaña de la app y lo guarda acá; el setup y la emisión lo usan.
export async function rememberAppOrigin(origin) {
  if (typeof origin === "string" && /^https?:\/\//.test(origin)) {
    try { await chrome.storage.session.set({ [APP_ORIGIN_KEY]: origin }); } catch { /* best-effort */ }
  }
}
// Origen de PRODUCCIÓN de la app (el mismo del manifest). El "aprendizaje" de
// origen (rememberAppOrigin) solo importa en desarrollo (localhost); en
// producción la dirección es una sola y conocida. Sin este fallback, un Chrome
// recién abierto (storage.session vacío, sin pestaña de la app cargada) daba
// APP_ORIGIN_DESCONOCIDO aunque el usuario tuviera su sesión iniciada — y el
// mensaje mandaba a perseguir el problema equivocado (caso real de beta
// 2026-08-12). Con el fallback, si de verdad falta la sesión el servidor
// responde 401 y el usuario ve el mensaje correcto ("inicia sesión").
// 0.1.7 (mudanza 2026-08-20): el dominio oficial es app.massdte.cl; el host
// viejo quedó en 308 hacia acá, así que este fallback apunta directo al nuevo.
const PROD_APP_ORIGIN = "https://app.massdte.cl";

async function getAppOrigin(explicit) {
  if (typeof explicit === "string" && /^https?:\/\//.test(explicit)) return explicit;
  try {
    const s = await chrome.storage.session.get(APP_ORIGIN_KEY);
    const o = s?.[APP_ORIGIN_KEY];
    if (typeof o === "string" && o) return o;
  } catch { /* fall through */ }
  return PROD_APP_ORIGIN;
}

async function readSlot() {
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  const slot = stored?.[STORAGE_KEY];
  return slot && typeof slot === "object" ? slot : null;
}

export async function siiVaultStatus() {
  const slot = await readSlot();
  const meta = slot?.meta && typeof slot.meta === "object" ? slot.meta : null;
  let legacyV1 = false;
  if (!slot) {
    const legacy = await chrome.storage.local.get(LEGACY_V1_KEY);
    legacyV1 = Boolean(legacy?.[LEGACY_V1_KEY]);
  }
  return {
    configured: Boolean(meta?.configured),
    encrypted: Boolean(meta?.configured),
    has_rut: Boolean(meta?.has_rut),
    has_clave: Boolean(meta?.has_clave),
    has_empresa_rut: Boolean(meta?.has_empresa_rut),
    empresa_rut: typeof meta?.empresa_rut === "string" ? meta.empresa_rut : null,
    updated_at: typeof meta?.updated_at === "string" ? meta.updated_at : null,
    session_unlock: true, // v2: se desbloquea con la sesión de la app, sin passphrase
    needs_migration: legacyV1, // bóveda v1 antigua: pedir reconectar la clave una vez
    unlocked: await hasFreshVk(),
  };
}

export async function handleSiiVaultMessage(message, appOriginHint) {
  if (message?.type === "APP_CONTABLE_SII_VAULT_STATUS") {
    return { type: "APP_CONTABLE_SII_VAULT_STATUS_RESULT", status: await siiVaultStatus() };
  }

  if (message?.type === "APP_CONTABLE_SII_VAULT_SAVE") {
    const result = await saveSiiVault(message.payload, appOriginHint);
    return { type: "APP_CONTABLE_SII_VAULT_SAVE_RESULT", ...result, status: await siiVaultStatus() };
  }

  if (message?.type === "APP_CONTABLE_SII_VAULT_CLEAR") {
    // Borra la bóveda local Y revoca WS en el servidor (kill-switch completo).
    await clearVkCache();
    await chrome.storage.local.remove(STORAGE_KEY);
    await revokeDeviceKey(appOriginHint).catch(() => undefined);
    return { type: "APP_CONTABLE_SII_VAULT_CLEAR_RESULT", ok: true, status: await siiVaultStatus() };
  }

  // v2 no usa passphrase: el UNLOCK manual queda como no-op informativo.
  if (message?.type === "APP_CONTABLE_SII_VAULT_UNLOCK") {
    return { type: "APP_CONTABLE_SII_VAULT_UNLOCK_RESULT", ok: true, status: await siiVaultStatus() };
  }

  return null;
}

// Wipe LOCAL de la bóveda (sin tocar el servidor): lo dispara el botón "Desconectar"
// de la app DESPUÉS de revocar WS server-side. Solo BORRA datos locales (no lee
// secretos), así que no viola la frontera app↔bóveda. Deja el equipo "sin conectar".
export async function wipeLocalVault() {
  await clearVkCache();
  await chrome.storage.local.remove(STORAGE_KEY);
}

// PÚBLICO (no cifrado): RUT de empresa emisora configurado. No requiere desbloquear.
export async function getSiiEmpresaRutDefault() {
  const slot = await readSlot();
  const raw = slot?.meta?.empresa_rut;
  return typeof raw === "string" && raw ? normalizeRut(raw) : null;
}

function validatePayload(payload) {
  if (!payload || typeof payload !== "object") return "PAYLOAD_INVALID";
  if (typeof payload.rut !== "string" || !payload.rut.trim()) return "RUT_REQUIRED";
  if (typeof payload.clave !== "string" || !payload.clave) return "CLAVE_REQUIRED";
  // 0.1.8: empresa_rut ya no se pide en la UI (la app es la fuente única del
  // emisor, con RUT inmutable server-side). Se acepta si viene (vaults viejos)
  // pero solo como metadato: nada lo usa para decidir emisión.
  if (payload.empresa_rut !== undefined && payload.empresa_rut !== null) {
    if (typeof payload.empresa_rut !== "string") return "EMPRESA_RUT_INVALID";
    if (payload.empresa_rut.trim() && !isRutValido(payload.empresa_rut)) return "EMPRESA_RUT_INVALID";
  }
  return null;
}

async function saveSiiVault(payload, appOriginHint) {
  const validationError = validatePayload(payload);
  if (validationError) return { ok: false, error: validationError };

  const appOrigin = await getAppOrigin(appOriginHint);
  if (!appOrigin) return { ok: false, error: "APP_ORIGIN_DESCONOCIDO" };

  // 1) Registrar WS en el servidor (autenticado con la sesión de la app).
  const deviceId = await ensureDeviceId();
  const reg = await callVaultKey(appOrigin, { action: "register", device_id: deviceId });
  // 401 = la app no tiene sesión iniciada en ESTE Chrome — mismo mapeo que el
  // desbloqueo, para que el usuario vea la causa real y no un código críptico.
  if (!reg.ok) {
    if (reg.status === 401) return { ok: false, error: "SESSION_EXPIRED" };
    return { ok: false, error: reg.error || "VAULT_KEY_REGISTER_FAILED" };
  }
  const userId = reg.user_id;
  const wsBytes = base64ToBytes(reg.ws);

  // 2) VK aleatoria → cifra las credenciales.
  const empresaRut = payload.empresa_rut && String(payload.empresa_rut).trim() ? normalizeRut(payload.empresa_rut) : null;
  const now = new Date().toISOString();
  const vk = crypto.getRandomValues(new Uint8Array(32));
  const credIv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await aesEncrypt(vk, credIv, JSON.stringify({
    rut: String(payload.rut).trim(), clave: payload.clave, saved_at: now,
  }));

  // 3) KEK = HKDF(WS, salt) → envuelve VK.
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const kek = await hkdfKey(wsBytes, salt);
  const wrapIv = crypto.getRandomValues(new Uint8Array(12));
  const wrappedVk = await aesEncryptKey(kek, wrapIv, vk);

  await chrome.storage.local.set({
    [STORAGE_KEY]: {
      version: 2,
      user_id: userId,
      device_id: deviceId,
      salt: bytesToBase64(salt),
      cred_iv: bytesToBase64(credIv),
      ciphertext: bytesToBase64(new Uint8Array(ciphertext)),
      wrapped_vk_iv: bytesToBase64(wrapIv),
      wrapped_vk: bytesToBase64(new Uint8Array(wrappedVk)),
      meta: {
        configured: true, has_rut: true, has_clave: true,
        has_empresa_rut: Boolean(empresaRut), empresa_rut: empresaRut, updated_at: now,
      },
    },
  });
  // La bóveda v1 antigua ya no se usa; limpiarla para no confundir el estado.
  await chrome.storage.local.remove(LEGACY_V1_KEY);
  await cacheVk(vk, userId);
  return { ok: true };
}

// Desbloqueo para emitir: devuelve credenciales o un CÓDIGO de error humano (nunca
// pide passphrase). Usa el cache de VK; si no está, pide WS al servidor con la
// sesión y desenvuelve. Anti cross-user: si el usuario logueado no es el dueño de
// la bóveda de este equipo, NO desenvuelve (pide reconectar).
export async function getUnlockedSiiCredentials(appOriginHint) {
  const slot = await readSlot();
  if (!slot?.meta?.configured) {
    const legacy = await chrome.storage.local.get(LEGACY_V1_KEY);
    if (legacy?.[LEGACY_V1_KEY]) return { ok: false, error: "VAULT_NEEDS_MIGRATION" };
    return { ok: false, error: "VAULT_NOT_CONFIGURED" };
  }

  const cached = await getFreshVk();
  if (cached && cached.user_id === slot.user_id) {
    return unwrapCreds(slot, base64ToBytes(cached.vk));
  }

  const appOrigin = await getAppOrigin(appOriginHint);
  if (!appOrigin) return { ok: false, error: "APP_ORIGIN_DESCONOCIDO" };
  const deviceId = await ensureDeviceId();
  const got = await callVaultKey(appOrigin, { action: "get", device_id: deviceId });
  if (!got.ok) {
    if (got.status === 401) return { ok: false, error: "SESSION_EXPIRED" };
    if (got.status === 404 || got.status === 410) return { ok: false, error: "VAULT_REVOKED" };
    return { ok: false, error: got.error || "VAULT_KEY_GET_FAILED" };
  }
  if (got.user_id !== slot.user_id) return { ok: false, error: "VAULT_OTHER_USER" };

  try {
    const kek = await hkdfKey(base64ToBytes(got.ws), base64ToBytes(slot.salt));
    const vkBytes = new Uint8Array(await aesDecryptRaw(kek, base64ToBytes(slot.wrapped_vk_iv), base64ToBytes(slot.wrapped_vk)));
    const creds = await unwrapCreds(slot, vkBytes);
    if (creds.ok) await cacheVk(vkBytes, slot.user_id);
    return creds;
  } catch {
    return { ok: false, error: "VAULT_UNWRAP_FAILED" };
  }
}

async function unwrapCreds(slot, vkBytes) {
  try {
    const plain = await aesDecrypt(vkBytes, base64ToBytes(slot.cred_iv), base64ToBytes(slot.ciphertext));
    const secrets = JSON.parse(plain);
    if (!secrets?.rut || !secrets?.clave) return { ok: false, error: "VAULT_UNWRAP_FAILED" };
    return { ok: true, rut: secrets.rut, clave: secrets.clave };
  } catch {
    return { ok: false, error: "VAULT_UNWRAP_FAILED" };
  }
}

// ── Fetch al casillero del servidor (con la sesión de la app) ────────────────
async function callVaultKey(appOrigin, body) {
  try {
    const res = await fetch(`${appOrigin}/api/extension/vault-key`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      cache: "no-store",
      body: JSON.stringify(body),
    });
    let json = null;
    try { json = await res.json(); } catch { json = null; }
    if (!res.ok || !json?.ok) {
      return { ok: false, status: res.status, error: json?.error || `HTTP_${res.status}` };
    }
    return { ok: true, status: res.status, user_id: json.user_id, ws: json.ws };
  } catch (error) {
    return { ok: false, status: 0, error: error instanceof Error ? error.message : "FETCH_FAILED" };
  }
}

async function revokeDeviceKey(appOriginHint) {
  const appOrigin = await getAppOrigin(appOriginHint);
  if (!appOrigin) return;
  const deviceId = await ensureDeviceId();
  await callVaultKey(appOrigin, { action: "revoke", device_id: deviceId });
}

// ── Cache de VK en storage.session (sobrevive la muerte del SW; muere al cerrar) ─
async function cacheVk(vkBytes, userId) {
  try {
    await chrome.storage.session.set({
      [VK_CACHE_KEY]: { vk: bytesToBase64(vkBytes), user_id: userId, expiresAt: Date.now() + VK_TTL_MS },
    });
  } catch { /* best-effort */ }
}
async function getFreshVk() {
  try {
    const s = await chrome.storage.session.get(VK_CACHE_KEY);
    const c = s?.[VK_CACHE_KEY];
    if (c && typeof c === "object" && c.expiresAt > Date.now() && typeof c.vk === "string") return c;
  } catch { /* fall through */ }
  return null;
}
async function hasFreshVk() { return Boolean(await getFreshVk()); }
async function clearVkCache() { try { await chrome.storage.session.remove(VK_CACHE_KEY); } catch { /* ignore */ } }

// ── Cripto (WebCrypto) ───────────────────────────────────────────────────────
async function aesKeyFromBytes(bytes, usages) {
  return crypto.subtle.importKey("raw", bytes, { name: "AES-GCM" }, false, usages);
}
async function aesEncrypt(vkBytes, iv, plaintext) {
  const key = await aesKeyFromBytes(vkBytes, ["encrypt"]);
  return crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(plaintext));
}
async function aesDecrypt(vkBytes, iv, ciphertext) {
  const key = await aesKeyFromBytes(vkBytes, ["decrypt"]);
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ciphertext);
  return new TextDecoder().decode(pt);
}
async function aesEncryptKey(kek, iv, rawBytes) {
  return crypto.subtle.encrypt({ name: "AES-GCM", iv }, kek, rawBytes);
}
async function aesDecryptRaw(kek, iv, ciphertext) {
  return crypto.subtle.decrypt({ name: "AES-GCM", iv }, kek, ciphertext);
}
async function hkdfKey(wsBytes, salt) {
  const material = await crypto.subtle.importKey("raw", wsBytes, "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt, info: new TextEncoder().encode("sii-vault-kek-v2") },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

// ── base64 ───────────────────────────────────────────────────────────────────
function bytesToBase64(bytes) {
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary);
}
function bytesToBase64Url(bytes) {
  return bytesToBase64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function base64ToBytes(value) {
  const norm = String(value).replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(norm);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}
