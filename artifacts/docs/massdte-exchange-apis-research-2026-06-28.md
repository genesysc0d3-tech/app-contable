# Investigación — APIs de exchanges P2P para massdte (Chile)

**Para la fase F5 del [plan multi-fuente](./massdte-multifuente-plan-2026-06-27.md).**
Fecha: 2026-06-28 · 2 investigaciones en paralelo (panorama Chile + APIs técnicas), contra documentación oficial.

---

## 0. El hallazgo que define todo

> **Binance P2P es el ÚNICO exchange cuyo historial P2P se puede leer con una API key de SOLO LECTURA de un usuario normal.** OKX, Bybit y Bitget también tienen API P2P, pero las tres la **esconden detrás de estatus de "comerciante/anunciante verificado"** — un vendedor P2P común (vos, y el cliente típico de massdte) **no puede usarlas**. KuCoin y HTX directamente **no tienen** API de P2P fiat.

Conclusión: **se integra Binance primero y, por ahora, único.** Y justo es el que vos ya usás → datos reales para validar desde el día uno.

---

## 1. Binance P2P (C2C) — el carril

| Qué | Detalle |
|---|---|
| **Endpoint** | `GET /sapi/v1/c2c/orderMatch/listUserOrderHistory` |
| **Doc oficial** | developers.binance.com/docs/c2c/rest-api |
| **Auth** | API key + firma HMAC-SHA256. Basta permiso **"Enable Reading"** (solo lectura) + **whitelist de IP**. **No** requiere ser merchant. Nunca se pide permiso de trade/retiro. |
| **Trae exactamente lo que necesitamos** | `fiat` (= CLP), `totalPrice` (total CLP), `asset` (USDT/BTC), `amount` (cantidad cripto), `counterPartNickName` (**nick**, no nombre real → bueno para minimización), `orderStatus` (`COMPLETED`), `orderNumber`, `createTime`, `tradeType` (BUY/SELL) |
| **Disponibilidad Chile** | Legal, opera con CLP. Alerta CMF 2021 (no regulada) pero sin bloqueo en 2026 (≠ Argentina, bloqueada marzo 2026) |

**Gotchas a diseñar alrededor (verificados):**
- **Solo 6 meses de historia** → obliga a **polling periódico + guardar en DB** (no se puede backfill largo).
- **Ventana máx 30 días por consulta** + **bugs reportados de paginación/timestamps** en el foro oficial → consultar en bloques chicos (incluso día por día) y **deduplicar por `orderNumber`**.
- **Cambio de firma desde ~15-ene-2026:** hay que **percent-encodear el payload antes del HMAC** o rechaza las requests.
- Para el cruce: anclar en `orderStatus == COMPLETED` y matchear `totalPrice` + `createTime` contra el abono CLP de la cartola/MP.

---

## 2. Comparativa de los P2P globales

| Plataforma | API hist. P2P | Key solo-lectura | ¿Sirve a usuario común? | Trae CLP | Contraparte | Dificultad |
|---|---|---|---|---|---|---|
| **Binance** | ✅ `listUserOrderHistory` | ✅ "Enable Reading" + IP | ✅ **SÍ** | ✅ | ✅ nick (minimizado) | **Baja-Media** |
| OKX | ⚠️ existe, **docs privadas** | ❓ | ❌ Super/Diamond Merchant | ❓ | ❓ | Alta |
| Bybit | ✅ `/v5/p2p/order/...` | ❓ no documentado | ❌ requiere Advertiser | ✅ | ✅ nick + **nombre real** | Media-Alta |
| Bitget | ✅ `/api/v2/p2p/orderList` | ✅ Read-Only | ❌ requiere Merchant verificado | ✅ | ⚠️ **solo nombre real** | Media |
| KuCoin | ❌ no existe | — | — | — | — | N/A |
| HTX | ❌ no existe (P2P fiat) | — | — | — | — | N/A |

> OKX/Bybit/Bitget solo tendrían sentido en una **fase 2 para clientes que SEAN comerciantes P2P** (mesa de cambio / alto volumen). Ahí el más simple sería Bitget, luego Bybit, OKX al final.

---

## 3. Los exchanges locales chilenos son OTRA cosa (importante)

Buda.com, CryptoMKT y OrionX **no son P2P** — son **exchanges de libro de órdenes** (vendés contra la plataforma, no contra una persona). Tienen API con historial de operaciones + CLP:

| Local | Tipo | API | Key solo-lectura | Notas |
|---|---|---|---|---|
| **OrionX** | Libro de órdenes (GraphQL) | docs.orionx.com | ✅ **el más claro** (permiso "Stats" = solo ver) | *Verificar* rumor de giro "B2B only" |
| **CryptoMKT** | Libro de órdenes (REST v3) | developers.cryptomkt.com | ✅ keys con permisos acotados | SDKs Py/Node/Go/Java |
| **Buda.com** | Libro de órdenes (REST) | www.buda.com/api/v2 | ⚠️ confirmar scope read-only en panel | — |

**El reframe clave del modelo:** en un exchange (no-P2P) **no hay contraparte persona**. La "venta" es el *trade* (vendiste X USDT → recibiste Y CLP) y el abono en el banco es un **retiro del propio exchange**, no el pago de un comprador. → El **motor de cruce debe distinguir dos patrones**:
- **P2P (Binance):** muchos abonos chicos de **distintas contrapartes**.
- **Exchange (Buda/CryptoMKT/OrionX):** un **retiro consolidado** del exchange a tu banco.

Son un **segundo carril** útil (cubre al chileno que vende en exchange regulado y retira a su banco), pero con otra forma de evidencia.

---

## 4. Viento de cola regulatorio (oro para el pitch)

- **🔥 El SII ya obliga a los exchanges a reportar tus operaciones cripto.** Declaraciones Juradas **DJ 1964 (residentes) / DJ 1963 (extranjeros)**: los proveedores cripto deben reportar compras, ventas, transferencias y wallets de cada usuario. **Primera presentación: 30-jun-2026** (= ahora). El SII ya fiscalizó **13 casos recuperando ~$4.702 millones CLP** con esa data + Big Data. → **La venta P2P de tu cliente ya queda reportada por el exchange al SII; emitir la boleta correcta y a tiempo es justo el dolor que el SII está creando.** Es el motor de demanda.
- **Open Finance (CMF) NO sirve a corto plazo:** se postergó a **julio 2027** y el alcance inicial son bancos/tarjetas, no exchanges cripto. → El camino correcto es **la API key del propio cliente en cada plataforma** (exactamente el plan). No hay atajo de "finanzas abiertas".
- **Ley Fintech 21.521:** los locales (Buda/CryptoMKT/OrionX/Skipo) están regulados por la CMF (42 inscritas, 37 autorizadas a may-2026). Binance no.
- **Privacidad:** Binance entrega la contraparte como **nick** (no nombre real) → alineado con minimización (Ley 21.719). Ignorar el flag KYC. Bitget, en cambio, solo da nombre real (peor).

---

## 5. Recomendación de secuencia (fase F5)

1. **Binance P2P (C2C)** — PRIORIDAD 1, y por ahora único P2P. Único accesible para usuario común con key read-only; lo usás vos; trae todo; mayor cuota en Chile. Diseñar: polling incremental (6 meses), bloques ≤30 días, dedupe por `orderNumber`, percent-encode en la firma.
2. **Carril exchange local (OrionX → CryptoMKT → Buda)** — PRIORIDAD 2. Otra forma de evidencia (trade + retiro). Empezar por OrionX (read-only más limpio).
3. **Bybit / Bitget / OKX** — solo si aparece un cliente **comerciante** P2P (fase 2).
4. **Descartar hoy:** KuCoin, HTX (sin API P2P), Skipo/Lemon (sin API pública), Vita (es remesas), Fintual (es un fondo).

---

## 6. Fuentes oficiales

- Binance C2C: developers.binance.com/docs/c2c/rest-api · change-log (firma): developers.binance.com/docs/c2c/change-log · permisos key: developers.binance.com/docs/wallet/account/api-key-permission
- Bybit P2P: bybit-exchange.github.io/docs/p2p/guide · OKX P2P (gated): okx.com/p2p/api · Bitget P2P: bitget.com/api-doc/common/p2p/Get-P2P-Order-List
- KuCoin (sin P2P): kucoin.com/docs-new/introduction · HTX (sin P2P fiat): huobiapi.github.io/docs/spot/v1/en/
- Locales: buda.com/api/v2 · developers.cryptomkt.com · docs.orionx.com
- SII cripto / DJ 1963-1964: sii.cl/noticias/2025/220925noti02pcr.htm
- CMF Open Finance (postergación): cmfchile.cl/portal/prensa/615/w3-article-110881.html
- Ley Fintech 21.521 (BCN): bcn.cl/leychile/navegar?idNorma=1187323
- Chainalysis 2025 (Chile 6º LatAm, ~US$23.800M): chainalysis.com/reports/2025-geo-crypto-report/

**Incertidumbres marcadas:** no hay market-share dura por plataforma específica de Chile; endpoint P2P de OKX sin verificar (docs privadas); scope read-only de Buda sin confirmar en panel; posible giro "B2B only" de OrionX.

---

## 7. ACTUALIZACIÓN 2026-06-28 — la "puerta lateral" read-only (insight del fundador)

**Pregunta del fundador:** si el endpoint P2P dedicado está gated a "anunciante", ¿no hay igual un endpoint read-only de **movimientos de cuenta** que muestre la venta? → Verificado contra doc oficial, y **mejora la cobertura**:

- **🟢 Bitget — RESCATADO.** `GET /api/v2/tax/p2p-record` **NO es el API de merchant**: con key **read-only** devuelve `p2pTaxType:"sell"` + `coin` (USDT) + cantidad + `ts`. No trae CLP ni contraparte, **pero alcanza** para nuestro modelo: clasifica "venta cripto" y **cruza por timestamp + cantidad USDT** (el CLP lo pone el banco). *Caveats a validar con key real:* scope exacto (¿read-only normal o "tax"?), nombre del campo cantidad (`balance` vs `total`), rango histórico (30 vs 366 días). Verificación cruzada: `GET /api/v2/spot/account/bills` tiene `groupType=c2c` + `businessType=SELL` (semántica a confirmar).
- **🟢 Binance — confirmado** que su endpoint C2C de usuario **no** es merchant-gated (ya era el #1; además trae CLP + contraparte). El movimiento P2P NO aparece en otro ledger (sin doble rastro) → la fuente es ese endpoint.
- **🔴 OKX — NO.** No existe endpoint C2C en toda la API v5 (ni gated ni no; "C2C" = 0 menciones). En el mejor caso, una salida genérica de USDT en `asset/bills` **sin marca P2P** → heurística frágil, no confiable para afirmar "venta cripto exenta".
- **🔴 Bybit — NO.** P2P gated a "advertiser"; ningún endpoint no-gated (transaction-log, transfers, deposit/withdraw, convert) marca la operación como C2C/P2P.

**Mapa actualizado — viable HOY con key read-only de usuario común:**
- **Binance** (rico: trae CLP + contraparte + todo) y **Bitget** (lean: sell + coin + cantidad + timestamp; se cruza por hora+cantidad).
- **OKX / Bybit:** no confiable por API para el vendedor común → depender del **cruce banco-céntrico** (el abono ya entra por la cartola) o **export manual**, y marcar el origen como "no verificable por API". Solo tendrían el endpoint rico si el cliente es anunciante/merchant (fase 2).

> Refuerza el modelo: del exchange **no necesitamos el CLP** (lo da el banco); solo "fue venta cripto + cuándo + qué activo". Por eso Bitget (que solo da eso) ya sirve.
