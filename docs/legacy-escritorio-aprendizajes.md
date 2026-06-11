# Legacy /escritorio v1-v4 — aprendizajes antes del borrado

Borrado el 2026-06-11 (rama `feature/massdte-canonical-dashboard`). Todo el
código sigue en git: **último commit con el legacy completo = `cd6c456`**.

```bash
# Ver un archivo borrado:
git show cd6c456:"src/app/(app)/escritorio/v3/CalendarYear.tsx"
# Restaurar una versión entera:
git checkout cd6c456 -- "src/app/(app)/escritorio/v3"
```

## Qué fue cada versión (evolución → v5/massdte)

| Versión | Idea central | Qué sobrevivió en v5 |
|---|---|---|
| **v1** (`escritorio/page.tsx`, 390 líneas) | Grid 3/7: panel "Emitir" (SubirClient) + CalendarStrip + tabs Revisar/Emitir/Boletas. **Streaming con `<Suspense>` por panel** (cada bloque con su skeleton). | El layout izquierda-acciones / derecha-trabajo y el concepto de tabs. v5 cambió streaming por `Promise.all` server-side (una sola carga, sin pop-in). |
| **v2** (2 archivos, 286 líneas) | v1 + **drawer lateral** (`DrawerToggle`) para configuración rápida. | El patrón "popup/overlay para configurar sin salir de la mesa" → hoy `EmpresaPopup` wizard 5 pasos. |
| **v3** (10 archivos, 1.000 líneas) | Dashboard tipo shell: `DashboardShell` + `TabsV3` + `CalendarYear` + `DocCardModal` + `nav-gold.css`. | Las tabs con contadores y los doc-cards con estado por color. Lo dorado/flashy se rechazó (ver criterio de diseño). |
| **v4** (1 archivo, 213 líneas) | Shell "stats app": sidebar fijo + main con header Stats + chip empresa, todo inline-styles sobre #000. | La estética dark + inline styles + chip de empresa en header. Es el ancestro visual más directo de v5. |

## Piezas rescatables (no existen en v5 — candidatas futuras)

1. **`CalendarYear` (v3)** — vista de AÑO completo: 12 mini-meses con heatmap
   por día (pendientes `p` / aprobados `a` / docs `d` por fecha, una query
   anual a supabase client-side, navegación por año con `?date=`). v5 solo
   tiene la franja del mes. Si massdte necesita "vista año" (cierres anuales,
   F22), partir de aquí: `git show cd6c456:"src/app/(app)/escritorio/v3/CalendarYear.tsx"`.

2. **`DocCardModal` (v3)** — card de documento con cara frontal compacta
   (ícono SVG por tipo + estado en color) que abre modal con detalle al click.
   Germen del grid de Agregados actual; el patrón data-status + flip puede
   servir para una vista de detalle rápida.

3. **Streaming por panel (v1)** — `<Suspense>` con skeleton por sección
   (`TopBarShell`, `CalendarSkeleton`, `ShimmerBox`). Hoy v5 carga todo en
   server; si la mesa crece (muchas queries pesadas), volver a este patrón
   para pintar el shell al tiro y streamear los paneles lentos.

4. **`EmitirBoletaForm` + `RevisarBoletasTabs` + `BoletasList`** (componentes
   compartidos, huérfanos tras el borrado) — la primera UI de emisión:
   consumía `/api/intermediaria/pendientes-emision` con filtros listo/bloqueado
   y emitía por lote con resumen. Reemplazados por `EmitirTabContent` +
   `EmitirFullView` (server-fed). El shape `PendienteItem` que definieron es
   el mismo que hoy entrega `lib/intermediario/pendientes-emision.ts`.

## Anti-aprendizajes (lo que se probó y se descartó)

- **`nav-gold.css` (v3)**: animaciones "liquid gold" (gradiente animado,
  shimmer, pulse glow). Rechazado por criterio de diseño: nada flashy,
  restraint nivel Apple. No reintroducir.
- **Fetch client-side del calendario (v3)**: CalendarYear pegaba a supabase
  desde el cliente → spinner + RLS desde browser. v5 lo movió al server
  (page.tsx arma `byDay` con las queries del `Promise.all`). Mantener server.
- **4 dashboards en paralelo**: mantener versiones vivas "por si acaso" costó
  build, lint y confusión. La política ahora: una sola mesa (/massdte), y los
  experimentos van en ramas, no en rutas.

## Qué se borró exactamente

- `src/app/(app)/escritorio/page.tsx` (v1) + `loading.tsx` (skeleton del shell v1)
- `src/app/(app)/escritorio/v2/`, `v3/`, `v4/`
- Huérfanos: `src/components/RevisarBoletasTabs.tsx`,
  `src/components/boletas/BoletasList.tsx`,
  `src/components/boletas/EmitirBoletaForm.tsx`
- `src/proxy.ts`: se quitó el bypass dev `?legacy=1`; los redirects
  `/escritorio*` → `/massdte` se conservan (bookmarks viejos).

`/massdte` re-exporta `src/app/(app)/escritorio/v5/page` — **v5 quedó intacto**.
