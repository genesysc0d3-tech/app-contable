# Plan: folio propio (emitir por API con CAF), largo plazo (2026-09-28)

> Plan, **no construido**. Hermano de `plan-emision-confiable-2026-09-28-{extension,app}.md`: esos dos arreglan
> el portal (red de seguridad); este plan cambia la raíz.
>
> **Base de cada afirmación:** `archivo:línea` = leído hoy en la rama `fix/costo-vercel`. "Memoria" = fichas del
> proyecto, no re-verificado en vivo. "No verificado" = hay que confirmarlo antes de construir. Lo tributario
> lleva norma/fuente; si dice "confirmar", Matías o el SII tienen la última palabra.

**El problema en una línea:** en e-Boleta (portal gratuito, RPA) el SII asigna el folio **al final**; si la
extensión se cae entre "EMITIR" y leer el folio, no sabemos si salió ni con qué número (LC, folio 24531, memoria).
Con CAF propio el folio lo ponemos **nosotros antes de enviar**: un cuelgue deja un folio **conocido** y basta
preguntarle al SII por ESE folio. Es el ID que Stripe genera antes del cobro (principio 5 del incidente LC).

---

## 1. Qué existe hoy en el repo

### 1.1 La cadena SimpleAPI ya está armada (de punta a punta, en papel)

| Pieza | Dónde | Qué hace |
|---|---|---|
| Reserva central de folio | `src/lib/emission/folio-reservas.ts:22-52` (`reserveSimpleApiFolio`) | `max(boletas_emitidas, folio_reservas no liberadas) + 1` (`:156-178`), inserta `reservado`; choque de índice único (23505) → reintenta hasta 5 veces (`:47`) |
| Tabla + índice único | `supabase/migrations/20260617193000_simpleapi_folio_reservas.sql` | `unique(job_id)` + único `(empresa, tipo, folio) where estado <> 'liberado'`; estados `reservado → generado → usado / liberado / fallido / vencido` |
| Se reserva al crear el job | `src/app/api/emision/jobs/route.ts:487-515` | solo si `provider === "simpleapi"`, con el candado ya tomado; vence con el candado (`expiresAt: lock.lockedUntil`) |
| Cierre de la reserva | `folio-reservas.ts:131-154`, llamado por `locks.ts:137` | `completed → usado`; `failed/cancelled/expired` desde `reservado → liberado` (folio vuelve al pozo), desde `generado → fallido` (folio queda ocupado) |
| Firma del DTE | `src/app/api/simpleapi/dte/generar/route.ts:93-131` | exige la reserva (`reservado`, mismo folio/tipo/job), la pasa a `generado` ANTES de llamar a SimpleAPI (`:110`) |
| Sobre, envío, consultas, PDF | `src/lib/emission/simpleapi-multipart-proxy.ts:77-113` + rutas `envio/generar`, `envio/enviar`, `consulta/envio`, `consulta/dte`, `impresion/...` | proxy efímero; exige reserva `generado` (`:81`) |
| Orquestación en la extensión | `extensions/sii-portal-rpa/modules/simpleapi-vault.js:157-253` (`emitSimpleApiDteFromVault`) | generar → sobre (`EnvioBOLETA` si 39/41, `:184`) → enviar (`Tipo: 2` para boleta, `:190`) → trackId → consulta envío → consulta DTE → PDF |
| Bóveda del certificado + CAF | `simpleapi-vault.js:282-420` | `.pfx` + clave + CAF cifrados en `chrome.storage.local` (PBKDF2 250k, `:23`); ambiente 0/1 (`:48-50`, default certificación) |
| Guarda el resultado | `src/app/api/simpleapi/result/route.ts` | exige trackId + XML + `EPR` y `DOK` (`:110-116` del handler), valida folio/tipo/total contra el XML, "el folio manda" con `pdf_pendiente` (`:272-317`) |

### 1.2 Estado real: andamiaje, NO producción

- **Boletas 39/41 por SimpleAPI no están enchufadas a la UI.** La boleta única solo usa SimpleAPI para facturas
  33/34 (`src/app/(app)/escritorio/v5/EmitirDirectaView.tsx:397`). El lote no tiene carril SimpleAPI
  (`EmitirTabContent.tsx:401-409` lo bloquea; `lote-runner.ts` no lo nombra).
- **Solo dev puede elegirlo:** botones SimpleAPI `disabled={pending || !devMode}`
  (`src/app/(app)/empresa/EmissionProviderConfig.tsx:295` boletas, `:592` facturas). El copy dev dice "el proxy
  efímero existe, falta conectarlo desde la extensión" (`:320`).
- **¿Alguna empresa lo usa? ¿Salió algún folio real?** **No verificado**: no tuve acceso a la base desde acá
  (el MCP de Supabase rechazó el proyecto). Correr (solo lectura):
  ```sql
  select emision_proveedor, tipo_dte, count(*), min(created_at), max(created_at)
    from boletas_emitidas group by 1,2;
  select estado, count(*) from folio_reservas group by 1;
  select coalesce(boletas_emision_proveedor, emision_proveedor) b, facturas_emision_proveedor f, count(*)
    from empresas group by 1,2;
  ```
  Memoria: los carriles reales hoy son `sii_local` (portal) para boletas y facturas; SimpleAPI "standby"
  (auditoría 2026-07-24).

### 1.3 Huecos que encontré leyendo (arreglar antes de usarlo en serio)

1. **La reserva no conoce el rango del CAF.** `currentMaxFolio` (`folio-reservas.ts:156-178`) no sabe `D`/`H`.
   Primera boleta de una empresa → folio 1; si el CAF empieza en 1001, la extensión rechaza con
   `CAF_FOLIO_RANGE_EXHAUSTED` (`simpleapi-vault.js:477`, `:506-510`). Y al agotarse el CAF el servidor sigue
   reservando `H+1`. El servidor debe guardar metadatos NO secretos del CAF (tipo, desde, hasta, fecha de
   autorización) y reservar dentro del rango.
2. **Un solo CAF por bóveda** (`caf_info` único, `simpleapi-vault.js:497`, `:543-547`): no hay 39 y 41 a la vez ni
   empalme de CAF nuevo cuando se acaba el anterior.
3. **"Enviado pero sin confirmar" se pierde.** La extensión consulta el DTE justo después del envío, sin esperar
   (`:198-224`). Si el SII aún está procesando, `ok=false` → `result` responde `SII_ACCEPTANCE_REQUIRED`
   (`route.ts`, handler `:110-116`) → el job cierra `failed` → la reserva queda `fallido`… pero el SII puede
   aceptarla segundos después. Es el mismo "a medias" del portal, con una diferencia enorme: **sabemos el folio y
   el trackId**. Falta persistirlos y volver a preguntar.
4. **El trackId vive solo en memoria de la extensión** hasta el `result` final. Si el SW muere después de
   `envio/enviar`, perdemos el trackId (el folio no: está en `folio_reservas`).
5. **`ServidorBoletaREST: false`** en las consultas de boleta (`simpleapi-vault.js:202`, `:218`). Para 39/41 el
   SII usa el servicio REST de boletas (ver §2.3); **no verificado** si SimpleAPI necesita `true` ahí.
6. **El `.pfx` viaja por nuestro servidor en cada llamada** (multipart, `simpleapi.ts:98-104`) y llega a SimpleAPI.
   "No custodiamos" es cierto en reposo, no en tránsito: SimpleAPI es encargado de tratamiento → DPA (21.719)
   antes de datos reales (misma vara que Vercel/Supabase, memoria).
7. La reserva vence con el candado (15 min, `jobs/route.ts:494`). Con folio propio eso está bien: vencer
   `generado` → `fallido` no libera el número (`folio-reservas.ts:147`). Bien diseñado; mantenerlo.

---

## 2. Qué se necesita del lado SII y de la clienta

### 2.1 Certificado digital (firma electrónica) de la clienta
- Firma el DTE y el sobre (XMLDSig) y autentica ante el SII (semilla/token). Ley 19.799; formato `.pfx`.
  Fuente: skill contador, `api-plataforma-sii.md` §2-3.
- Lo emite un prestador acreditado (E-Sign, Acepta, TOC, etc.). Vigencia 1-3 años.
- **Costo:** del orden de decenas de miles de pesos al año (**no verificado**, cotizar). **Lo paga la clienta**
  (es su identidad; muchas ya lo tienen para el SII). El titular del certificado debe estar autorizado por la
  empresa ante el SII como usuario de facturación electrónica (**confirmar con Matías**).

### 2.2 Autorización como emisor con software de mercado/propio
- Hoy LC/MH emiten con el **sistema gratuito del SII**. Emitir con CAF propio = pasar a "software de mercado"
  (SimpleAPI) o propio. **Confirmar con Matías / SII:** (a) si el contribuyente debe postular/declarar el
  cambio de sistema en sii.cl o basta con pedir CAF; (b) si con software de mercado el contribuyente igual pasa
  un set de pruebas (en facturas el set lo pasa el software; para boletas **no verificado**); (c) si puede usar
  **ambos sistemas a la vez** para el mismo tipo 39/41 (esto decide si el portal sirve de fallback, §4).
- La carátula del sobre lleva `FchResol`/`NroResol` de la empresa (ya se piden en la bóveda:
  `simpleapi-vault.js:180-181`). En certificación `NroResol` = 0 (skill, §5).

### 2.3 Normas de boleta que aplican
- **Res. Ex. SII N° 74/2020**: boleta electrónica obligatoria y envío del documento al SII (fuente:
  sii.cl/normativa_legislacion/resoluciones/2020/reso74.pdf). Plazo de envío mencionado en fuentes secundarias:
  hasta 1 hora desde la emisión (**confirmar en el texto**).
- **Envío por API REST de boletas** (`enviarBoleta`, documentación en www4c.sii.cl/bolcoreinternetui/api/), no
  por el upload SOAP de facturas. Instructivo técnico: sii.cl/factura_electronica/factura_mercado/
  Instructivo_Emision_Boleta_Elect.pdf.
- **RCOF: ya NO se envía desde el 1-ago-2022 (Res. Ex. SII N° 53/2022)** según fuentes secundarias —
  **confirmar en el texto**. Ojo: la referencia del skill (`api-plataforma-sii.md` §6) todavía dice "RCOF diario"
  y "la boleta no se envía individualmente": **está desactualizada** en ese punto.

### 2.4 CAF
- XML firmado por el SII con el rango autorizado y la llave privada para el TED (skill §8). Se pide en sii.cl por
  tipo y cantidad. **Es secreto** (tiene `RSASK`): se queda en la bóveda, al servidor solo van tipo/desde/hasta.
- Vigencia de CAF de boletas y obligación de **anular folios no usados**: skill §8 lo dice en general
  ("típicamente 6 meses para boletas"); **confirmar** plazo exacto y si aplica a boletas.

### 2.5 Costos y quién paga (regla: gratis hasta que haya cliente que pague)
| Ítem | Quién | Cuándo |
|---|---|---|
| Certificado digital | clienta | antes de activar su carril |
| SimpleAPI | nosotros, dentro del precio del plan | **solo cuando haya una clienta que pague**. Tramo gratis: 500 consultas/mes (simpleapi.cl/Precios y /FAQ, **no leído directo**). Nuestro flujo gasta ~6 llamadas por boleta (`simpleapi-vault.js:157-253`) → ~80 boletas/mes: alcanza para certificación y un piloto chico, no para LC (cientos por lote). Plan anual: **precio no verificado** |
| Integración directa (§3b) | nosotros, en horas | sin costo en plata |

### 2.6 Tiempos (estimados, no verificados)
Certificado: días. Cambio de sistema/postulación + CAF: días a semanas (depende de §2.2). Pruebas en
certificación (maullin): 1-2 semanas nuestras. Piloto: 2-4 semanas.

---

## 3. Opciones

| | (a) Proveedor intermedio (SimpleAPI) | (b) Directo al web service del SII |
|---|---|---|
| Costo plata | suscripción anual cuando haya cliente | 0 |
| Esfuerzo | bajo: la cadena ya existe (§1.1); faltan §1.3 | alto: XMLDSig + TED con llave del CAF, ISO-8859-1, semilla/token, REST boletas, consultas, PDF417, set de pruebas (skill §12-14) — meses |
| Riesgo técnico | bajo-medio (dependemos de su interpretación del SII) | alto al principio (firma/canonicalización son el error clásico, skill §12) |
| Dependencia | un tercero más (caída, precio, DPA) | solo el SII |
| Datos | `.pfx` y CAF transitan a SimpleAPI → DPA | nunca salen de nuestra cadena |
| Librerías | — | LibreDTE **descartada** (AGPL sin licencia comercial, memoria). Hay libs abiertas (p.ej. `devlas-cl/dte-sii`), **licencia y calidad no verificadas** |

**Recomendación:** (a) primero, porque ya está 80% hecho y la meta es **idempotencia**, no ahorrar la
suscripción. (b) solo si el volumen lo justifica o SimpleAPI falla; el contrato `providers/` (`src/lib/emission/`)
permite cambiar el proveedor sin tocar la UI (memoria: "la app nunca habla directo al SII").

---

## 4. Convivencia con el RPA y cómo cambia el lote

### 4.1 Carril por empresa (ya existe la perilla)
`empresas.boletas_emision_proveedor` / `facturas_emision_proveedor` (`src/lib/intermediario/client.ts:170-202`,
`providerForTipoDte` `:165-168`). Una empresa está en `sii_local` **o** `simpleapi` por grupo; nada de mezclar
dentro de un lote.

### 4.2 Transición
1. Clienta sube certificado + CAF a la bóveda (extensión). El servidor recibe solo tipo/desde/hasta.
2. **Corte limpio:** se termina el lote en curso por el portal, se cuadra (plan app §1), y recién ahí se cambia el
   carril. El folio del CAF propio es otra serie; la "correlatividad" del portal no aplica.
3. **Fallback al portal:** solo si el SII permite los dos sistemas a la vez (§2.2c). Si no, el fallback es
   "esperar" (cola), no "volver al portal". **No verificado; es la pregunta más importante a Matías.**

### 4.3 El lote con folio propio (máquina de estados)
```
reservar folio (servidor, dentro del rango CAF)      folio_reservas: reservado
  → firmar DTE (SimpleAPI dte/generar)               generado   ← desde aquí el número está gastado
  → ANOTAR "voy a enviar" (servidor)                 enviando   (nuevo)
  → enviar (REST boletas) → trackId
  → ANOTAR trackId (servidor)                        enviado    (nuevo; trackId persistido)
  → consultar envío / DTE (con reintentos y espera)  aceptado → usado + boletas_emitidas
                                                     rechazado → fallido (motivo del SII)
```
**Un cuelgue en cualquier punto deja un folio conocido.** El que retoma (la extensión, o un barrido del servidor si
las consultas no piden el `.pfx`, **no verificado**) mira la reserva:
- `reservado` → no se firmó: se libera y se reintenta (mismo folio o siguiente).
- `generado`/`enviando` sin trackId → se consulta el DTE por **folio + tipo + monto + fecha** (`consulta/dte`): si
  existe, se registra; si el SII no lo tiene, se **reenvía el MISMO XML firmado** (mismo folio: idempotente, el SII
  rechaza un folio repetido, skill §14 código 5).
- `enviado` con trackId → se consulta el trackId hasta tener respuesta.

Nunca hay "¿salió o no?" sin respuesta posible: la pregunta siempre tiene a quién hacérsela.
**Nunca** se reserva un folio nuevo para una propuesta que ya tiene uno `generado` o más: el folio viaja con la
propuesta (índice único `propuesta_id` en reservas activas, nuevo).

### 4.4 Qué ve la clienta
Lo mismo que hoy, una línea por boleta: "salió con folio N" / "el SII la rechazó: motivo" / "enviada, esperando al
SII" (se resuelve sola). Desaparece "quedó a medias" como estado final.

---

## 5. Fases y criterios para pasar

| Fase | Qué | Criterio para pasar |
|---|---|---|
| **F0 — Preguntar** (sin código) | SQL de §1.2; a Matías: §2.2 a/b/c, RCOF, vigencia CAF, anulación de folios; leer Res. 74/2020 y 53/2022 | respuestas escritas en una ficha de memoria |
| **F1 — Cerrar huecos en certificación** (maullin, cuenta dev, CAF de prueba) | §1.3 (1)-(5): rango CAF en servidor, varios CAF por tipo, estados `enviando`/`enviado` con trackId, consulta con espera, `ServidorBoletaREST` correcto, carril SimpleAPI en el lote | 50 boletas de prueba **matando la extensión en cada paso** (antes de firmar, después de firmar, después de enviar): 0 folios duplicados, 0 folios sin estado conocido, todo resuelto sin intervención |
| **F2 — Piloto** | **una empresa que pague**, con su certificado y su CAF; aquí se contrata SimpleAPI (gatillo de la regla "gratis") + DPA firmado | 2-4 semanas, 0 dobles, 0 huecos sin explicar, cuadre contra el RCV del SII (plan app §4) |
| **F3 — Carril recomendado** | clientas con certificado pasan a folio propio; portal queda para quien no tenga certificado | onboarding en ≤ 5 min (subir `.pfx` + CAF), alertas de vencimiento funcionando |
| **F4 — Opcional** | integración directa (§3b) | solo si el costo SimpleAPI por clienta supera lo que cobra, o SimpleAPI falla |

### Riesgos
- **Folios reservados y no usados.** `reservado` que vence se libera (bien). `generado`/`fallido` que nunca llegó
  al SII = hueco en la serie → anularlo en sii.cl (**confirmar si es obligatorio en boletas**) y mostrarlo en /dev.
  Reenviar el mismo XML antes de declararlo hueco.
- **Rechazos del SII** (esquema, firma, monto, folio fuera de rango, skill §14): el folio queda `fallido`, la
  propuesta vuelve a lista con folio NUEVO solo si el SII confirmó el rechazo de ese folio.
- **Certificado vencido o clave cambiada:** alerta 30/7/1 días antes (la vigencia se lee del `.pfx` al guardarlo);
  al vencer, el carril se pausa solo (no se cae a mitad de lote).
- **CAF agotado o vencido:** alerta al 80 % del rango y por fecha; nunca reservar fuera del rango (§1.3.1).
- **Doble sistema:** si la clienta además emite a mano en el portal con la misma serie → imposible con CAF propio
  (otra serie), pero confirmar §2.2c.
- **Dependencia de SimpleAPI:** caída = boletas en cola, no perdidas (el folio ya está reservado y el XML firmado).
  Guardar el XML firmado en el servidor en cuanto existe (es el documento legal; conservación art. 17 y 200 CT,
  6 años — memoria).
- **Datos:** `.pfx` en tránsito por Vercel y SimpleAPI → DPA + no loguear multipart (ya se sanitiza,
  `simpleapi.ts:106-133`).

---

Fuentes externas consultadas (búsqueda, no leídas completas): sii.cl Res. Ex. 74/2020
(https://www.sii.cl/normativa_legislacion/resoluciones/2020/reso74.pdf), Instructivo técnico boleta
(https://www.sii.cl/factura_electronica/factura_mercado/Instructivo_Emision_Boleta_Elect.pdf), API boletas SII
(https://www4c.sii.cl/bolcoreinternetui/api/), resumen Res. 53/2022 en
https://blog.iconstruye.com/explicacion-nueva-resolucion-boleta-electronica-sii, SimpleAPI
(https://www.simpleapi.cl/Precios, https://www.simpleapi.cl/FAQ).
