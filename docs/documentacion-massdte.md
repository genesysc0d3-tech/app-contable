# massDTE — Documentación

> Emisión masiva de boletas electrónicas a partir de tu cartola bancaria.

## ¿Qué hace massDTE?

massDTE toma los movimientos de tu cartola bancaria (Excel o PDF), los clasifica
automáticamente según su naturaleza tributaria (afecta / exenta / no se boletea),
te los presenta para tu revisión, y emite las boletas electrónicas que tú
apruebes — una por cada operación real. Está pensado para contribuyentes con
alto volumen de operaciones (P2P, servicios, comercio digital) y para los
contadores que los asesoran.

## Cómo funciona (4 pasos)

1. **Agrega** tu cartola — la plataforma detecta los movimientos.
2. **Revisa** — cada movimiento llega con una clasificación sugerida y su nivel
   de confianza. Tú apruebas, editas o descartas.
3. **Emite** — en lote o individualmente. Solo se emite lo que tú aprobaste.
4. **Boletas** — consulta, descarga el PDF y revisa tu resumen de ventas (RCV).

## Modos de emisión

- **Modo de prueba** — simula el flujo completo sin emitir nada real. Ideal para
  conocer la plataforma. Todos los documentos de este modo están marcados
  "DOCUMENTO DE PRUEBA — SIN VALIDEZ TRIBUTARIA".
- **SII Local** — la emisión ocurre en tu propio computador, directamente en el
  emisor oficial del SII, con tus credenciales. **Tu clave tributaria nunca sale
  de tu equipo**: se almacena cifrada localmente y massDTE no la conoce ni la
  transmite. Requiere instalar nuestra extensión de Chrome.
- **SimpleAPI** — emisión a través del proveedor autorizado SimpleAPI, firmada
  con tu certificado digital. Al usar este modo, tu certificado se transmite a
  dicho proveedor exclusivamente para la firma de tus documentos.

## Seguridad y privacidad

- Tus credenciales tributarias se almacenan **cifradas en tu propio navegador**,
  nunca en nuestros servidores.
- Cada documento se emite **a tu nombre y bajo tu RUT** — massDTE es la
  herramienta; el emisor eres tú.
- Tus cartolas y datos se procesan únicamente para prestarte el servicio,
  conforme a nuestra Política de Privacidad y a la legislación chilena de
  protección de datos personales.
- Toda aprobación de emisión queda registrada con fecha y usuario.

## Avisos importantes

> **Las clasificaciones son sugerencias automáticas.** massDTE utiliza
> inteligencia artificial para *sugerir* la naturaleza tributaria de cada
> movimiento. Estas sugerencias **no constituyen asesoría tributaria ni
> contable**. Al aprobar y emitir, tú confirmas la naturaleza de cada operación.
> Ante dudas, consulta a tu contador.

> **El emisor es el responsable.** Los documentos tributarios se emiten bajo tu
> RUT y con tus credenciales o certificado. La responsabilidad por su contenido
> y por las declaraciones asociadas es del contribuyente emisor, conforme a la
> normativa del SII.

> **Documentos de prueba.** Los documentos generados en Modo de prueba no tienen
> validez tributaria alguna y están visiblemente marcados como tales.

> **Identificación del comprador.** Cuando una operación supere los umbrales de
> identificación del comprador establecidos por la normativa vigente del SII,
> la plataforma solicitará los antecedentes adicionales exigidos antes de emitir.

> **Corrección de documentos.** Una boleta electrónica emitida no se "borra":
> se corrige mediante Nota de Crédito, según la normativa del SII. Revisa tus
> documentos al emitirlos.

> **Disponibilidad.** El canal SII Local depende de la disponibilidad del portal
> del SII; el canal SimpleAPI, de los servicios de dicho proveedor.

## Preguntas frecuentes

**¿massDTE guarda mi clave del SII?** No. En el modo SII Local tu clave vive
cifrada en tu propio navegador. No la conocemos, no la transmitimos, no podemos
recuperarla.

**¿Puedo emitir una boleta de monto alto?** Sí. La normativa no limita el monto
de una boleta; solo exige identificar al comprador sobre ciertos umbrales, y la
plataforma te pedirá esos datos cuando corresponda.

**¿Qué pasa si apruebo algo mal clasificado?** La boleta emitida se corrige con
Nota de Crédito. Por eso el paso de revisión es tuyo: nada se emite sin tu
aprobación.

**¿massDTE reemplaza a mi contador?** No. Es una herramienta de emisión que le
ahorra el trabajo mecánico; las decisiones tributarias siguen siendo tuyas y de
tu asesor.

---

*Este documento es informativo y no constituye asesoría tributaria, contable ni
legal. Los Términos de Servicio y la Política de Privacidad prevalecen sobre
este documento.*
