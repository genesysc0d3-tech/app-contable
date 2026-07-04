"use strict";

export const SIMPLEAPI_CAPABILITIES = [
  "simpleapi_vault_status",
  "simpleapi_local_vault_encrypted",
  "simpleapi_vault_unlock_memory",
  "simpleapi_dte_generar_proxy",
  "simpleapi_dte_emitir_proxy",
  "simpleapi_multipart_proxy_post",
];

const SIMPLEAPI_MULTIPART_PROXY_PATHS = new Set([
  "envio/generar",
  "envio/enviar",
  "consulta/envio",
  "consulta/dte",
  "impresion/base64/carta/v2/cedible",
]);

const STORAGE_KEY = "app_contable_simpleapi_vault_v1";
const LOCK_KEY = "app_contable_simpleapi_vault_lock_v1";
const MAX_SECRET_FILE_BYTES = 8 * 1024 * 1024;
const PBKDF2_ITERATIONS = 250000;
const UNLOCK_TTL_MS = 10 * 60 * 1000;
const MAX_UNLOCK_ATTEMPTS = 5;
const LOCK_WINDOW_MS = 5 * 60 * 1000;

let unlockedVault = null;

export async function simpleApiVaultStatus() {
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  const vault = stored?.[STORAGE_KEY] && typeof stored[STORAGE_KEY] === "object" ? stored[STORAGE_KEY] : null;
  const meta = vault?.meta && typeof vault.meta === "object" ? vault.meta : null;
  return {
    configured: Boolean(meta?.configured),
    encrypted: Boolean(meta?.encrypted),
    has_pfx: Boolean(meta?.has_pfx),
    has_caf: Boolean(meta?.has_caf),
    ambiente: meta?.ambiente === 1 ? 1 : 0,
    updated_at: typeof meta?.updated_at === "string" ? meta.updated_at : null,
    unlocked: isUnlocked(),
    unlocked_until: isUnlocked() ? new Date(unlockedVault.expiresAt).toISOString() : null,
  };
}

// Vaults guardados antes del selector de ambiente no tienen el campo: se
// asume certificación (0). Nunca defaultear a producción.
function vaultAmbiente() {
  return Number(unlockedVault?.secrets?.ambiente) === 1 ? 1 : 0;
}

export async function handleSimpleApiVaultMessage(message) {
  if (message?.type === "APP_CONTABLE_SIMPLEAPI_VAULT_STATUS") {
    return {
      type: "APP_CONTABLE_SIMPLEAPI_VAULT_STATUS_RESULT",
      status: await simpleApiVaultStatus(),
    };
  }

  if (message?.type === "APP_CONTABLE_SIMPLEAPI_VAULT_SAVE") {
    const result = await saveSimpleApiVault(message.payload);
    return {
      type: "APP_CONTABLE_SIMPLEAPI_VAULT_SAVE_RESULT",
      ...result,
      status: await simpleApiVaultStatus(),
    };
  }

  if (message?.type === "APP_CONTABLE_SIMPLEAPI_VAULT_UNLOCK") {
    const result = await unlockSimpleApiVault(message.passphrase);
    return {
      type: "APP_CONTABLE_SIMPLEAPI_VAULT_UNLOCK_RESULT",
      ...result,
      status: await simpleApiVaultStatus(),
    };
  }

  if (message?.type === "APP_CONTABLE_SIMPLEAPI_VAULT_CLEAR") {
    unlockedVault = null;
    await chrome.storage.local.remove(STORAGE_KEY);
    return {
      type: "APP_CONTABLE_SIMPLEAPI_VAULT_CLEAR_RESULT",
      ok: true,
      status: await simpleApiVaultStatus(),
    };
  }

  return null;
}

export async function generateSimpleApiDteFromVault({ appOrigin, input, jobId, reservedFolio = null }) {
  if (!isUnlocked()) return { ok: false, error: "SIMPLEAPI_VAULT_LOCKED" };
  if (typeof input !== "string" || !input.trim()) return { ok: false, error: "INPUT_REQUIRED" };
  if (typeof jobId !== "string" || !jobId.trim()) return { ok: false, error: "JOB_ID_REQUIRED" };
  if (!isAllowedProxyOrigin(appOrigin)) return { ok: false, error: "APP_ORIGIN_INVALID" };

  // Reconciliar contra la app: el contador local de folios se pierde al
  // reinstalar la extensión o cambiar de equipo; boletas_emitidas es la
  // fuente de verdad del último folio usado por SimpleAPI.
  const tipoDtePeek = peekTipoDte(input);
  const ultimoFolioApp = tipoDtePeek ? await fetchUltimoFolioApp(appOrigin, tipoDtePeek) : null;

  const formData = new FormData();
  const prepared = prepareDteInput(input, ultimoFolioApp, reservedFolio);
  if (!prepared.ok) return prepared;
  formData.set("input", prepared.input);
  formData.set("job_id", jobId);
  formData.set("files", base64ToFile(unlockedVault.secrets.pfx_base64, unlockedVault.secrets.pfx_name || "certificado.pfx", "application/x-pkcs12"));
  formData.set("files2", new File([unlockedVault.secrets.caf_text], unlockedVault.secrets.caf_name || "caf.xml", { type: "text/xml" }));

  const response = await fetch(`${appOrigin}/api/simpleapi/dte/generar`, {
    method: "POST",
    body: formData,
    credentials: "include",
    cache: "no-store",
  });
  const contentType = response.headers.get("content-type") || "";
  const data = contentType.includes("application/json")
    ? await response.json().catch(() => null)
    : await response.text().catch(() => "");

  if (response.ok) await advanceVaultFolio(prepared.tipoDte, prepared.folio);
  return {
    ok: response.ok,
    status: response.status,
    data,
  };
}

function peekTipoDte(input) {
  try {
    const parsed = JSON.parse(input);
    const idDoc = parsed?.Documento?.Encabezado?.IdentificacionDTE || parsed?.Documento?.Encabezado?.IdDoc;
    const tipoDte = Number(idDoc?.TipoDTE || idDoc?.TipoDte || idDoc?.tipoDte);
    return Number.isInteger(tipoDte) && tipoDte > 0 ? tipoDte : null;
  } catch {
    return null;
  }
}

async function fetchUltimoFolioApp(appOrigin, tipoDte) {
  try {
    const response = await fetch(`${appOrigin}/api/simpleapi/ultimo-folio?tipo_dte=${tipoDte}`, {
      credentials: "include",
      cache: "no-store",
    });
    if (!response.ok) return null;
    const data = await response.json().catch(() => null);
    const folio = Number(data?.ultimo_folio);
    return Number.isSafeInteger(folio) && folio > 0 ? folio : null;
  } catch {
    // Sin red o sin sesión: se usa solo el contador local (comportamiento previo).
    return null;
  }
}

export async function emitSimpleApiDteFromVault({ appOrigin, input, jobId, reservedFolio = null }) {
  const generated = await generateSimpleApiDteFromVault({ appOrigin, input, jobId, reservedFolio });
  if (!generated.ok) return { ...generated, step: "dte/generar" };

  const dteXml = extractXml(generated.data, "DTE");
  if (!dteXml) return { ok: false, step: "dte/generar", error: "DTE_XML_MISSING", data: generated.data };
  const dteInfo = extractDteInfo(dteXml);
  if (!dteInfo.folio || !dteInfo.tipoDte || !dteInfo.fecha || !dteInfo.total) {
    return { ok: false, step: "dte/generar", error: "DTE_INFO_MISSING", data: generated.data };
  }

  const envioGenerado = await postSimpleApiMultipartProxy({
    appOrigin,
    path: "envio/generar",
    jobId,
    input: {
      Certificado: certificatePayload(),
      Caratula: {
        RutEmisor: unlockedVault.secrets.emisor_rut,
        RutReceptor: "60803000-K",
        FechaResolucion: unlockedVault.secrets.resolution_date,
        NumeroResolucion: unlockedVault.secrets.resolution_number,
      },
    },
    files: [pfxFile("files"), textFile("files2", dteXml, "DTE_APIREST.xml", "text/xml")],
  });
  if (!envioGenerado.ok) return { ...envioGenerado, step: "envio/generar", dte: dteInfo };
  const envioXml = extractXml(envioGenerado.data, "EnvioDTE") || extractXml(envioGenerado.data, "EnvioBOLETA");
  if (!envioXml) return { ok: false, step: "envio/generar", error: "ENVIO_XML_MISSING", data: envioGenerado.data, dte: dteInfo };

  const enviado = await postSimpleApiMultipartProxy({
    appOrigin,
    path: "envio/enviar",
    jobId,
    input: { Certificado: certificatePayload(), Ambiente: vaultAmbiente(), Tipo: dteInfo.tipoDte === 39 || dteInfo.tipoDte === 41 ? 2 : 1 },
    files: [pfxFile("files"), textFile("files2", envioXml, "ENVIO_DTE.xml", "text/xml")],
  });
  if (!enviado.ok) return { ...enviado, step: "envio/enviar", dte: dteInfo };
  const trackId = extractTrackId(enviado.data);
  if (!trackId) return { ok: false, step: "envio/enviar", error: "TRACK_ID_MISSING", data: enviado.data, dte: dteInfo };

  const consultaEnvio = await postSimpleApiMultipartProxy({
    appOrigin,
    path: "consulta/envio",
    jobId,
    input: { Certificado: certificatePayload(), RutEmpresa: unlockedVault.secrets.emisor_rut, TrackId: trackId, Ambiente: vaultAmbiente(), ServidorBoletaREST: false },
    files: [pfxFile("files")],
  });
  const envioAceptado = isAcceptedEnvio(consultaEnvio.data);

  const consultaDte = await postSimpleApiMultipartProxy({
    appOrigin,
    path: "consulta/dte",
    jobId,
    input: {
      Certificado: certificatePayload(),
      RutEmpresa: unlockedVault.secrets.emisor_rut,
      RutReceptor: dteInfo.rutReceptor || "66666666-6",
      Folio: dteInfo.folio,
      Total: dteInfo.total,
      FechaDTE: dteInfo.fecha,
      Tipo: dteInfo.tipoDte,
      Ambiente: vaultAmbiente(),
      ServidorBoletaREST: false,
    },
    files: [pfxFile("files")],
  });
  const dteAceptado = isAcceptedDte(consultaDte.data);

  const pdf = await postSimpleApiMultipartProxy({
    appOrigin,
    path: "impresion/base64/carta/v2/cedible",
    jobId,
    input: {
      NumeroResolucion: unlockedVault.secrets.resolution_number,
      FechaResolucion: unlockedVault.secrets.resolution_date,
      FormaPago: "EFECTIVO",
      CondicionVenta: "EFECTIVO",
      PropiedadLogo: "contain",
    },
    files: [textFile("fileEnvio", dteXml, "DTE_APIREST.xml", "text/xml")],
  });
  const pdfBase64 = extractPdfBase64(pdf.data);

  return {
    ok: Boolean(envioAceptado && dteAceptado && pdfBase64),
    step: "complete",
    trackId,
    dte: dteInfo,
    dteXml,
    envioXml,
    envio: consultaEnvio.data,
    consultaDte: consultaDte.data,
    pdf: pdfBase64 ? { base64: pdfBase64, content_type: "application/pdf", filename: `simpleapi-${dteInfo.tipoDte}-${dteInfo.folio}.pdf` } : null,
    warnings: pdfBase64 ? [] : ["PDF_BASE64_MISSING"],
  };
}

export async function postSimpleApiMultipartProxy({ appOrigin, path, input, files, jobId }) {
  if (!SIMPLEAPI_MULTIPART_PROXY_PATHS.has(path)) return { ok: false, error: "SIMPLEAPI_PATH_NOT_ALLOWED" };
  if (!isAllowedProxyOrigin(appOrigin)) return { ok: false, error: "APP_ORIGIN_INVALID" };
  if (typeof jobId !== "string" || !jobId.trim()) return { ok: false, error: "JOB_ID_REQUIRED" };

  const formData = new FormData();
  formData.set("input", typeof input === "string" ? input : JSON.stringify(input ?? {}));
  formData.set("job_id", jobId);
  for (const file of Array.isArray(files) ? files : []) {
    if (!file?.field || !file?.base64) continue;
    const name = safeFilename(file.name) || `${file.field}.bin`;
    formData.set(file.field, base64ToFile(file.base64, name, file.type || "application/octet-stream"));
  }

  const response = await fetch(`${appOrigin}/api/simpleapi/${path}`, {
    method: "POST",
    body: formData,
    credentials: "include",
    cache: "no-store",
  });
  const contentType = response.headers.get("content-type") || "";
  const data = contentType.includes("application/json")
    ? await response.json().catch(() => null)
    : await response.text().catch(() => "");
  return { ok: response.ok, status: response.status, data };
}

async function saveSimpleApiVault(payload) {
  const validationError = validatePayload(payload);
  if (validationError) return { ok: false, error: validationError };

  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await encryptPayload(payload, payload.passphrase, salt, iv);
  const now = new Date().toISOString();
  const vault = {
    version: 1,
    algorithm: "PBKDF2-SHA256-AES-GCM",
    kdf_iterations: PBKDF2_ITERATIONS,
    salt: bytesToBase64(salt),
    iv: bytesToBase64(iv),
    ciphertext: bytesToBase64(new Uint8Array(encrypted)),
    meta: {
      configured: true,
      encrypted: true,
      has_pfx: true,
      has_caf: true,
      ambiente: payload.ambiente === 1 ? 1 : 0,
      pfx_name: safeFilename(payload.pfx_name),
      caf_name: safeFilename(payload.caf_name),
      updated_at: now,
    },
  };

  await chrome.storage.local.set({ [STORAGE_KEY]: vault });
  await chrome.storage.local.remove(LOCK_KEY);
  unlockedVault = null;
  return { ok: true };
}

async function unlockSimpleApiVault(passphrase) {
  if (typeof passphrase !== "string" || passphrase.length < 10) return { ok: false, error: "PASSPHRASE_TOO_SHORT" };
  const lock = await getUnlockLock();
  if (lock.until > Date.now()) return { ok: false, error: "VAULT_LOCKED_RETRY_LATER" };

  const stored = await chrome.storage.local.get(STORAGE_KEY);
  const vault = stored?.[STORAGE_KEY] && typeof stored[STORAGE_KEY] === "object" ? stored[STORAGE_KEY] : null;
  if (!vault?.ciphertext || !vault?.salt || !vault?.iv) return { ok: false, error: "VAULT_NOT_CONFIGURED" };

  try {
    const cleartext = await decryptPayload(vault, passphrase);
    unlockedVault = {
      secrets: cleartext,
      passphrase,
      expiresAt: Date.now() + UNLOCK_TTL_MS,
    };
    setTimeout(() => {
      if (unlockedVault && unlockedVault.expiresAt <= Date.now()) unlockedVault = null;
    }, UNLOCK_TTL_MS + 1000);
    await chrome.storage.local.remove(LOCK_KEY);
    return { ok: true };
  } catch {
    unlockedVault = null;
    await registerFailedUnlock();
    return { ok: false, error: "PASSPHRASE_INVALID" };
  }
}

async function getUnlockLock() {
  const stored = await chrome.storage.local.get(LOCK_KEY);
  const lock = stored?.[LOCK_KEY];
  return lock && typeof lock === "object" ? { failed: Number(lock.failed) || 0, until: Number(lock.until) || 0 } : { failed: 0, until: 0 };
}

async function registerFailedUnlock() {
  const lock = await getUnlockLock();
  const failed = lock.failed + 1;
  if (failed >= MAX_UNLOCK_ATTEMPTS) {
    await chrome.storage.local.set({ [LOCK_KEY]: { failed: 0, until: Date.now() + LOCK_WINDOW_MS } });
  } else {
    await chrome.storage.local.set({ [LOCK_KEY]: { failed, until: 0 } });
  }
}

function validatePayload(payload) {
  if (!payload || typeof payload !== "object") return "PAYLOAD_INVALID";
  if (typeof payload.pfx_base64 !== "string" || !payload.pfx_base64) return "PFX_REQUIRED";
  if (typeof payload.caf_text !== "string" || !payload.caf_text.trim()) return "CAF_REQUIRED";
  if (typeof payload.certificate_password !== "string" || !payload.certificate_password) return "CERT_PASSWORD_REQUIRED";
  if (typeof payload.certificate_rut !== "string" || !payload.certificate_rut.trim()) return "CERT_RUT_REQUIRED";
  if (typeof payload.emisor_rut !== "string" || !payload.emisor_rut.trim()) return "EMISOR_RUT_REQUIRED";
  if (typeof payload.resolution_date !== "string" || !payload.resolution_date.trim()) return "RESOLUTION_DATE_REQUIRED";
  if (!Number.isInteger(payload.resolution_number) || payload.resolution_number < 0) return "RESOLUTION_NUMBER_INVALID";
  if (payload.ambiente !== 0 && payload.ambiente !== 1) return "AMBIENTE_INVALID";
  if (typeof payload.passphrase !== "string" || payload.passphrase.length < 10) return "PASSPHRASE_TOO_SHORT";
  if (base64ByteLength(payload.pfx_base64) > MAX_SECRET_FILE_BYTES) return "PFX_TOO_LARGE";
  if (new TextEncoder().encode(payload.caf_text).byteLength > MAX_SECRET_FILE_BYTES) return "CAF_TOO_LARGE";
  const cafInfo = parseCafInfo(payload.caf_text);
  if (!Number.isInteger(cafInfo.tipoDte) || !Number.isInteger(cafInfo.desde) || !Number.isInteger(cafInfo.hasta)) return "CAF_INVALID";
  return null;
}

async function encryptPayload(payload, passphrase, salt, iv) {
  return encryptCleartext({
    pfx_base64: payload.pfx_base64,
    pfx_name: safeFilename(payload.pfx_name) || "certificado.pfx",
    caf_text: payload.caf_text,
    caf_name: safeFilename(payload.caf_name) || "caf.xml",
    certificate_password: payload.certificate_password,
    certificate_rut: payload.certificate_rut,
    emisor_rut: payload.emisor_rut,
    resolution_date: payload.resolution_date,
    resolution_number: payload.resolution_number,
    ambiente: payload.ambiente === 1 ? 1 : 0,
    caf_info: parseCafInfo(payload.caf_text),
    saved_at: new Date().toISOString(),
  }, passphrase, salt, iv);
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

function base64ByteLength(value) {
  const normalized = String(value).replace(/=+$/, "");
  return Math.floor((normalized.length * 3) / 4);
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

function base64ToFile(base64, name, type) {
  return new File([base64ToBytes(base64)], name, { type });
}

function textFile(field, text, name, type) {
  return { field, base64: bytesToBase64(new TextEncoder().encode(text)), name, type };
}

function pfxFile(field) {
  return { field, base64: unlockedVault.secrets.pfx_base64, name: unlockedVault.secrets.pfx_name || "certificado.pfx", type: "application/x-pkcs12" };
}

function certificatePayload() {
  return { Rut: unlockedVault.secrets.certificate_rut, Password: unlockedVault.secrets.certificate_password };
}

function prepareDteInput(input, ultimoFolioApp = null, reservedFolio = null) {
  try {
    const parsed = JSON.parse(input);
    parsed.Certificado = certificatePayload();
    const idDoc = parsed?.Documento?.Encabezado?.IdentificacionDTE || parsed?.Documento?.Encabezado?.IdDoc;
    if (!idDoc || typeof idDoc !== "object") return { ok: false, error: "ID_DOC_MISSING" };
    const tipoDte = Number(idDoc.TipoDTE || idDoc.TipoDte || idDoc.tipoDte);
    if (!Number.isInteger(tipoDte)) return { ok: false, error: "TIPO_DTE_REQUIRED" };
    const reserved = Number(reservedFolio);
    if (Number.isSafeInteger(reserved) && reserved > 0) {
      const existing = Number(idDoc.Folio);
      if (Number.isSafeInteger(existing) && existing > 0 && existing !== reserved) return { ok: false, error: "FOLIO_RESERVA_MISMATCH" };
      const range = folioInCafRange(tipoDte, reserved);
      if (!range.ok) return range;
      idDoc.Folio = reserved;
    } else if (!idDoc.Folio) {
      const folio = nextFolioForTipo(tipoDte, ultimoFolioApp);
      if (!folio.ok) return folio;
      idDoc.Folio = folio.folio;
    } else {
      const range = folioInCafRange(tipoDte, Number(idDoc.Folio));
      if (!range.ok) return range;
    }
    if (!idDoc.FechaEmision && idDoc.FchEmis) idDoc.FechaEmision = idDoc.FchEmis;
    return { ok: true, input: JSON.stringify(parsed), tipoDte, folio: Number(idDoc.Folio) };
  } catch {
    return { ok: false, error: "BAD_JSON" };
  }
}

function nextFolioForTipo(tipoDte, ultimoFolioApp = null) {
  const info = unlockedVault.secrets.caf_info;
  if (!info || Number(info.tipoDte) !== Number(tipoDte)) return { ok: false, error: "CAF_TIPO_DTE_MISMATCH" };
  const local = Number(info.nextFolio || info.desde);
  const folio = Number.isSafeInteger(ultimoFolioApp) && ultimoFolioApp > 0
    ? Math.max(local, ultimoFolioApp + 1)
    : local;
  if (!Number.isSafeInteger(folio) || folio < Number(info.desde) || folio > Number(info.hasta)) return { ok: false, error: "CAF_FOLIO_RANGE_EXHAUSTED" };
  return { ok: true, folio };
}

function folioInCafRange(tipoDte, folio) {
  const info = unlockedVault.secrets.caf_info;
  if (!info || Number(info.tipoDte) !== Number(tipoDte)) return { ok: false, error: "CAF_TIPO_DTE_MISMATCH" };
  if (!Number.isSafeInteger(folio) || folio < Number(info.desde) || folio > Number(info.hasta)) return { ok: false, error: "CAF_FOLIO_RANGE_EXHAUSTED" };
  return { ok: true };
}

async function advanceVaultFolio(tipoDte, folioUsado = null) {
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  const vault = stored?.[STORAGE_KEY] && typeof stored[STORAGE_KEY] === "object" ? stored[STORAGE_KEY] : null;
  if (!vault || !unlockedVault?.passphrase || !unlockedVault?.secrets?.caf_info || Number(unlockedVault.secrets.caf_info.tipoDte) !== Number(tipoDte)) return;
  const info = unlockedVault.secrets.caf_info;
  const base = Number(info.nextFolio || info.desde);
  // El siguiente folio queda después del realmente usado (que pudo venir
  // reconciliado desde la app), nunca detrás del contador local.
  info.nextFolio = Number.isSafeInteger(folioUsado) && folioUsado > 0
    ? Math.max(base, folioUsado + 1)
    : base + 1;
  unlockedVault.secrets.saved_at = new Date().toISOString();

  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await encryptCleartext(unlockedVault.secrets, unlockedVault.passphrase, salt, iv);
  await chrome.storage.local.set({
    [STORAGE_KEY]: {
      ...vault,
      salt: bytesToBase64(salt),
      iv: bytesToBase64(iv),
      ciphertext: bytesToBase64(new Uint8Array(encrypted)),
      meta: {
        ...(vault.meta || {}),
        updated_at: new Date().toISOString(),
      },
    },
  });
}

function parseCafInfo(cafText) {
  const tipoDte = Number(matchXml(cafText, "TD"));
  const desde = Number(matchXml(cafText, "D"));
  const hasta = Number(matchXml(cafText, "H"));
  return { tipoDte, desde, hasta, nextFolio: desde };
}

function matchXml(xml, tag) {
  const match = String(xml || "").match(new RegExp(`<${tag}>([^<]+)</${tag}>`, "i"));
  return match?.[1] || "";
}

function extractXml(value, rootName) {
  const text = stringFromResponse(value);
  const index = text.indexOf(`<${rootName}`);
  if (index >= 0) return text.slice(text.lastIndexOf("<?xml", index) >= 0 ? text.lastIndexOf("<?xml", index) : index).trim();
  return null;
}

function stringFromResponse(value) {
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object") return "";
  const record = value;
  if (typeof record.data === "string") return record.data;
  if (record.data) return stringFromResponse(record.data);
  if (typeof record.responseXml === "string") return record.responseXml;
  return JSON.stringify(value);
}

function extractDteInfo(xml) {
  return {
    tipoDte: Number(matchXml(xml, "TipoDTE")),
    folio: Number(matchXml(xml, "Folio")),
    fecha: matchXml(xml, "FchEmis"),
    total: Number(matchXml(xml, "MntTotal")),
    rutReceptor: matchXml(xml, "RUTRecep"),
  };
}

function extractTrackId(value) {
  if (value && typeof value === "object") {
    const data = value.data && typeof value.data === "object" ? value.data : value;
    const raw = data.trackId || data.TrackId || data.trackid;
    if (raw) return Number(raw);
  }
  const match = stringFromResponse(value).match(/<TRACKID>0*(\d+)<\/TRACKID>|"trackid"\s*:\s*(\d+)/i);
  return Number(match?.[1] || match?.[2] || 0);
}

function isAcceptedEnvio(value) {
  const data = value?.data && typeof value.data === "object" ? value.data : value;
  if (data?.ok === true && String(data?.estado || "").toUpperCase() === "EPR") return true;
  const text = stringFromResponse(value);
  return /<ESTADO>EPR<\/ESTADO>/i.test(text) && /<ACEPTADOS>[1-9]/i.test(text);
}

function isAcceptedDte(value) {
  const data = value?.data && typeof value.data === "object" ? value.data : value;
  if (data?.ok === true && String(data?.estado || "").toUpperCase() === "DOK") return true;
  return /<ESTADO>DOK<\/ESTADO>/i.test(stringFromResponse(value));
}

function extractPdfBase64(value) {
  if (typeof value === "string" && value.length > 100) return value;
  const data = value?.data && typeof value.data === "object" ? value.data : value;
  for (const key of ["base64", "pdf", "documento", "data"]) {
    const candidate = data?.[key];
    if (typeof candidate === "string" && candidate.length > 100) return candidate;
  }
  return null;
}

function isUnlocked() {
  if (!unlockedVault) return false;
  if (unlockedVault.expiresAt <= Date.now()) {
    unlockedVault = null;
    return false;
  }
  return true;
}

function isAllowedProxyOrigin(origin) {
  return origin === "https://app-contable-five.vercel.app" || /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin || "");
}

function safeFilename(value) {
  return typeof value === "string" ? value.replace(/[\\/\u0000-\u001f]/g, "").slice(0, 160) : "";
}
