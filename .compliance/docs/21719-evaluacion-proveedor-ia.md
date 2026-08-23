# Evaluación de riesgo del encargado de IA y controles compensatorios

**Responsable:** AlphaCode SpA, RUT 78.448.088-7, Av. Apoquindo 6410 Of. 605, Las Condes, Santiago.
**Contacto de datos personales:** privacidad@massdte.cl
**Encargado evaluado:** OpenCode — Anomaly Innovations, Inc. (San Francisco, California, EE.UU.)
**Fecha:** 2026-08-23 · **Versión:** 1.0

## 1. Por qué existe este documento

El Art. 15 bis de la Ley 21.719 exige que el tratamiento por un encargado se rija por un
contrato. El Art. 27 letra b) exige un instrumento **suscrito** para amparar la transferencia
internacional. A la fecha, AlphaCode SpA **no ha suscrito** contrato de tratamiento ni cláusulas
modelo con este proveedor.

Este documento deja constancia de la evaluación del riesgo, de los controles adoptados en
sustitución, de la decisión y de quién la adoptó. **No sustituye al contrato:** lo reemplaza
transitoriamente mientras se gestiona, y fija el plazo en que esa situación debe terminar.

## 2. Qué ofrece y qué no ofrece el proveedor

Verificado el 2026-08-23 contra `opencode.ai/legal/privacy-policy` y sus términos de servicio.

| Elemento exigible | Estado |
|---|---|
| Contrato de tratamiento / DPA | **No lo ofrece** |
| Cláusulas contractuales tipo | **No las ofrece** |
| Regiones de procesamiento declaradas | **No las declara** |
| Lista pública de sub-encargados | **No la publica** |
| Plazo de retención determinado | **No.** Dice "mientras sea necesario" |
| Referencia a RGPD u otro marco | **No lo menciona** |
| Compromiso de no entrenamiento | Solo en su documentación de **producto**, no en el contrato. Sus términos disponen además que, al usar modelos de terceros, el contenido queda sujeto a **las políticas de retención de esos proveedores** — el compromiso se traslada a terceros no identificados |
| Notificación de brechas al cliente | No comprometida |
| Asistencia en derechos del titular | No comprometida |

## 3. Evento adverso registrado

Se registró un error de enrutamiento del proveedor (`RegionError`) que dirigió tráfico de
clasificación hacia infraestructura en **China**, país no declarado en ninguna documentación del
proveedor ni en la de AlphaCode SpA. El hecho acredita que la ausencia de regiones declaradas no
es una omisión formal: es una exposición material **ya materializada**.

## 4. Exposición real, medida

- Invocaciones al proveedor en toda la historia del producto: **24**, en 2 días distintos.
- Titulares afectados: los movimientos de **una (1) clienta en pruebas** y sus contrapartes.
- Datos sensibles involucrados: ninguno.
- Datos que salieron sin seudonimizar antes del 2026-08-23: glosas bancarias con nombres de
  contraparte y, eventualmente, RUT.

La exposición histórica es acotada y cuantificada. Esta evaluación se hace **antes** de operar a
escala, no después de un daño.

## 5. Controles compensatorios adoptados

1. **Seudonimización en origen — el control principal.** Desde el 2026-08-23 la identidad de
   terceros se sustituye por tokens antes de que el texto salga del servidor, **siempre**, sin
   depender de ninguna variable de entorno. La correspondencia token→identidad vive en memoria
   por lote y no se persiste. Efecto: lo que el encargado pudiera retener no permite, por sí
   solo, identificar al titular. Se degrada la **consecuencia** del riesgo, no solo su
   probabilidad.
2. **Validación medida del control.** Sobre las cartolas reales de referencia (913 movimientos):
   **0 RUT filtrados** y cobertura de nombres ≥99% por archivo, con la clasificación
   determinista invariante. El arnés (`src/lib/ai/tokenize.harness.test.ts`) **falla** si esos
   umbrales se degradan: no es un informe, es una compuerta.
3. **Capa insaltable en la emisión.** Si un marcador interno llega hasta el punto de emitir, la
   boleta **no sale** (`validarBoleta`, código `MARCADOR_SEUDONIMO_SIN_RESOLVER`). Una boleta al
   SII es irreversible y este producto no emite notas de crédito.
4. **Restricción del universo de destinatarios, fail-closed.** Solo los pares proveedor:modelo
   expresamente listados pueden recibir datos; cualquier otro destino aborta
   (`assertApprovedDataProcessor`).
5. **Prohibición técnica de modelos de entrenamiento.** Los modelos gratuitos del proveedor —los
   únicos que declaran usar el contenido para mejorar el modelo— son rechazados por código, no
   por configuración (`model-guard.ts`).
6. **Minimización por monto.** Bajo 135 UF (Res. Ex. SII 44/2025) la identidad del receptor no se
   guarda: se descarta en el momento del insert.
7. **Intervención humana obligatoria.** Ninguna salida del modelo produce efectos por sí sola.
8. **Transparencia hacia el titular.** La política declara qué se envía, qué no, las dos
   excepciones (identidad del propio titular e imágenes de comprobantes) y, expresamente, que el
   compromiso de no entrenamiento del proveedor es una declaración pública y **no un contrato**.
   No se traslada al titular una garantía que AlphaCode no posee.

## 6. Controles comprometidos y NO implementados a esta fecha

| Control | Por qué falta | Plazo |
|---|---|---|
| Guardia de región fail-closed en el cliente de IA | El proveedor no declara regiones; hoy no hay contra qué validar | 2026-10-31 |
| Fijar la jurisdicción del bucket de Cloudflare R2 | Hoy va en `region: "auto"` — jurisdicción indeterminada para los PDF de boletas | 2026-10-31 |
| OCR local o previo, para cerrar la vía de la imagen | La foto del comprobante viaja completa; la seudonimización opera sobre texto y no alcanza los píxeles | 2026-11-30 |
| Gate equivalente para Telegram y R2 | Reciben identidad de terceros sin allowlist | 2026-11-30 |

## 7. Decisión

AlphaCode SpA resuelve **continuar** utilizando este encargado, con los controles de la sección 5,
hasta el **2026-12-01** (entrada en vigencia de la Ley 21.719). Fundamento: los datos que
efectivamente salen no permiten identificar a los titulares terceros; el volumen es mínimo y
medido; existe plan con plazos para los controles faltantes; y suspender el servicio no reduciría
el riesgo residual por debajo de lo que ya lo reducen los controles adoptados.

**Condiciones de reversión** — cualquiera obliga a suspender los envíos y reevaluar antes de
reanudar:

a) que el proveedor rechace formalmente suscribir un contrato de tratamiento;
b) que se detecte un nuevo destino de procesamiento no declarado;
c) que la seudonimización se desactive, se degrade o sea evadida por una ruta nueva;
d) que se incorpore un modelo o proveedor fuera de la lista aprobada;
e) que se pretenda procesar datos sensibles por esta vía.

**Gestiones en paralelo:** (i) requerimiento formal por escrito y con acuse a `help@anoma.ly`
pidiendo regiones por modelo y contrato de tratamiento; (ii) evaluación de un proveedor
alternativo que sí ofrezca ambos, como plan de contingencia.

**Adoptada por:** [COMPLETAR: nombre del responsable de datos designado], en su calidad de
responsable de datos de AlphaCode SpA.
**Fecha:** 2026-08-23. **Próxima revisión:** 2027-02-23, o ante cualquier condición de reversión.

---
*Borrador generado con compliance-cl (pack ley-21719). No constituye asesoría legal.*
