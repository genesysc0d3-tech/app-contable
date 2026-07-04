// Corre en el MUNDO PRINCIPAL de las páginas sii.cl en document_start.
// e-Boleta llama a Notification.requestPermission() al cargar, lo que dispara
// el prompt nativo del navegador ("Mostrar notificaciones"). Ese prompt es UI
// del navegador (no del DOM), así que ni la extensión ni un content script
// pueden cerrarlo, y bloquea la carga del SPA de e-Boleta.
//
// Solución: neutralizar la API de notificaciones antes de que la página la
// use. La emisión no necesita notificaciones; el prompt nunca aparece y la
// página carga sin intervención. Aplica a cualquier navegador del cliente.
(() => {
  "use strict";
  try {
    if (typeof Notification !== "undefined") {
      try {
        Object.defineProperty(Notification, "permission", { get: () => "denied", configurable: true });
      } catch { /* algunos navegadores no permiten redefinir; el stub de abajo basta */ }
      Notification.requestPermission = function (callback) {
        if (typeof callback === "function") { try { callback("denied"); } catch { /* noop */ } }
        return Promise.resolve("denied");
      };
    }
  } catch { /* si algo falla, no rompemos la página */ }

  // --- Captura del PDF de la boleta vía COMPARTIR ---
  // El e-Boleta, al apretar COMPARTIR, ARMA el PDF como File y se lo pasa a
  // navigator.share. Interceptamos share (y forzamos canShare=true para que el
  // SII proceda a armar el File aun en desktop) → nos quedamos con el File real,
  // SIN abrir el share sheet (no molesta, no cuelga el lote) → lo enviamos al
  // content script como base64. Es la vía más limpia: PDF oficial, sin 403 de
  // S3, sin diálogo nativo, sin OCR.
  try {
    const enviarPdf = (data) => {
      try {
        const f = data && data.files && data.files[0];
        if (!f || !/pdf/i.test(f.type || "")) return;
        const reader = new FileReader();
        reader.onload = () => {
          const s = String(reader.result || "");
          const base64 = s.includes(",") ? s.slice(s.indexOf(",") + 1) : "";
          if (base64) {
            window.postMessage(
              { source: "massdte-share-pdf", base64, name: f.name || "boleta.pdf", type: f.type || "application/pdf", size: f.size || 0 },
              window.location.origin,
            );
          }
        };
        reader.readAsDataURL(f);
      } catch { /* noop */ }
    };
    // canShare debe devolver true para que el handler del SII arme el File.
    const origCanShare = navigator.canShare ? navigator.canShare.bind(navigator) : null;
    navigator.canShare = function (data) {
      if (data && data.files && data.files[0] && /pdf/i.test(data.files[0].type || "")) return true;
      return origCanShare ? origCanShare(data) : true;
    };
    const origShare = navigator.share ? navigator.share.bind(navigator) : null;
    navigator.share = function (data) {
      const f = data && data.files && data.files[0];
      if (f && /pdf/i.test(f.type || "")) {
        enviarPdf(data);          // PDF de la boleta → lo capturamos
        return Promise.resolve(); // y no abrimos el share sheet (no molesta, no cuelga)
      }
      return origShare ? origShare(data) : Promise.resolve(); // cualquier otro share pasa normal
    };
  } catch { /* si no se puede, la captura cae al fallback (DESCARGAR) */ }
})();
