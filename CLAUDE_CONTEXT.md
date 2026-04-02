# CLAUDE_CONTEXT.md
> Contexto completo del proyecto para Claude Code.
> Actualizado con decisiones de arquitectura, UI y lógica de negocio.

---

## Proyecto

App contable SaaS para Chile, orientada a vendedores P2P, operadores de crypto/forex y pequeñas empresas que manejan documentación caótica (cartolas bancarias, screenshots, chats de WhatsApp, Excel). La IA procesa los documentos, clasifica cada movimiento y propone documentos tributarios. El usuario revisa y aprueba con 1 clic.

Esta es la v3 del proyecto. Las versiones anteriores fallaron por acoplamiento frágil con n8n. En esta versión n8n se usa solo para automatizaciones periféricas, no como núcleo de la lógica de negocio.

---

## Stack técnico

| Capa | Tecnología |
|---|---|
| Frontend | Next.js + TypeScript + Tailwind CSS |
| Base de datos + Auth | Supabase (PostgreSQL + RLS + Storage) |
| Automatizaciones | n8n en Railway |
| IA procesamiento docs | Mistral API |
| Control de versiones | GitHub |
| Herramienta de desarrollo | Claude Code |

- **URL n8n Railway:** `https://n8n-production-47ecb.up.railway.app`
- **Directorio local:** `~/Desktop/app-contable`
- **IA:** Mistral API (credenciales a entregar por separado)

---

## MCPs en Claude Code

| MCP | Uso |
|---|---|
| `n8n-mcp` | Conectado a Railway vía HTTP |
| `n8n-mcp-docs` | Documentación y creación de workflows |
| `supabase` | Conectado al proyecto Supabase |

---

## Ramas Git

| Rama | Uso |
|---|---|
| `main` | Producción — solo merges aprobados |
| `dev` | Integración |
| `feature/setup-inicial` | Rama activa actual |

Convención: cada feature nueva va en `feature/nombre-feature` desde `dev`.

---

## Convenciones

- Antes de modificar workflows en n8n → exportar respaldo a `/n8n-workflows/respaldos/` con fecha.
- Nunca trabajar directo en `main`.
- Decisiones de arquitectura se toman en equipo antes de implementar.

---

## Plataformas objetivo

- **Web (desktop):** Next.js responsive, drag & drop habilitado
- **Móvil:** diseño mobile-first, sin drag & drop (usar input file nativo del sistema)
- **PWA:** instalable en Android e iOS desde el browser

---

## Diseño UI

- **Estética:** iOS Tahoe — glassmorphism, fondos con gradiente sutil, bordes traslúcidos flotantes, tipografía grande y bold, barra de navegación con blur
- **Tema:** dark mode por defecto
- **Personalidad:** simple y directo, pocas pantallas, todo a la vista
- **Mobile first:** diseñar primero para móvil, adaptar a desktop

### Pantallas principales

**1. Ingesta de documentos**
- Móvil: botón input file nativo (NO drag & drop)
- Desktop: zona drag & drop + input file
- Botones de acción: Cámara, Archivos (XLS/PDF/CSV), Galería, WhatsApp
- Alerta SII en tiempo real: "Llevas X de 50 transferencias este mes"
- Historial de documentos procesados con estado (pendiente / listo / procesando)

**2. Propuestas IA**
- Lista de tarjetas, una por movimiento detectado
- Cada tarjeta: quién, monto, fecha, tipo propuesto, confianza IA (%)
- Para operaciones P2P/crypto: spread calculator (compra / venta / ganancia neta)
- Campo de nota por operación (editable)
- 3 acciones: Aprobar / Editar / Ignorar
- Botón "Aprobar todo" para lotes limpios

**3. CRM de clientes P2P**
- Lista de personas con estado: Pagado / Pendiente / Verificar
- Nombres extraídos automáticamente de documentos procesados
- Historial por cliente

**4. Resumen mensual**
- Métricas: ventas netas, spread total P2P, compras, IVA a pagar
- Estimación F29 automática (IVA débito − IVA crédito)
- Botón "Exportar para contador" → PDF limpio
- Botón "Declarar F29"
- Selector de mes (historial)

### Navegación (bottom nav — 4 ítems)
Subir → Revisar (badge pendientes) → Clientes → Resumen

---

## Esquema de base de datos (Supabase)

### `empresas`
```
id uuid PK
rut string
razon_social string
giro string
direccion, comuna, region string
email_sii, clave_sii string
regimen_tributario string
created_at timestamp
```

### `usuarios`
```
id uuid PK (= auth.users.id)
empresa_id uuid FK → empresas
email, nombre string
rol string  -- admin / contador / viewer
created_at timestamp
```

### `clientes`
```
id uuid PK
empresa_id uuid FK
rut, nombre, giro, direccion, email string
created_at timestamp
```

### `proveedores`
```
id uuid PK
empresa_id uuid FK
rut, nombre, giro, email string
created_at timestamp
```

### `documentos_subidos`
```
id uuid PK
empresa_id uuid FK
tipo string  -- excel / imagen / pdf / whatsapp / csv
nombre_archivo string
storage_path string  -- Supabase Storage
estado string  -- subido / procesando / procesado / error
movimientos_detectados int
created_at timestamp
```

### `movimientos_raw`
```
id uuid PK
empresa_id uuid FK
documento_id uuid FK → documentos_subidos
fecha date
descripcion string  -- texto original del banco/doc
monto decimal
tipo_flujo string  -- entrada / salida
origen string  -- banco_chile / binance / whatsapp / manual / etc
created_at timestamp
```

### `propuestas_ia`
```
id uuid PK
empresa_id uuid FK
movimiento_id uuid FK → movimientos_raw
tipo_propuesto string  -- boleta / factura / gasto / registro_crypto / ignorar
receptor_nombre string
receptor_rut string
monto_neto, iva, total decimal
confianza decimal  -- 0 a 1
notas string
estado string  -- pendiente / aprobado / editado / descartado
spread_compra, spread_venta, spread_ganancia decimal  -- para crypto/forex
created_at timestamp
```

### `documentos_tributarios`
```
id uuid PK
empresa_id uuid FK
propuesta_id uuid FK → propuestas_ia
cliente_id uuid FK → clientes
tipo_dte string  -- 33=factura / 39=boleta / 61=nota_credito
folio int
fecha_emision date
estado string  -- borrador / enviado / aceptado / rechazado
neto, iva, total decimal
xml_sii text
track_id string
created_at timestamp
```

### `items_documento`
```
id uuid PK
documento_id uuid FK
descripcion string
cantidad int
precio_unitario, descuento, subtotal decimal
```

### `gastos`
```
id uuid PK
empresa_id uuid FK
proveedor_id uuid FK
propuesta_id uuid FK
fecha date
categoria, descripcion string
monto_neto, iva, total decimal
comprobante_url string
created_at timestamp
```

### `periodos_contables`
```
id uuid PK
empresa_id uuid FK
anio int, mes int
estado string  -- abierto / cerrado
total_ventas, total_compras decimal
iva_debito, iva_credito, iva_a_pagar decimal
spread_total_p2p decimal
transferencias_mes int  -- para alerta SII (límite 50)
cerrado_at timestamp
```

### RLS (Row Level Security)
Toda tabla con `empresa_id` debe tener política RLS:
```sql
USING (empresa_id = (SELECT empresa_id FROM usuarios WHERE id = auth.uid()))
```

---

## Lógica tributaria chilena

| Tipo de movimiento | Acción |
|---|---|
| Venta a persona natural | Boleta (tipo 39) + IVA 19% |
| Venta a empresa | Factura (tipo 33) + IVA 19% |
| Compraventa crypto/activos digitales | Solo registro — SIN IVA — tributa en Renta anual |
| Comisión intermediación P2P/forex | Boleta o factura solo por la comisión + IVA |
| Transferencia no comercial | Ignorar — sin documento |
| Gasto con proveedor empresa | Registrar como gasto, factura recibida |

**Regla de los 50:** alertar al usuario cuando supere 38 transferencias entrantes en el mes (76% del límite de 50 que reportan los bancos al SII). Referencia: Ley de Cumplimiento Tributario Chile 2024.

**Crypto sin IVA:** confirmado por SII Oficio 963-2018. Los activos digitales no tienen corporalidad → no aplica hecho gravado "venta" en IVA. Las ganancias (mayor valor) tributan en IGC o Primera Categoría según si es persona natural o empresa.

---

## Flujo principal

```
1. Usuario sube documento
      ↓
2. Supabase Storage guarda el archivo
      ↓
3. n8n webhook recibe evento → llama Mistral API
      ↓
4. Mistral extrae movimientos → guarda en movimientos_raw
      ↓
5. Mistral clasifica cada movimiento → genera propuestas_ia
      ↓
6. Frontend muestra bandeja de propuestas
      ↓
7. Usuario aprueba / edita / descarta
      ↓
8. Aprobados generan documentos_tributarios o gastos
      ↓
9. Documentos tributarios se envían al SII
      ↓
10. periodos_contables se actualiza automáticamente
```

---

## Uso de n8n (solo periférico)

- Webhook: "documento subido" en Supabase → llamar Mistral API
- Scheduler: recordatorio F29 el día 15 de cada mes
- Scheduler: resumen semanal por email
- NO usar n8n para lógica de negocio crítica

---

## Documentos que procesa la IA

- Cartolas bancarias Excel (Banco de Chile, BCI, Santander, etc.)
- Screenshots del banco (OCR)
- Screenshots de Binance, Buda, Orionx
- Exports de WhatsApp (.txt)
- Grillas Excel manuales
- PDFs de cartolas bancarias

---

## Estado actual

- [x] Stack configurado
- [x] MCPs conectados en Claude Code
- [x] Ramas Git definidas
- [x] Diseño UI definido (iOS Tahoe dark mode)
- [x] Esquema de base de datos definido
- [x] Lógica tributaria chilena definida
- [ ] Crear tablas en Supabase
- [ ] Configurar Supabase Storage
- [ ] Configurar RLS policies
- [ ] Implementar subida de archivos
- [ ] Integrar Mistral API
- [ ] Pantalla de ingesta
- [ ] Bandeja de propuestas IA
- [ ] CRM de clientes P2P
- [ ] Resumen mensual + F29
- [ ] Integración SII

---

## Equipo

Dos desarrolladores. Canal: Slack `app-contable` con `@Claude`.

*Última actualización: Abril 2026 · rama `dev`*
