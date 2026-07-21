# massDTE — Roadmap pre-beta (plan unificado, 2026-06-29)

Síntesis de 6 planes de ejecución (seguridad, legal, tributario, emisión/NC, billing, IA/pipeline),
cada uno hecho por un agente sobre hallazgos YA verificados contra el código. **Modelo:** los agentes
planifican → este doc es el plan unificado → la ejecución la hace el dev (yo), con migraciones a prod
aplicadas a mano tras revisar (staging → test → prod).

## Recomendación de configuración de beta
Los agentes convergen: **beta chica GRATIS + MOCK**, y **emisión REAL solo para dogfooding del fundador**
(su RUT, vigilando). Eso baja el alcance de "semanas" a ~**2 semanas** y evita los riesgos catastróficos
de la emisión real a terceros. Cambiar a PAGA o REAL suma trabajo (ver sección final).

---

## 🔴 BLOQUEANTES — abrir beta (GRATIS + MOCK). ~2 semanas dev.

### A. Seguridad — cierra fuga cross-tenant (yo; migraciones staging→prod; NO destructivo)
1. **Deny-anon `audit_chunks` + `parser_logs`** — hoy `USING(true)` en DB viva → cualquier logueado lee texto crudo de cartola de TODOS por PostgREST. `DROP POLICY`. Las escrituras van por service-role (no se rompe). `supabase/migrations/` nueva.
2. **`FOR ALL`→`FOR SELECT`** en tablas tenant (documentos_subidos, movimientos_raw, propuestas_ia, documentos_tributarios, clientes, gastos, etc. + empresas) — hoy el usuario puede borrar/mutar su propio DTE (folio real) por la API saltando los guards server. Migración con DO-loop. (NO tocar `usuarios`.)
3. **Auth-gate `sii-mock/caf/solicitar`** — hoy sin auth, toma empresa_id del body, mintea folios. Replicar patrón de `rcv/route.ts` (empresa de la sesión). `src/app/api/sii-mock/caf/solicitar/route.ts`.

### B. Legal — cablear lo ya hecho (dev + 1 input del fundador)
4. **[FUNDADOR] Identidad AlphaCode SpA**: RUT + domicilio + **correo de privacidad/derechos**. Único bloqueo externo duro (sin correo no hay canal ARCO publicable).
5. **Publicar la política buena** (ya escrita en `.compliance/docs/21719-politica-privacidad.md`) → swap en `src/app/legal/privacidad/page.tsx` + rellenar identidad (paso 4). Las páginas legales YA existen → solo falta **linkearlas** desde `registro` + footer del área autenticada.
6. **Consentimiento en el registro**: checkbox NO premarcado (copy ya redactado) + persistir versión+fecha (user_metadata; patrón `emission_authorizations`). Debe gatear el botón email **y** "Continuar con Google".

### C. Tributario — corregir el encuadre (dev; el motor ya existe)
7. **#1 tributario: que la emisión USE la clasificación.** Hoy `emitir-lote/route.ts:265` defaultea `?? 39` (afecta) e ignora `clasif.tipo_dte` → puede emitir cripto con **19% IVA indebido**. El motor `evaluarEmision` (`src/lib/intermediario/emision-decision.ts`) ya hace lo correcto pero solo lo usa la cola/preview, no el endpoint que emite. + **hint p2p_cripto obligatorio** antes de emitir cripto + **bajar el sesgo `tipo_contribuyente` 0.9** (`clasificador-tipo.ts:273`). 🔴 si REAL, 🟠 fuerte si MOCK.
8. **Copy barato (siempre):** sacar el ejemplo "BOLETA HONORARIOS → IVA 19%" del prompt (`prompt.ts:46`; honorarios van por BHE con retención, no DTE 39) + **aviso UI "la boleta NO es tu declaración de renta — la renta va sobre la GANANCIA (venta−costo)"** + relabel "exenta"→**"no afecta a IVA"** (no inducir renta-exenta). Corregir el texto de Ley 21.713 ("50 tx/año" → lo reporta el banco con ≥50 pagadores distintos/mes).

### D. Emisión — Nota de Crédito end-to-end (mock) (dev ~2-3 días)
9. **NC 61 (el schema + XML YA existen):** que `validation.ts` acepte 61 + valide la referencia; pasar `referencia` al mock (`emission/mock.ts`); ruta `emitir-nota-credito` que persista `referencia_id`/`anulada_por_id`; UI "Emitir NC" (cod_ref 1 anula / 2 texto / 3 montos). Sin NC, una boleta (mock) equivocada queda congelada (deshacer está bloqueado a propósito).

### E. Pipeline / datos — corrupción invisible al revisor (dev ~1.5 días)
10. **Dedup en el camino Excel** (hoy se SALTA → re-subir una cartola duplica todo): extraer dedup a función pura → eval gratis (semilla `santander.xlsx`) → aplicarlo al bypass. **CRÍTICO en el mismo cambio:** tratar `n_documento` "000000000" como ausente — probado con tu cartola: sin eso, el fix BOTA ~5 abonos legítimos en silencio.
11. **Telegram foto-suelta → cola durable** (hoy corre inline en `after()`; si el server muere queda "procesando para siempre"). Enrutar por `enqueueDocumentProcessingJob` como ya hace el álbum. Es tu vía de captura principal P2P.

### F. Billing (GRATIS) (dev ~0.5 día + chequeo)
12. **Testear el gate de cupo** (`estadoCuota`/`verificarEmisionMasiva` — el código sin testear de mayor valor; que free realmente NO emita). + **confirmar que ningún beta-user tenga `dev_mode=true`** (saltea el gate → emisión ilimitada).

---

## 🟠 Primeras semanas (no bloqueante con beta chica + revisión humana)
- MFA cuenta operador + fix **fail-open** en `src/lib/supabase/proxy.ts`.
- **Eval de IA** (harness Layer 1 sobre OCR cacheado, ×5 por flakiness; métricas: tasa_falsa_venta=0, boleta_indebida=0, monto_exact≥0.98) + set inicial etiquetado por el **contador** (no el modelo). + reconciliación filas-archivo vs guardadas.
- Cron docs más frecuente (10-15 min) + ops/cron horario + **alertas** (crear bot + `OPS_TG_*`).
- `parseChileanNumber`: endurecer contra texto-decimal (confirmado ×100 a nivel código; NO lo dispara santander porque sus celdas son numéricas, pero otros bancos que exporten texto sí).
- `parser_adapters` deny-anon + activar `rls-isolation` en CI (staging).
- Excepciones "no toda entrada es venta" (reembolso/préstamo/cuenta propia/Art 17 N°8).

## 🟢 Puede esperar (revenue / dic-2026)
- **21.719 no rige hasta dic-2026** (gracia MIPYME) → abogado, RAT/EIPD completos, DPAs pagos (aceptar ya los gratis de Supabase/Vercel/MP).
- **Emisión REAL a terceros:** WS-2/3/4 de emisión (idempotencia por origen económico, boleta fantasma/heartbeat-TTL, idempotencia SimpleAPI `envio/enviar`, rango CAF) + tests de integración de rutas + certificación SII. ~1.5-2 semanas.
- `FORCE RLS` — **corregido:** NO frena el bypass de service-role (rol con BYPASSRLS); la protección real es higiene de la key (ya hecha). Se cae de la lista.

---

## Si cambian las decisiones
- **PAGA** (en vez de gratis): + verificar en sandbox MP cómo llega el cobro recurrente (topic `payment` vs `subscription_authorized_payment`), handler condicional, encender `MP_ACCESS_TOKEN`/`MP_WEBHOOK_SECRET`, `ops_event` al marcar morosas. + smoke e2e sandbox.
- **REAL a terceros** (en vez de mock/dogfooding): + todo el bloque 🟢 de emisión REAL (los 4 fixes de correctitud) como bloqueante.

## Acciones SOLO del fundador
1. Identidad AlphaCode SpA (RUT/domicilio/correo de privacidad).
2. Crear bot de alertas (BotFather) + grupo + `OPS_TG_BOT_TOKEN`/`OPS_TG_CHAT_ID` en Vercel.
3. Confirmar que ningún beta-user quede con `dev_mode=true`.
4. Validar los labels tributarios (afecta/exenta/no_boletar) con el socio contador.
5. (Si PAGA) sandbox MP + tokens MP.

## Lo que está BIEN — NO reescribir
Mecánica de IVA (crypto/forex sin IVA, 135 UF, compra=costo); idempotencia de cobro/emisión a nivel DB
(índices únicos); locks por cuenta; `consume_next_folio` atómico; folio-reservas state-machine; el mandato
de emisión versionado (`emission_authorizations`); ARCO (endpoints existen); páginas legales (existen);
política buena (escrita); NC schema + XML (existen); el motor `evaluarEmision`; cola durable + watchdog.
376 tests unitarios.
