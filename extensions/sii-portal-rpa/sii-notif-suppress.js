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
})();
