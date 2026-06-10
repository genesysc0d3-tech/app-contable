"use strict";

export const SII_VAULT_CAPABILITIES = [
  "sii_vault_status",
  "sii_vault_encrypted",
  "sii_vault_unlock_memory",
];

const STORAGE_KEY = "app_contable_sii_vault_v1";
const PBKDF2_ITERATIONS = 250000;
const UNLOCK_TTL_MS = 10 * 60 * 1000;

let unlockedVault = null;

export async function siiVaultStatus() {
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  const vault = stored?.[STORAGE_KEY] && typeof stored[STORAGE_KEY] === "object" ? stored[STORAGE_KEY] : null;
  const meta = vault?.meta && typeof vault.meta === "object" ? vault.meta : null;
  return {
    configured: Boolean(meta?.configured),
    encrypted: Boolean(meta?.encrypted),
    has_rut: Boolean(meta?.has_rut),
    has_clave: Boolean(meta?.has_clave),
    updated_at: typeof meta?.updated_at === "string" ? meta.updated_at : null,
    unlocked: isUnlocked(),
    unlocked_until: isUnlocked() ? new Date(unlockedVault.expiresAt).toISOString() : null,
  };
}

export async function handleSiiVaultMessage(message) {
  if (message?.type === "APP_CONTABLE_SII_VAULT_STATUS") {
    return { type: "APP_CONTABLE_SII_VAULT_STATUS_RESULT", status: await siiVaultStatus() };
  }

  if (message?.type === "APP_CONTABLE_SII_VAULT_SAVE") {
    const result = await saveSiiVault(message.payload);
    return { type: "APP_CONTABLE_SII_VAULT_SAVE_RESULT", ...result, status: await siiVaultStatus() };
  }

  if (message?.type === "APP_CONTABLE_SII_VAULT_UNLOCK") {
    const result = await unlockSiiVault(message.pin);
    return { type: "APP_CONTABLE_SII_VAULT_UNLOCK_RESULT", ...result, status: await siiVaultStatus() };
  }

  if (message?.type === "APP_CONTABLE_SII_VAULT_CLEAR") {
    unlockedVault = null;
    await chrome.storage.local.remove(STORAGE_KEY);
    return { type: "APP_CONTABLE_SII_VAULT_CLEAR_RESULT", ok: true, status: await siiVaultStatus() };
  }

  return null;
}

export function getUnlockedSiiCredentials() {
  if (!isUnlocked()) return null;
  return {
    rut: unlockedVault.secrets.rut,
    clave: unlockedVault.secrets.clave,
  };
}

async function saveSiiVault(payload) {
  const validationError = validatePayload(payload);
  if (validationError) return { ok: false, error: validationError };

  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const now = new Date().toISOString();
  const encrypted = await encryptCleartext({
    rut: String(payload.rut).trim(),
    clave: payload.clave,
    saved_at: now,
  }, payload.pin, salt, iv);

  const secrets = {
    rut: String(payload.rut).trim(),
    clave: payload.clave,
    saved_at: now,
  };

  await chrome.storage.local.set({
    [STORAGE_KEY]: {
      version: 1,
      algorithm: "PBKDF2-SHA256-AES-GCM",
      kdf_iterations: PBKDF2_ITERATIONS,
      salt: bytesToBase64(salt),
      iv: bytesToBase64(iv),
      ciphertext: bytesToBase64(new Uint8Array(encrypted)),
      meta: {
        configured: true,
        encrypted: true,
        has_rut: true,
        has_clave: true,
        updated_at: now,
      },
    },
  });
  unlockedVault = {
    secrets,
    expiresAt: Date.now() + UNLOCK_TTL_MS,
  };
  return { ok: true };
}

async function unlockSiiVault(pin) {
  if (!isValidPin(pin)) return { ok: false, error: "PIN_INVALID" };
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  const vault = stored?.[STORAGE_KEY] && typeof stored[STORAGE_KEY] === "object" ? stored[STORAGE_KEY] : null;
  if (!vault?.ciphertext || !vault?.salt || !vault?.iv) return { ok: false, error: "VAULT_NOT_CONFIGURED" };

  try {
    unlockedVault = {
      secrets: await decryptPayload(vault, pin),
      expiresAt: Date.now() + UNLOCK_TTL_MS,
    };
    setTimeout(() => {
      if (unlockedVault && unlockedVault.expiresAt <= Date.now()) unlockedVault = null;
    }, UNLOCK_TTL_MS + 1000);
    return { ok: true };
  } catch {
    unlockedVault = null;
    return { ok: false, error: "PIN_INVALID" };
  }
}

function validatePayload(payload) {
  if (!payload || typeof payload !== "object") return "PAYLOAD_INVALID";
  if (typeof payload.rut !== "string" || !payload.rut.trim()) return "RUT_REQUIRED";
  if (typeof payload.clave !== "string" || !payload.clave) return "CLAVE_REQUIRED";
  if (!isValidPin(payload.pin)) return "PIN_INVALID";
  return null;
}

function isValidPin(value) {
  return typeof value === "string" && /^\d{4}$/.test(value);
}

async function encryptCleartext(cleartextPayload, passphrase, salt, iv) {
  const key = await deriveKey(passphrase, salt);
  const cleartext = new TextEncoder().encode(JSON.stringify(cleartextPayload));
  return crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, cleartext);
}

async function decryptPayload(vault, passphrase) {
  const salt = base64ToBytes(vault.salt);
  const iv = base64ToBytes(vault.iv);
  const ciphertext = base64ToBytes(vault.ciphertext);
  const key = await deriveKey(passphrase, salt);
  const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ciphertext);
  return JSON.parse(new TextDecoder().decode(decrypted));
}

async function deriveKey(passphrase, salt) {
  const material = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(passphrase),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: PBKDF2_ITERATIONS, hash: "SHA-256" },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

function bytesToBase64(bytes) {
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary);
}

function base64ToBytes(value) {
  const binary = atob(String(value));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function isUnlocked() {
  if (!unlockedVault) return false;
  if (unlockedVault.expiresAt <= Date.now()) {
    unlockedVault = null;
    return false;
  }
  return true;
}
