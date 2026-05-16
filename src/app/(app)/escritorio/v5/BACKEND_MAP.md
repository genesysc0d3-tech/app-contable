# v5 Backend Mapping — Conexión Frontend ↔ Backend

## Arquitectura

```
page.tsx (SERVER)
  └── fetch: boletas_emitidas (RCV), documentos_subidos (docs), propuestas_ia (calendar), stats
  └── pasa datos como props a sub-componentes SERVER
  └── pasa React nodes como props a TabsV5 (CLIENTE)
        ├── revisarContent = <RevisarV5 /> (SERVER → RevisarClient)
        ├── emitirContent = <EmitirBoletaForm /> (CLIENTE)
        └── boletasContent = <BoletasList /> (SERVER)
```

---

## 1. Floating Controls (puramente UI, sin backend)

| Element | Backend |
|---------|---------|
| Buildings link | Link a `/empresa` |
| Search icon | Solo UI |
| Bell icon + dot | Solo UI |
| Avatar gradient | `empresa[0]` (primera letra) |

---

## 2. LEFT COLUMN — RCV Card

**Componente:** `page.tsx` inline (SERVER)

| Dato | Query | Tabla |
|------|-------|-------|
| docs count | `select count` | `boletas_emitidas` WHERE empresa_id AND estado != 'anulada' |
| neto | `sum(monto_neto)` | `boletas_emitidas` |
| iva | `sum(iva)` | `boletas_emitidas` |
| exento | `sum(monto_exento)` | `boletas_emitidas` |
| total | `sum(monto_total)` | `boletas_emitidas` |
| mes | `new Date().toISOString().slice(0,7)` | — |

---

## 3. LEFT COLUMN — Emitir Panel

**Dropzone:** Link a `/subir` (navegación)

**Documentos recientes — Componente:** `EmitirLeftDocs` (SERVER)

| Dato | Query | Tabla |
|------|-------|-------|
| Lista docs | `select id, nombre_archivo, tipo, estado, movimientos_detectados, created_at` | `documentos_subidos` WHERE empresa_id ORDER BY created_at DESC LIMIT 10 |
| Status dot color | `estado`: procesado=#22c55e, procesando=#5b9cf6, error=#ef4444, subido=#f59e0b | — |
| Status label | `estado`: procesado=Listo, procesando=Procesando, error=Error, subido=Pendiente | — |

**Plantilla Excel:** Link a `/api/generar-template`

---

## 4. RIGHT COLUMN — Calendar Strip

**Componente:** `page.tsx` inline (SERVER)

| Dato | Query | Tabla |
|------|-------|-------|
| Días con actividad | `select created_at, estado` | `propuestas_ia` WHERE empresa_id AND month = current |
| Días con subidas | `select created_at` | `documentos_subidos` WHERE empresa_id AND month = current |
| Today highlight | `new Date().getDate()` | — |
| Selected day | `searchParams.date` | — |

---

## 5. RIGHT COLUMN — TopBar

**Componente:** `page.tsx` inline (SERVER)

| Dato | Query | Tabla |
|------|-------|-------|
| Pendientes count | `select count where estado=pendiente` | `propuestas_ia` |
| Aprobados mes | `select count where estado in (aprobado,editado) AND created_at >= start of month` | `propuestas_ia` |
| Fecha | `now.toLocaleDateString("es-CL", {weekday,day,month})` | — |

---

## 6. RIGHT COLUMN — Tabs (TabsV5)

**Componente:** `TabsV5` (CLIENTE) — recibe React nodes como props

| Tab | Componente | Tipo | Backend |
|-----|-----------|------|---------|
| Revisar | `RevisarV5` → `RevisarClient` | SERVER | `propuestas_ia` + `clientes` |
| Emitir | `EmitirBoletaForm` | CLIENTE | `GET /api/intermediaria/pendientes-emision` + `POST /api/intermediaria/emitir-lote` |
| Boletas | `BoletasList` | SERVER | `boletas_emitidas` |

---

## 7. Revisar Tab — RevisarV5 → RevisarClient

**Componente:** `RevisarV5` (SERVER) → `RevisarClient` (CLIENTE)

| Dato | Query | Tabla |
|------|-------|-------|
| Propuestas | `select *, movimientos_raw(*, documentos_subidos(id, nombre_archivo, created_at))` | `propuestas_ia` WHERE empresa_id ORDER BY created_at DESC |
| Clientes | `select id, nombre, rut` | `clientes` WHERE empresa_id ORDER BY nombre |
| Filter by date | `filter(p => p.created_at?.startsWith(filterDate))` | (client-side filter) |

**Server Actions (from `revisar/actions.ts`):**

| Action | Endpoint | Operación |
|--------|----------|-----------|
| aprobarPropuesta | server action | UPDATE propuestas_ia SET estado='aprobado' |
| rechazarPropuesta | server action | UPDATE propuestas_ia SET estado='rechazado' |
| aprobarTodas | server action | UPDATE propuestas_ia SET estado='aprobado' (batch) |
| editarPropuesta | server action | UPDATE propuestas_ia SET campos + estado='editado' |
| ocultarPropuesta | server action | UPDATE propuestas_ia SET estado='oculto' |
| restaurarPropuesta | server action | UPDATE propuestas_ia SET estado='pendiente' |
| devolverAOmitidos | server action | DELETE propuestas_ia + movimientos_raw |
| crearClienteDesdeRevisar | server action | INSERT clientes |

---

## 8. Emitir Tab — EmitirBoletaForm

**Componente:** `EmitirBoletaForm` (CLIENTE, sin props)

| Operación | Endpoint | Método |
|-----------|----------|--------|
| Fetch pendientes | `/api/intermediaria/pendientes-emision` | GET |
| Batch emit | `/api/intermediaria/emitir-lote` | POST |
| Emitir single | `/api/intermediaria/emitir-boleta` | POST |

---

## 9. Boletas Tab — BoletasList

**Componente:** `BoletasList` (SERVER)

| Dato | Query | Tabla |
|------|-------|-------|
| Últimas 20 | `select id, folio, tipo_dte, fecha_emision, receptor_rut, receptor_razon_social, monto_total, estado` | `boletas_emitidas` WHERE empresa_id ORDER BY fecha_emision DESC, folio DESC LIMIT 20 |

**Sub-componente:** `DescargarBoletaButton` (CLIENTE)

| Operación | Endpoint | Método |
|-----------|----------|--------|
| Descargar PDF | `/api/intermediaria/boleta/[id]` | GET |

---

## Resumen de Queries a Supabase

| Tabla | Tipo | Frecuencia |
|-------|------|------------|
| `boletas_emitidas` | SELECT count + sums | Cada render del RCV |
| `documentos_subidos` | SELECT list (LIMIT 10) | Cada render del Emitir panel |
| `propuestas_ia` | SELECT list (full) | Cada render de Revisar tab |
| `propuestas_ia` | SELECT count (pendientes) | Cada render del TopBar |
| `propuestas_ia` | SELECT count (aprobados mes) | Cada render del TopBar |
| `propuestas_ia` | SELECT created_at (calendar) | Cada render del Calendar |
| `documentos_subidos` | SELECT created_at (calendar) | Cada render del Calendar |
| `clientes` | SELECT list | Cada render de Revisar tab |
| `boletas_emitidas` | SELECT list (LIMIT 20) | Cada render de Boletas tab |

## Endpoints API

| Endpoint | Uso |
|----------|-----|
| `GET /api/generar-template` | Descargar plantilla Excel |
| `GET /api/intermediaria/pendientes-emision` | Listar props listas para emitir |
| `POST /api/intermediaria/emitir-lote` | Emitir boletas en lote |
| `GET /api/intermediaria/boleta/[id]` | Descargar boleta PDF |
| `GET /api/sii-mock/rcv?mes=` | Resumen mensual (usado en Subir original) |
