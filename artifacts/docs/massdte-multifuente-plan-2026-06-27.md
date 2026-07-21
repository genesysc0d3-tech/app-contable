# Plan — Modelo Multi-Fuente para massdte

**Varias pruebas de una venta P2P → UNA sola boleta.**
Fecha: 2026-06-27 · Hecho con 5 especialistas (arquitectura/código, UX, UI, contador tributario chileno, privacidad/Ley 21.719), cada uno leyendo el código real.

---

## 1. El problema, en una frase

Hoy **cada foto o cartola que entra se vuelve una boleta**. Pero una venta P2P deja **varias pruebas**: el abono en tu banco o MercadoPago + la orden de Binance. Si subís las dos, massdte hace **DOS boletas por UNA venta** → le cobrás impuesto de más a vos mismo.

> Confirmado en el código: el bot de Telegram procesa cada foto como documento aparte y **no mira `media_group_id`** (la marca que pone Telegram cuando mandás un álbum). Un álbum de 2 pruebas = 2 boletas. Es un bug real, hoy.

## 2. La solución, en una frase

Cada fuente (banco, MercadoPago, Binance, screenshot) es **"una cartola más"**. Las pruebas de la misma venta se juntan en **UNA transacción → UNA boleta**. Si hay confianza, se juntan solas; si hay duda, te pregunta con **un toque**; **nunca adivina**.

```
        TRANSACCIÓN  (la venta = "la plata")
        ┌─────────────┬──────────────┬─────────────┐
   abono banco/MP   orden Binance   screenshot
   (monto, fecha,   (que fue        (respaldo
    pagador)         cripto→exenta,   extra)
        │            contraparte)
        ▼
   genera UNA boleta tipo 41 (no afecta) · monto = CLP recibido
```

---

## 3. ANTES / DESPUÉS (lo esencial)

| Tema | ANTES (hoy) | DESPUÉS (con el plan) |
|---|---|---|
| **Unidad** | 1 foto/cartola = 1 boleta | 1 **venta** = 1 boleta, aunque tenga varias pruebas |
| **Fuentes** | Solo cartola de banco + fotos sueltas por Telegram | Banco, **MercadoPago, Binance/exchange** y screenshots — todas "una cartola más" |
| **Álbum de Telegram** | 2 fotos juntas → **2 boletas** (bug) | 2 fotos juntas = **1 venta con 2 pruebas** |
| **Cruce de pruebas** | No existe; cada prueba va por su lado | Se cruzan por **monto + hora**; con confianza solas, con duda te pregunta |
| **Monto de la boleta** | El que detecta la foto | **El CLP que efectivamente recibiste** ("la boleta sigue a la plata") |
| **Si hay duda** | (no aplica) | Cae a **"Por revisar"** — nunca dos boletas, nunca una fantasma |
| **Tipo** | "exenta" | Tipo **41 "no afecta"** (cripto no paga IVA) — ajustar el texto |
| **Respaldo ante el SII** | Una prueba suelta | **Abono + orden cruzados** = justificación de fondos (clave con la Ley 21.713) |
| **Privacidad** | La glosa con nombres/RUT va a la IA **sin enmascarar** (hoy) | Pasa por el filtro que **enmascara antes** de enviarla a la IA |

---

## 4. Cómo se juntan las pruebas (rápido + fiable)

El principio: **unir solo con confianza, preguntar con un toque si hay duda, nunca adivinar en silencio.**

1. **Mismo monto + ventana de hora** es la pista base.
2. **Auto-une solo con señal fuerte** (ej. el **código de operación** del exchange — que el código YA sabe extraer). Monto+hora *iguales* a secas **no unen solos: preguntan.**
3. **Nunca une dos filas de la misma fuente.** (En P2P es normal tener dos ventas de $50.000 el mismo día al mismo cliente — son ventas reales, no duplicados. Unirlas sería **declarar de menos**, que es peor que de más.)
4. **Las fuentes llegan en momentos distintos** (banco 1×/día, Binance por API, screenshot cuando lo mandás) → el cruce es un paso **continuo** que reintenta cada vez que entra algo nuevo. Si mañana llega la orden de Binance que faltaba, **cruza sola** y te avisa "lista para emitir".
5. **Nada se vuelve boleta sin pasar el motor de Emitir** que ya tenés. Un cruce que falla, en el peor caso, es **un vistazo humano** — jamás una boleta mal hecha.

---

## 5. Lo que descubrimos mirando el código (4 sorpresas)

1. **El bug del álbum es barato de matar y solo.** Leer `media_group_id` y juntar el álbum en un documento mata el ~80% del doble-conteo real de hoy, sin tocar el modelo grande. **Es lo primero.**
2. **Hoy no guardamos la HORA.** La cartola guarda solo la fecha (sin hora). La hora la *lee* el OCR pero la *tira*. Sin hora, la "ventana de hora" es de ±1 día (más casos a "por revisar"). Hay que **persistir la hora** — barato.
3. **🔴 El filtro de privacidad está DESCONECTADO.** El código tiene un filtro (`redactForAI`) que enmascara RUT/nombres/cuentas antes de mandar a la IA… **pero no está enchufado**: hoy la glosa con datos de terceros viaja **cruda** a la IA. Esto **ya pasa**, no es de esta feature — y las fuentes nuevas lo agravan. Hay que cablearlo.
4. **La renta está FUERA del alcance de massdte (decisión del fundador, 2026-06-28).** massdte **emite la boleta** (documenta la venta); el **mayor valor / costo del USDT / F22 es trabajo del contador**, no del producto. Lo único a cuidar es el **discurso**: no prometer "al día con la renta" — massdte te deja la venta documentada, el resto lo ve tu contador.

---

## 6. Qué dijo cada especialista (resumen)

### 🏗️ Arquitectura / código — "no es difícil; lo difícil es afinar el cruce"
- **Modelo de datos = aditivo y simple.** Tabla nueva `transacciones` + una columna `transaccion_id` en los movimientos. La cadena actual (documento→movimiento→propuesta→boleta) **no se rompe**: la boleta sigue colgando del movimiento "ancla" (el del dinero).
- **Cada fuente = un adaptador** que escupe el mismo formato de "movimiento". El sistema de aprendizaje (`parser_adapters`) queda **intacto**.
- **El motor de cruce vive en la cola que ya existe** (`document_processing_jobs`: reintentos, locks, idempotencia — gratis).
- **Lo verdaderamente caro** no es el cruce: son las **integraciones de API** (Binance, MP) + la custodia de credenciales.
- Respuesta franca a "¿es muy difícil?": **No.** Trivial el modelo; medio los adaptadores y el cron de re-cruce; el tuneo de la heurística es permanente; las APIs son ingeniería real aparte.

### 🧭 UX — "el caso bueno no agrega ni un paso"
- **La arquitectura ya favorece esto:** la mesa ya agrupa por origen; los 3 baldes (listas/por revisar/bloqueadas) y los 3 niveles de confianza ya existen → se reusan tal cual.
- **El molde de "¿misma venta?" ya está escrito** (el flujo de duplicados del bot: "esto parece ya registrado… [Descartar] [Aceptar igual]").
- **Camino feliz = invisible:** un cruce confiable se ve como una boleta normal con un sello discreto "2 fuentes". La complejidad solo aparece ante la duda.
- **Hub "Conectá tus fuentes"** homogéneo (MP con 1 clic / Binance con API key solo-lectura + guía visual / Telegram ya hecho / banco = el dropzone actual).
- **Degradación en positivo:** sin par, cae a "Por revisar" con salida en 1 toque ("Es una venta, boletear igual").

### 🎨 UI — "color = estado, nunca = marca"
- **Fuentes en monocromo** (gris). Si pinto Binance amarillo / MP celeste, choco con la semántica (azul ya = exenta). El único color es el **estado del cruce**: verde silencioso (auto) / ámbar (necesita ojo).
- **Una venta = una fila = una boleta.** Las pruebas se **apilan dentro del visor** (cluster `⧉3` colapsado, etiquetas al abrir), no se multiplican en la mesa.
- **Galería de pruebas** = extender el lightbox que ya existe + tira de tabs "frosted". MP (que no trae imagen) se muestra como **stat-card** con los datos.
- **Pantalla "Conectar"** en estilo stat-card, reusando el dot verde/azul-pulse/rojo y el botón rojo `#E8553E`.
- **La pregunta de desambiguación** vive **dentro del visor** (esto ↔ aquello, 2 botones), nunca un modal que corte el flujo masivo.

### 🧮 Contador tributario — "la cadena es correcta; cuidá el discurso y la renta"
- **Cripto = NO afecta a IVA → tipo 41. Correcto** (Of. SII 963/2018 + Art. 2 DL 825). Matiz de lenguaje: es "**no afecta**", no "exenta" (el tipo 41 cubre ambas, así que el documento está bien).
- **Una boleta por venta (no por fuente). Crítico** — emitir por cada prueba duplica el ingreso.
- **Monto = CLP recibido. Correcto**, con un matiz: si MP cobra **comisión**, el precio es el **bruto** que pagó el comprador (la comisión es **gasto**, no rebaja). No subvaluar usando "neto recibido".
- **"La boleta sigue a la plata" (percibido) es defendible** para el régimen probable (Pro-PyME 14D). Emitir el día del pago entra en el RCOF diario — correcto.
- **Pago partido:** UNA boleta por el total. Dos boletas chicas podrían leerse como **fraccionamiento** para evitar la identificación sobre 135 UF → cruzar por **orden** lo evita.
- **Ojo intermediación:** si alguien es **corredor puro** (cobra comisión sin tomar el activo), eso podría ser **servicio afecto tipo 39** (post-Ley 21.420), no 41. El modelo "compro y revendo con spread" sí es 41.
- **Multi-fuente = fortaleza de auditoría real** (justifica origen de fondos, Art. 70/71 LIR, justo bajo el cruce de la Ley 21.713). Conservar **6 años** el XML del DTE + cartola + orden + RCOF.
- **A confirmar con el socio:** el texto exacto de la **Res. 44/2025** (umbral 135 UF), el régimen de cada usuario, y que el usuario tenga **inicio de actividades con giro**.

### 🔒 Privacidad / Ley 21.719 — "tu mejor control no está enchufado"
- **🔴 Cablear el filtro de IA** (`redactForAI` + lista blanca de proveedores fail-closed): hoy está solo en su test; la glosa cruda con datos de terceros va a la IA. **Corrección #1.** Ampliar los patrones para nicks de Binance / nombre del pagador MP.
- **Rol bien encuadrado:** vos sos **ENCARGADO** del cliente (que es el responsable de los datos de sus contrapartes). El DPA ya lo modela. **No** pidas consentimiento a la contraparte: la base la pone el cliente (obligación legal tributaria + interés legítimo).
- **Custodia de API keys (bloquea la fase de APIs):** decidir **client-side** (la bóveda cifrada de la extensión, la key nunca toca el server — recomendado) vs **server-side** (tabla cifrada con llave maestra fuera de la DB). Hoy no hay bóveda server-side por empresa.
- **Binance offshore:** lo que regula la ley es la **salida** (lo que mandás a la IA), no la entrada. **Minimizar en la ingesta**: traer solo monto/fecha/tipo/identificador mínimo; **nada de KYC**.
- **Mistral sigue cableado** pese a que lo dimos por muerto → decidir: sacarlo o declararlo.
- **Actualizar** RAT / anexo de transferencias / DPA / EIPD con las fuentes nuevas.

---

## 7. Las fases (en qué orden se construye)

Cada vuelta cierra con gates verdes (tsc + eslint + vitest), como veníamos haciendo.

| Fase | Qué se construye | Estado / por qué |
|---|---|---|
| **S0 — Capa de storage (archivos → R2)** | Módulo único de archivos → Cloudflare R2; migrar el pipeline de documentos (subida server + ruta de servido + lectura) de Supabase Storage a R2 + script de migración de lo existente | **Arranca acá (antes/junto con F0).** No quemar el free tier de Supabase: archivos→R2, datos→Supabase (ver principio abajo) |
| **F0.5 — Tapar la fuga de privacidad** | ✅ **HECHO** (commit `0bcf314`): gate fail-closed en los 4 puntos de egress + fuera Mistral/DeepSeek directos. Redacción de la glosa diferida (toca el aprendizaje) | Era lo urgente |
| **F0 — Matar el bug del álbum** | Bot lee `media_group_id` (álbum = 1 venta) + guardar la hora del OCR; las imágenes **nacen en R2** | Alto impacto; mata el doble-conteo |
| **F1 — La quilla (modelo de datos)** | Tabla `transacciones` + columnas; backfill 1 tx por movimiento (cero cambio visible) | Base para fotos **y** APIs |
| **F2 — Adaptadores** | "Cada fuente = una cartola" (envolver banco + Telegram, sin fuentes nuevas) | La costura, sin riesgo |
| **F3 — Motor de cruce** | Función pura + tests con datos reales; ambigüedad → "por revisar" | El corazón; el motor de Emitir no se toca |
| **F4 — Llegada tardía + UI** | Cron de re-cruce; ver/confirmar/separar transacciones en la mesa | Para fuentes que llegan después |
| **F5 — Fuentes por API** | MP (API pública) primero, Binance (key solo-lectura) después | Lo más caro; necesita la quilla lista |

**S0 en sub-vueltas (es un refactor real, no un swap — R2 solo se escribe desde el server):**
- **S0a** — módulo `lib/storage.ts` (R2 + esquema de keys + tipo `provider`) + columna `storage_provider` en `documentos_subidos`. Foundation, no rompe nada.
- **S0b** — subidas del server (subir-procesar, Telegram, simpleapi/sii-local) → R2.
- **S0c** — ruta server de servido con URL firmada + lecturas provider-aware (visor/editor/cola/parser). La subida client-side (dropzone) pasa a ir por el server / URL prefirmada.
- **S0d** — script de migración de los archivos que hoy están en Supabase Storage → R2 + flip de punteros.

> **Principio de storage (decisión 2026-06-28):** TODO archivo (cartolas, comprobantes, PDFs, logos, imágenes) → **Cloudflare R2**; TODO dato → **Supabase**. R2 da **10 GB + egress ilimitado gratis** (vs 1 GB + 5 GB de Supabase) y a escala cuesta centavos. La DB de Supabase (500 MB free) es un techo aparte → Supabase Pro cuando haya clientes pagando. Detalle en la memoria `reference_cloudflare_r2`.

---

## 8. Decisiones que tenés que tomar

1. **Custodia de API keys (F5):** ¿**client-side** (bóveda de la extensión, recomendado) o **server-side** (cifrado en el servidor)? — desbloquea las APIs.
2. **Regla de auto-cruce:** ¿confirmás el principio "solo une con señal fuerte (código de orden); monto+hora iguales solo preguntan; nunca une la misma fuente"?
3. **Si solo existe la orden del exchange y aún no llegó la plata:** ¿emitir igual o **esperar el abono**? (recomiendo esperar la plata).
4. **Mistral:** ¿lo sacamos del código o lo declaramos en los papeles? (recomiendo sacarlo).
5. **Secuencia de APIs:** ¿MP antes que Binance? (la memoria del proyecto dice MP primero).
6. **Discurso del producto:** ajustar "exenta" → "no afecta"; y dejar claro que massdte **emite la boleta**, la **renta es del contador** (fuera de alcance — decisión tomada). ¿OK?
7. **Dónde vive "Conectar fuentes":** ¿sección nueva junto a Telegram en /empresa? (recomendado).

---

## 9. Riesgos a cuidar

- **Declarar de menos (peor que de más):** unir dos ventas reales del mismo monto. Mitigación: auto-cruce solo cross-fuente y con señal fuerte; el resto pregunta.
- **Zona horaria:** banco (hora Chile) vs exchange (UTC). Normalizar a hora Chile antes de comparar (ya tenés `chileDayStartUtc`).
- **La API key asusta al no-técnico:** empujar MP/OAuth primero; guía visual; copy "solo lectura, no podemos mover tus fondos".
- **No sobre-preguntar en Telegram:** preguntar solo ante match real; el resto, silencio.
- **Posicionamiento:** no insinuar cumplimiento tributario total (falta el costo para la renta).

---

*Documento de planificación. Las citas tributarias son criterio contable (no opinión legal); la numeración de la Ley 21.719 debe verificarse contra fuente oficial antes de firmar papeles.*
