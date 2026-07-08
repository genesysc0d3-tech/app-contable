"use strict";

// Mini-prompt de desbloqueo que la extensión abre sola cuando llega un trabajo de
// emisión y la bóveda SII está bloqueada. La clave se envía SÓLO al service worker de
// la extensión (contexto aislado) — nunca toca la página de la app. Al desbloquear con
// éxito, background.js reanuda el trabajo (resumeJobsAfterSiiUnlock) y esta ventana cierra.

const form = document.getElementById("form");
const pin = document.getElementById("pin");
const btn = document.getElementById("btn");
const status = document.getElementById("status");

function setStatus(text, cls) {
  status.textContent = text;
  status.className = "status" + (cls ? " " + cls : "");
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  const passphrase = pin.value || "";
  if (passphrase.length < 12) {
    setStatus("La clave local tiene mínimo 12 caracteres.", "err");
    return;
  }
  btn.disabled = true;
  setStatus("Desbloqueando…");
  chrome.runtime.sendMessage({ type: "APP_CONTABLE_SII_VAULT_UNLOCK", passphrase }, (response) => {
    btn.disabled = false;
    if (chrome.runtime.lastError || !response?.ok) {
      const err = response?.error || chrome.runtime.lastError?.message || "No se pudo desbloquear.";
      setStatus(err === "SII_PASSPHRASE_INVALID" ? "Clave local incorrecta." : err === "VAULT_LOCKED_RETRY_LATER" ? "Demasiados intentos: espera unos minutos." : "No se pudo desbloquear. Revisa tu clave.", "err");
      pin.select();
      return;
    }
    pin.value = "";
    setStatus("✓ Desbloqueado. Reanudando la emisión…", "ok");
    setTimeout(() => window.close(), 1000);
  });
});
