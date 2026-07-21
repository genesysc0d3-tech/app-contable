# Plan — Mesa unificada (Agregados+Revisar) · visor por tipo · duplicados split-screen

**Fecha:** 2026-06-24 · **Branch:** feature/facturacion-uso (sigue tras `1c766e7`)
**Origen:** síntesis de 3 subagentes (arquitecto técnico + UX + UI), todos leyendo el código real.
**Filosofía:** todo en una pantalla, cada documento grande = su propio mundo, menos ruido visual, velocidad.

---

## 0. Qué logra
Fusiona los pasos **Agregados** y **Revisar** en una sola pestaña donde el **árbol Finder es la navegación**.
Cada documento se trabaja según su naturaleza:
- **1 transacción** (Telegram, boleta única) → se abre **inline** (acordeón) con la tarjeta de propuesta.
- **Cartola MassDTE (N tx)** → abre un **popup** ("su propio mundo") con todas sus tx en formato Revisar.
- **Duplicados cross-archivo** → el popup se transforma en **pantalla dividida** mostrando los dos archivos.

---

## 1. Decisiones de arquitectura (donde los 3 coincidieron)

1. **Tabs 4 → 3.** Desaparece "Revisar" como tab; queda **Mesa(fusionada) ›› Emitir ›› Boletas**. El árbol pasa a ser el landing.
2. **Se borran las `dtabs`** de RevisarTabContent (el switcher de documentos): el árbol ES el índice de documentos ahora.
3. **Se borra la vista `list`** de DocCardList: sus acciones por-doc (Mapear / Reprocesar / Deshacer / Tipo hint / Glosa común / barra de avance) **migran al visor MassDTE** = "configs globales".
4. **Reusar, no reescribir:**
   - `ExpandedDetail` (RevisarTabContent) **ES** la tarjeta de propuesta → extraer a `PropuestaCard.tsx` con prop `readOnly`.
   - `ConfianzaGroupSection` **ES** "el formato Revisar" (grupos alta/media/baja + Aprobar bloque/todas) → extraer a `revisar-shared.ts`, reusar en el popup.
   - **El popup NO necesita server action de lectura:** `mesa.propuestas` ya trae todo; se filtra por `documento_id` client-side (incluso 675 movs ya están en memoria).
5. **Un solo shell de modal** (el de VisualizarArchivo: inset:0, blur, Esc) reutilizado para: visor MassDTE, popup de propuestas, lightbox del comprobante y split-screen.
6. **Regla de altura:** la mesa da ~380px útiles → todo lo inline (1-tx) cabe en ≤220px; lo que no cabe (N tx, split) va a modal.

---

## 2. Mapa de interacción

```
Árbol (landing de la pestaña fusionada)
 ├─ click cartola MassDTE → Visor modal (configs globales + planilla) → [Revisar N props] → Popup propuestas
 │                                                                         └─ [Comparar dup ⇆] → Split-screen → (resolver) vuelve al popup
 ├─ click Telegram 1-tx ──→ reveal INLINE (tarjeta editable + imagen del comprobante) → tap imagen → Lightbox
 └─ click Boleta única ───→ reveal INLINE read-only (borde punteado, chip "Emitida", link "Ver en Boletas →")
```
Todo cierra con `×` + `Esc` y vuelve al árbol. Un Esc = un nivel (split → popup → árbol).

---

## 3. Mockups

### Árbol (landing)
```
┌─ Mesa ─────────────────────────────────── 12 esperando · 4 aprob · Hoy ─┐
│  ▤ MassDTE · cartolas                                            3       │
│   ● Santander_abril.xlsx        180/220 ✓          238 mov     14:32     │
│   ◉ Cartola_N02.xlsx            procesando                     14:30     │  ◉ pulsa
│  ➤ Telegram · comprobantes                                      2        │
│   ● Telegram 14:21 transferencia                     1 tx     14:21      │
│   ○ Telegram 09:05 comprobante                    pendiente   09:05      │  ○ hueco = pendiente
│  ▣ Boleta única · emisión directa                              1         │
│   ● Boleta #1043 · Juan Pérez                       emitida   11:48      │
└──────────────────────────────────────────────────────────────────────────┘
```

### Telegram 1-tx (INLINE, editable, con imagen)
```
│  ▾ ● Telegram 14:21 transferencia                    1 tx     14:21      │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │ ┌──────────┐  AFE · Boleta afecta                       92%       │  │
│  │ │ comprob. │  Transferencia recibida — Juan Pérez                 │  │
│  │ │ [ imagen ]│  ┌────────┬────────┬────────┐                        │  │
│  │ │   ⤢ zoom │  │ NETO   │ IVA    │ TOTAL  │  37.815/7.185/45.000   │  │
│  │ └──────────┘  └────────┴────────┴────────┘                        │  │
│  │   Cliente: [ Juan Pérez ▾ ]   [✓ Aprobar] [✎ Editar] [✕ Rechazar] │  │
│  └──────────────────────────────────────────────────────────────────┘  │
```
Imagen: 3 estados (cargando=skeleton · cargada=img+zoom · ausente=placeholder mudo + datos OCR). **Nunca** bloquear aprobación por miniatura caída.

### Boleta única (INLINE, read-only)
```
│  ▾ ● Boleta #1043 · Juan Pérez                      emitida   11:48      │
│  ┌╌╌╌╌ borde punteado coral ╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌┐  │
│  ┊ B1  AFECTA · Folio #1043             ✓ Emitida · en Boletas    ┊  │  sin %, sin botones
│  ┊ NETO/IVA/TOTAL en texto plano        Cliente: Juan Pérez       ┊  │
│  ┊ Ver en Boletas →   ⓘ Para corregir, emite Nota de Crédito      ┊  │
│  └╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌┘  │
```
Read-only = **restar controles** (sin %, sin select, sin botones); la ausencia comunica.

### Visor MassDTE (modal con configs globales)
```
┌─ Santander_abril.xlsx ──────────────────────── 238 mov ───────────── × ─┐
│ ╔═ Configuración global ═══════════════════════════════════════════════╗│
│ ║ ↔ Mapear   Tipo:[Afecta▾]   Glosa común[…]   Avance 180/220 ✓        ║│
│ ║                            [  Revisar 220 propuestas  →  ]           ║│  ← único coral lleno
│ ╚══════════════════════════════════════════════════════════════════════╝│
│  (planilla existente: FECHA · DESCRIPCIÓN · MONTO · SALDO …)             │
│  238 filas             ↻ Reprocesar   ↩ Deshacer  (footer, calladas)    │
└──────────────────────────────────────────────────────────────────────────┘
```

### Popup de propuestas (Revisar a tamaño modal, sin dtabs)
```
┌─ Revisar · Santander_abril.xlsx ───────── 220 props · 12 esperando ── × ┐
│  [Aprobar bloque]                          [Aprobar todas ≥85% (180)]    │
│  ▾ ✔ Alta confianza                                           180        │
│     ▸ AFE TRANSF JUAN PEREZ   45.000 · 14abr   92%  ✓ ✎ ✕                │
│  ▸ ⚠ Requiere revisión                                         28        │
│  ▸ ◆ Falta información                                         12        │
│  ⚠ 4 movimientos omitidos como duplicados   [ Comparar duplicados ⇆ ]   │  ← puente al split
└──────────────────────────────────────────────────────────────────────────┘
```

### Split-screen de duplicados (el popup se transforma; no es ventana nueva)
```
┌─ ⇆ Comparando duplicados ──────────── 4 duplicados ──── Salir ✕ ─────────┐  header ámbar
│  Santander_abril.xlsx           ┃   BancoChile_marzo.xlsx                │
│  (este documento)               ┃   (ya registrado aquí)                 │
│  AFE TRANSF JUAN PEREZ  45.000  ┃   AFE TRANSF JUAN PEREZ  45.000   (atenuado)
│ ▓ DUP TRANSF MARIA     30.000 ▓ ┃ ▓ DUP TRANSF MARIA     30.000 ▓  ← banda ámbar AMBOS lados
│  EXE VENTA CRIPTO     120.000   ┃   EXE PAGO ARRIENDO   250.000   (atenuado)
│  Esta transferencia de $30.000 (María Soto · 14abr) ya está en           │
│  BancoChile_marzo. Elige cuál conservar.                                 │
│      [ Mantener este ]   [ Usar el ya registrado ]   [ Omitir ]          │
└──────────────────────────────────────────────────────────────────────────┘
```
Se distingue del popup normal por: header ámbar "⇆ Comparando", costura vertical 1px, banda ámbar plana (no glow) en la fila gemela de ambos lados + resto atenuado, y fila de resolución al pie. Al resolver, el pane derecho colapsa a 0 (width ~0.3s) y vuelve al popup de un documento.

---

## 4. Etapas (orden seguro; la emisión NUNCA se toca)

| # | Etapa | Archivos | Test |
|---|-------|----------|------|
| **1** | **Fix `VisualizarArchivo`** (rama por `doc.tipo`: imagen→`<img>` object-URL, pdf→`<embed>`, excel→tabla). Independiente, shippable sola. Arregla el "código roto" del comprobante. | `VisualizarArchivo.tsx` | Abrir doc Telegram (imagen) → se ve la imagen, no código |
| **2** | **Extracción pura** (sin cambio UX): `ExpandedDetail`→`PropuestaCard.tsx` (+prop `readOnly`); `ConfianzaGroupSection`+helpers→`revisar-shared.ts`. | `RevisarTabContent.tsx` (adelgaza) + 2 nuevos | Revisar actual sigue idéntico |
| **3** | **Fusionar la pestaña**: árbol=nav; inline 1-tx (Telegram editable / boleta read-only); MassDTE→visor configs. TabsV5 4→3. **Cablear `reloadMesa()`** desde MesaController (reemplaza `router.refresh()`). | `TabsV5.tsx`, `Mesa.tsx`, `MesaController.tsx`, nuevo `MesaTab.tsx`, `DocCardList.tsx` | Aprobar 1-tx refleja sin togglear fecha; boleta no editable |
| **4** | **Popup MassDTE** (`DocPropuestasPopup.tsx`): `ConfianzaGroupSection`×3, propuestas filtradas por `documento_id`, paginación por bloques (cubre 675 movs). | nuevo `DocPropuestasPopup.tsx` | Cartola 675 → popup fluido; aprobar bloque/todas OK |
| **5** | **Duplicados + split-screen**: agregar `origen_documento_id` al `duplicados_detalle` (JSON, sin migración) + fallback `resolverDocumentoDeMovimiento` para data vieja; banner evidente; split-screen. Backends ya existen (`ocultar-omitido`, `forzar-movimiento`). | `processor.ts`, `ingesta.ts`, `types.ts`, `revisar/actions.ts`, `DocPropuestasPopup.tsx`, `VisualizarArchivo.tsx` | Subir cartola con dup de otra → banner + split señala la fila |

Merges sugeridos: 1 → 2 → 3 → 4 → 5 (1 y 2 son no-regresión, shippables solas).

---

## 5. Riesgos clave (con fix)

1. **Estado stale (alto).** `MesaController` hace `useState(initialMesa)` sin re-sync; `router.refresh()` no actualiza el estado client. **Fix:** exponer `reloadMesa()` (re-llama `cargarMesa` + setMesa + broadcast) en Etapa 3, antes de meter más escrituras.
2. **Loose dups vs P2P real (el #1 de producto).** Tragarse una venta real (P2P repetido legítimo, ver aprendizaje "cartolas solo abonos") es el peor resultado. **Fix:** 2 niveles — dups DUROS (mismo n°/código tx) → omitidos + split para confirmar; dups FLOJOS (`loose_*`, `falsos_duplicados_warning`) → **nunca omitir en silencio**, nudge ámbar; el default **conserva la venta**.
3. **Dup en el MISMO archivo** (`*_mismo_arch`): el "split-screen" no aplica (ambos lados serían el mismo archivo). **Fix:** resaltar las dos filas en una sola pana ("fila 12 ↔ fila 34"), mismas 2 acciones.
4. **`origen_documento_id` ausente en data histórica:** el campo nuevo solo aplica desde el deploy → **fallback** `resolverDocumentoDeMovimiento(origen_movimiento_id)`, sin reprocesar nada.
5. **Performance 675 movs:** no montar 675 tarjetas; reusar la paginación por bloques + lazy-mount del popup.
6. **Excel row offset:** `excel_row` es 1-based del Excel real; el preview indexa distinto → mapear el offset al resaltar o el highlight cae corrido.
7. **TabsV5 al quitar Revisar:** el indicador deslizante y `switch-tab` se calculan por índice → recalcular tras cambiar el set de tabs.

---

## 6. DECISIÓN (resuelta 2026-06-26)

El founder eligió el visor **ARRIBA del file tree** (su idea original), sobre la recomendación unánime de inline. Se respeta. **Mitigación acordada** del riesgo de altura que marcaron los 3: el visor **aparece on-select** (vacío/oculto cuando no hay nada seleccionado → el árbol usa toda la altura) y el árbol debajo scrollea. Aplica solo a 1-tx (Telegram editable / boleta única read-only); MassDTE sigue en popup y el split-screen aparte.

> Nota: los mockups inline de la §3 (Telegram / boleta única) se reinterpretan como **panel-visor arriba**, mismo contenido de tarjeta, posicionado sobre el árbol y visible solo al seleccionar una fila de 1-tx.
