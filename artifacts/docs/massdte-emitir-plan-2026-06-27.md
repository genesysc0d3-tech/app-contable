# Plan FINIQUITADO: "Emitir" como continuación de "Check" + guardián con IA

> En simple, para entender sin programar. Fecha: 2026-06-27. **v2 — revisado por 4
> especialistas (código, UI, UX, contador).**
> **Disclaimer:** no es asesoría legal/tributaria. Las "reglas" ayudan a no
> equivocarse; la responsabilidad tributaria final es del contribuyente. La IA es
> **segunda opinión, no garantía.**

## La idea en 3 frases

1. El producto es una línea de producción: **Subir → Check (DECIDIR) → Emitir (EJECUTAR) → Boletas (CONSULTAR).**
2. Hoy "Emitir" vuelve a preguntar lo que "Check" ya debía resolver (afecta/exenta) — esa duplicación es la incoherencia.
3. Solución: **Check decide, Emitir solo confirma y dispara**, con un **guardián** de dos capas: **reglas** (gratis, frenan lo que está mal) + **DeepSeek** (2ª opinión, solo avisa).

---

## ⚠️ Lo que cambió tras la revisión (4 hallazgos críticos)

**1. Hoy la decisión de Check NO viaja bien a Emitir — y hay un bug.**
La decisión afecta/exenta existe en 3 lugares y ninguno manda: Check la guarda, pero la cola de Emitir **la ignora y re-adivina** con la IA, y los botones de Emitir mandan otra cosa. Peor: **una propuesta marcada EXENTA en Check hoy DESAPARECE de la cola** (bug real: la lista de tipos emitibles no incluye "exenta").
→ **Consecuencia:** no se puede hacer "Emitir solo lee la decisión" (F2) hasta **guardar bien la decisión** primero. Eso (que estaba en F4) **sube de prioridad: va antes de F2.**

**2. El guardián hoy solo vigila el modo PRUEBA.**
Las reglas corren solo en el carril mock. Los carriles que emiten boletas **REALES** no pasan por ninguna regla (validan en el "callback", cuando la boleta ya existe en el SII = tarde).
→ **El control #1 antes de prender lo real:** el guardián debe correr en el **mismo carril real, ANTES de despachar al SII.** Es el candado (kill-switch) de F4.

**3. La lista "Listas" miente.**
Lo dudoso (IA con poca confianza) cae en "Listas" con un cartel "revisa antes de emitir". Si la lista que se llama *lista* trae cosas que no deberías disparar sin mirar, el lego pierde lo único que vende el producto: confiar en el montón.
→ **Fix barato (el dato ya existe):** 3 baldes — **Listas / Por revisar / Bloqueadas**. En "Listas" solo lo emitible sin leer uno por uno. Lo dudoso va a "Por revisar" → vuelve a Check. **Se adelanta a F1.**

**4. (Privacidad) El "candado de IA" hoy NO cubre a DeepSeek directo.**
El gate que bloquea modelos gratis solo se aplica al carril OpenCode; la API directa de DeepSeek (`api.deepseek.com`, infraestructura en China) pasa sin freno y NO está en los documentos de compliance (RAT/transferencias). Mandar RUT+nombres ahí sería transferencia internacional sin amparo.
→ **Fix (elimina casi todo el trabajo legal):** F3 usa el **modelo DeepSeek pero por el carril OpenCode Go** (retención cero, ya amparado en el RAT), NO la API directa, y manda **solo datos seudonimizados** (sin RUT ni nombre real). Se agrega un **punto único de salida de IA** (allowlist, fail-closed) en el Paso 0.

> Los 4 especialistas, por separado, coincidieron en la **quilla**: una sola
> función ("motor de reglas") que decida, y que la use TODO (la cola, el backend y
> el carril real). Sin eso, todo lo demás se desincroniza.

---

## Tabla: ANTES (hoy) → DESPUÉS

| Tema | Antes | Después | Por qué importa |
|---|---|---|---|
| **Rol de cada pestaña** | Check y Emitir se pisan | **Check = decidir. Emitir = ejecutar** | Siempre sabes en qué paso estás |
| **La decisión afecta/exenta (IVA)** | En 3 lugares, ninguno manda (y las exentas desaparecen) | **Se guarda una vez en Check** y Emitir la lee | Una sola verdad, sin contradicciones ni bugs |
| **Lo dudoso (IA insegura)** | Cae en "Listas" como si estuviera listo | **Balde "Por revisar"** → vuelve a Check | "Listas" deja de mentir |
| **Antes de emitir** | Dispara directo, sin freno | **Hoja "¿confirmas?"** (N boletas · con/sin IVA · total · PRUEBA/REAL) | Emitir es **irreversible** (solo NC 61) |
| **Después de emitir** | Mensajito que se desvanece | **Recibo** con folios ✓ y qué falló | El folio es lo más importante; hoy ni lo ves |
| **¿Prueba o real?** | Ambiguo (¡una de prueba dice "Aceptada por el SII"!) | **Badge PRUEBA/REAL** siempre visible | Nunca creer que emitiste cuando no |
| **La IA que te cuida** | Invisible | **Reglas que frenan + DeepSeek 2ª opinión** | Tu red de seguridad + tu diferenciador |
| **Cómo se ve Emitir** | "Otra app", denso, vacío negro | **Mismo lenguaje del visor** (chip verde/azul, monto grande) | Sensación de producto serio |
| **Folios y aviso al SII** | Folios en silencio; sin reporte diario | Se validan antes + se prepara el **RCOF** | Candado antes de lo REAL |

---

## El plan FINAL por fases (orden corregido)

| Paso | Qué hacemos | Esfuerzo | ¿Toca SII real? |
|---|---|---|---|
| **0 — Motor de reglas + chokepoint de IA** | (1) `emision-decision.ts`: una sola función que decide bloquea/avisa, reusada por cola + backend + carril real. (2) **Punto único de salida de IA** (allowlist fail-closed + seudonimizar antes de enviar). Tests determinísticos | Medio | No |
| **F1 — Frenos + confirmación + recibo + 3 baldes** | Reglas que bloquean; hoja "¿confirmas?"; recibo con folios (la API ya los devuelve); separar Listas / Por revisar / Bloqueadas. + quick wins | Medio | No (mock) |
| **P — Guardar la decisión** | Columna `tipo_dte` en la propuesta; Check la escribe; cola y backend la leen; **arreglar el bug de las exentas** | Medio | No |
| **F2 — Emitir = ejecutar** | Tipo como chip read-only + "Corregir en Check →"; lo dudoso se queda en Check; look del visor | Medio | No |
| **F3 — 2ª opinión IA** | Por lote, solo avisa, timeout/fallback. **Usa el modelo DeepSeek por el carril OpenCode Go (retención cero, ya amparado), NO la API directa. Manda solo datos seudonimizados** (sin RUT/nombre real, documento crudo ni imágenes) | Medio | No (usa tokens) |
| **F4 — Plomería REAL** | RCOF diario (nuevo), pre-validar folios/CAF, **guardián en el carril real antes de despachar**, flag `emision_real_habilitada` | Alto | **Sí — habilita lo real** |

**Quick wins (ya):** badge PRUEBA/REAL (arreglar "Aceptada por el SII" del BoletaVisor — el select de datos no trae el flag `emision_sandbox`); "1 listas"→"1 lista"; mostrar las **razones** de la IA que ya existen pero no se ven.

---

## Lista definitiva de reglas del guardián

**BLOQUEAN (gratis, determinísticas) — el guardián real:**

| Regla | Condición | Mensaje (simple) | Estado |
|---|---|---|---|
| Detalle vacío | Sin glosa/qué se vendió | "Falta decir qué se vendió" | OK |
| Monto inválido | ≤ 0, no entero, o no cuadra con el detalle | "El monto no es válido o no cuadra" | OK |
| **Afecta con IVA $0** | Tipo 39 con IVA = $0 | "Una boleta con IVA no puede tener IVA $0" | **FALTA** |
| **Receptor sobre 135 UF** | total > 135 UF sin RUT/nombre/medio de pago | "Sobre $5,48M hay que identificar al comprador" | OK (UF viva) |
| RUT inválido | Dígito verificador malo | "El RUT del cliente no es válido" | OK |
| **No es venta** | Sueldo/préstamo/devolución/cuenta propia (peso alto) | "Esto no parece una venta, es {motivo}" | OK |
| **Transferencia sin contexto** | Glosa cae al default, sin decisión humana | "No confirmamos que sea venta. Revísala en Check" | **FALTA** |
| **IA insegura** | Confianza bajo umbral sin override humano | "La IA no está segura; revísala tú" | **FALTA en backend** |
| Duplicada | Ya tiene boleta vigente | "Ya emitiste boleta por esto (folio X)" | OK |
| **Sin folios (real)** | Folios disponibles < ítems del lote | "No tienes folios suficientes; pide CAF" | **FALTA real** |
| Sin certificado (real) | Proveedor real sin .pfx | "Falta cargar tu certificado del SII" | OK |
| Emisor incompleto | Falta RUT/razón social/**giro** | "Completa los datos de tu empresa (incl. giro)" | PARCIAL (giro) |
| Permiso/plan/lock | Rol, plan inactivo, otra emisión en curso | (según caso) | OK |

**AVISAN (no bloquean) — DeepSeek 2ª opinión, por LOTE, una frase, y si no está seguro CALLA:**
- "8 de 12 son del mismo cliente por el mismo monto, ¿no será la misma venta repetida?"
- "Una es de $4.300.000, muy sobre el resto. Mírala."
- Mira: ventas que huelen a P2P/devolución/sueldo, coherencia giro↔glosas, outliers, fechas fuera de período, mezcla rara (cripto exento en lote de ventas).
- **NO mira** (lo cubren las reglas): aritmética de IVA, RUT, umbral 135 UF, duplicado exacto, folios, mock/real.
- **Importante:** ante baja confianza **NO se voltea a exenta automático** (eso subdeclara IVA) **ni a afecta** (carga IVA de más) — **decide el humano** en Check.

**Umbrales:** auto-listo solo si confianza-ingreso ≥ 0.85 **y** confianza-tipo ≥ 0.80 **y** no es "no-venta" **y** receptor OK si >135 UF **y** IVA>0 si es afecta. Si falla algo → se queda en Check.

---

## Capa de privacidad (Ley 21.719) — se construye en el Paso 0

| Control | Qué hace | Principio (Ley 21.719) |
|---|---|---|
| **Punto único de salida de IA** | Todo llamado a IA pasa por un solo lugar; allowlist de proveedores con retención cero; lo desconocido se bloquea (fail-closed) | Responsabilidad proactiva; encargado/sub-encargado (Art. 15 bis) |
| **Seudonimizar antes de enviar** | Enmascara RUT y nombres en la glosa; reemplaza la identidad por un token (hash). F3 nunca recibe RUT/nombre real, documento crudo ni imágenes | Minimización / proporcionalidad (Art. 3) |
| **F3 por carril amparado** | Usa el modelo DeepSeek vía OpenCode Go (retención cero, ya en el RAT), NO `api.deepseek.com` (China, sin amparo) | Transferencia internacional con garantía (Art. 27 y ss.) |
| **Borrar el rastro** | Redactar la glosa antes de guardar `audit_chunks`, o ponerle vencimiento (TTL) | Minimización + plazo de conservación (Art. 3) |
| **Anotar F3 en el RAT** | Una línea: "F3 – 2ª opinión IA, interés legítimo, retención cero" + frase en la política de privacidad | Base de licitud + transparencia (Art. 12-14) |

**Qué puede salir a F3 (seudonimizado):** fecha, monto, tipo (afecta/exenta/cripto/p2p), glosa **redactada**, "mismo cliente" como token.
**Qué NO sale nunca:** RUT real, nombre real, RUT de tu empresa, nº de cuenta, imágenes.

---

## Checklist F4 — antes de prender lo REAL (no diferible)

1. Carril real certificado + certificado digital delegado (.pfx) — o certificación SII (Maullín→Palena) si fuera directo.
2. CAF reales (folios) para 39, 41 y 61 + **pre-validar folios antes del lote** (hoy el mock los auto-fabrica).
3. **RCOF diario** (Reporte de Consumo de Folios — obligatorio en boleta electrónica; hoy NO existe, solo RCV mensual).
4. **Nota de Crédito 61 operativa** (es el único remedio de un error irreversible).
5. **Mover el guardián al carril real, ANTES de despachar al SII** (hoy solo vigila el mock).
6. Kill-switch + badge PRUEBA/REAL: `emision_sandbox=false` solo cuando 1–5 estén OK.

**Diferible:** facturas 33/34, PDF/glosa cosméticos, automatizar F29, conexiones automáticas.

---

## Lo bueno: media solución YA existe
Check ya agrupa por confianza; la API ya devuelve folios/errores; la regla de 135 UF está bien (UF viva); el folio es atómico; cripto/forex ya quedan exentas. Varias cosas son **mostrar/ordenar lo que hay**, no inventar.

## El riesgo #1 a vigilar
**No hacer F2 (chip read-only) antes de guardar y leer la decisión** (paso P). Si no, el chip mostraría una decisión re-adivinada por la IA que puede contradecir lo que elegiste en Check — la misma incoherencia, pero ahora invisible porque ya no hay botón para corregirla.
