# CLAUDE_CONTEXT.md
> Contexto completo del proyecto para Claude Code.
> Leer SIEMPRE antes de escribir cualquier línea de código.

---

## ⚠️ REGLA CRÍTICA — SIEMPRE TRABAJAR EN RAMAS

**NUNCA trabajar directamente en `main` ni en `dev`.**

Antes de cualquier tarea, crear una rama desde `dev`:

```bash
git checkout dev
git pull origin dev
git checkout -b feature/nombre-descriptivo
```

Al terminar, hacer PR a `dev`. Solo después de revisión se mergea.

Ejemplos de nombres de rama:
- `feature/auth-login`
- `feature/supabase-tablas`
- `feature/pantalla-ingesta`
- `feature/integracion-mistral`
- `fix/bug-descripcion`

**Si Claude Code está a punto de modificar código y no hay rama activa → DETENER y crear la rama primero.**

---

## Proyecto

App contable SaaS para Chile orientada a vendedores P2P, operadores de crypto/forex y pequeñas empresas que manejan documentación caótica (cartolas bancarias, screenshots, WhatsApp, Excel). La IA procesa los documentos, clasifica cada movimiento y propone documentos tributarios. El usuario revisa y aprueba con 1 clic.

Esta es la v3 del proyecto. Las versiones anteriores fallaron por acoplamiento frágil con n8n. En esta versión n8n se usa solo para automatizaciones periféricas — nunca como núcleo de la lógica de negocio.

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
- **IA:** Mistral API (credenciales en `.env.local`)

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
| `dev` | Integración — base para todas las features |
| `feature/setup-inicial` | Configuración base inicial |

**Convención:** `feature/nombre` o `fix/nombre`, siempre desde `dev`.

---

## Convenciones importantes

- Antes de modificar workflows en n8n → exportar respaldo a `/n8n-workflows/respaldos/` con fecha (ej: `2026-04-02-nombre-workflow.json`)
- Nunca trabajar directo en `main` ni `dev`
- Decisiones de arquitectura se toman en equipo antes de implementar
- Cada feature nueva = rama nueva

---

## Plataformas objetivo

- **Web desktop:** Next.js responsive, drag & drop habilitado
- **Móvil:** mobile-first, input file nativo del sistema (sin drag & drop)
- **PWA:** instalable en Android e iOS desde el browser

---

## Diseño UI

- **Estética:** iOS Tahoe — glassmorphism, fondos con gradiente sutil, bordes traslúcidos flotantes, tipografía grande y bold, barra de navegación con blur
- **Tema:** dark mode por defecto
- **Personalidad:** simple y directo, pocas pantallas, todo a la vista
- **Mobile first**

### Pantallas principales

**1. Auth / Onboarding**
- Login: email + contraseña y Google OAuth
- Registro: crea cuenta → datos de empresa (RUT, razón social, giro) → elige plan → paga
- Frase en registro: "Tu cuenta quedará sujeta a aprobación" (respaldo para vetar)

**2. Paywall (usuario sin plan activo)**
- Muestra planes antes de entrar a la app
- Sin plan activo → bloqueado en esta pantalla
- 3 planes: Starter / Pro / Empresa

**3. Ingesta de documentos**
- Móvil: botón input file nativo (NO drag & drop)
- Desktop: zona drag & drop + input file
- Botones: Cámara, Archivos (XLS/PDF/CSV), Galería, WhatsApp
- Alerta SII en tiempo real: "Llevas X de 50 transferencias este mes"
- Historial de documentos procesados con estado

**4. Propuestas IA**
- Tarjetas por movimiento: quién, monto, fecha, tipo, confianza IA (%)
- Para P2P/crypto: spread calculator integrado
- Campo de nota por operación
- Acciones: Aprobar / Editar / Ignorar
- Botón "Aprobar todo"

**5. CRM de clientes P2P**
- Lista con estado: Pagado / Pendiente / Verificar
- Nombres extraídos automáticamente

**6. Resumen mensual**
- Métricas: ventas netas, spread P2P, compras, IVA a pagar
- Estimación F29 automática
- Botón "Exportar para contador" → PDF
- Botón "Declarar F29"
- Selector de mes

### Navegación bottom (4 ítems)
Subir → Revisar (badge pendientes) → Clientes → Resumen

---

## Auth y roles (Supabase Auth)

### Flujo de registro
1. Usuario crea cuenta (email+contraseña o Google OAuth)
2. Completa onboarding: datos de empresa
3. Elige plan y paga
4. Accede a la app

### Estados de usuario
| Estado | Acceso |
|---|---|
| Registrado sin plan | Solo ve pantalla de pago |
| Plan activo | Acceso completo |
| Vetado por admin | Pantalla bloqueada con mensaje y contacto soporte |

### Roles
- `admin` — acceso total, puede vetar cuentas, ver todas las empresas
- `owner` — dueño de la empresa, acceso completo a su empresa
- `contador` — acceso de lectura + exportar
- `viewer` — solo lectura

---

## Modelo de precios

### Planes

| Plan | Mensual | Docs incluidos | Precio doc extra |
|---|---|---|---|
| Starter | $7.990 | 10 | $490/doc |
| Pro | $19.990 | 50 | $290/doc |
| Empresa | $39.990 | 200 | $150/doc |

### Reglas de negocio
- Documentos incluidos no usados acumulan hasta 3 meses
- "Documentos" = boletas y facturas emitidas al SII (no los registros de crypto ni gastos internos)
- Procesamiento IA ilimitado en todos los planes (subir archivos no consume créditos)
- Descuento 20% pago anual

### Referencia de mercado
- Un contador cobra $80.000–$250.000/mes por el mismo trabajo manual
- OpenFactura cobra ~$30.000/mes por emisión ilimitada pero sin IA ni procesamiento automático
- La app hace el trabajo del contador a mitad de precio

---

## Esquema de base de datos (Supabase)

### `empresas`
```sql
id uuid PK
rut text
razon_social text
giro text
direccion text
comuna text
region text
email_sii text
clave_sii text  -- encriptada
regimen_tributario text
plan text  -- starter / pro / empresa / null
plan_activo boolean
plan_vence_at timestamp
created_at timestamp
```

### `usuarios`
```sql
id uuid PK  -- = auth.users.id
empresa_id uuid FK → empresas
email text
nombre text
rol text  -- admin / owner / contador / viewer
vetado boolean default false
created_at timestamp
```

### `clientes`
```sql
id uuid PK
empresa_id uuid FK
rut text
nombre text
giro text
direccion text
email text
created_at timestamp
```

### `proveedores`
```sql
id uuid PK
empresa_id uuid FK
rut text
nombre text
giro text
email text
created_at timestamp
```

### `documentos_subidos`
```sql
id uuid PK
empresa_id uuid FK
tipo text  -- excel / imagen / pdf / whatsapp / csv
nombre_archivo text
storage_path text
estado text  -- subido / procesando / procesado / error
movimientos_detectados int
created_at timestamp
```

### `movimientos_raw`
```sql
id uuid PK
empresa_id uuid FK
documento_id uuid FK → documentos_subidos
fecha date
descripcion text
monto decimal
tipo_flujo text  -- entrada / salida
origen text  -- banco_chile / binance / whatsapp / manual
created_at timestamp
```

### `propuestas_ia`
```sql
id uuid PK
empresa_id uuid FK
movimiento_id uuid FK → movimientos_raw
tipo_propuesto text  -- boleta / factura / gasto / registro_crypto / ignorar
receptor_nombre text
receptor_rut text
monto_neto decimal
iva decimal
total decimal
confianza decimal  -- 0 a 1
notas text
estado text  -- pendiente / aprobado / editado / descartado
spread_compra decimal
spread_venta decimal
spread_ganancia decimal
created_at timestamp
```

### `documentos_tributarios`
```sql
id uuid PK
empresa_id uuid FK
propuesta_id uuid FK → propuestas_ia
cliente_id uuid FK → clientes
tipo_dte text  -- 33=factura / 39=boleta / 61=nota_credito
folio int
fecha_emision date
estado text  -- borrador / enviado / aceptado / rechazado
neto decimal
iva decimal
total decimal
xml_sii text
track_id text
created_at timestamp
```

### `items_documento`
```sql
id uuid PK
documento_id uuid FK
descripcion text
cantidad int
precio_unitario decimal
descuento decimal
subtotal decimal
```

### `gastos`
```sql
id uuid PK
empresa_id uuid FK
proveedor_id uuid FK
propuesta_id uuid FK
fecha date
categoria text
descripcion text
monto_neto decimal
iva decimal
total decimal
comprobante_url text
created_at timestamp
```

### `periodos_contables`
```sql
id uuid PK
empresa_id uuid FK
anio int
mes int
estado text  -- abierto / cerrado
total_ventas decimal
total_compras decimal
iva_debito decimal
iva_credito decimal
iva_a_pagar decimal
spread_total_p2p decimal
transferencias_mes int  -- para alerta SII límite 50
cerrado_at timestamp
```

### `creditos_uso`
```sql
id uuid PK
empresa_id uuid FK
mes int
anio int
docs_incluidos int
docs_usados int
docs_acumulados int  -- máx 3 meses
created_at timestamp
```

### RLS (Row Level Security)
Todas las tablas con `empresa_id` deben tener política:
```sql
USING (empresa_id = (
  SELECT empresa_id FROM usuarios WHERE id = auth.uid()
))
```

---

## Lógica tributaria chilena

| Movimiento | Acción |
|---|---|
| Venta a persona natural | Boleta (tipo 39) + IVA 19% |
| Venta a empresa (RUT empresa) | Factura (tipo 33) + IVA 19% |
| Compraventa crypto/activos digitales | Solo registro — SIN IVA — tributa en Renta anual |
| Comisión intermediación P2P/forex | Boleta/factura solo por la comisión + IVA |
| Transferencia no comercial | Ignorar — sin documento |
| Gasto con proveedor empresa | Registrar como gasto — factura recibida |

**Regla de los 50:** alertar cuando `transferencias_mes >= 38` (76% del límite de 50 que los bancos reportan al SII). Ref: Ley de Cumplimiento Tributario Chile 2024.

**Crypto sin IVA:** SII Oficio 963-2018. Activos digitales sin corporalidad → no aplica hecho gravado "venta" en IVA. Ganancias tributan en IGC o Primera Categoría.

---

## Flujo principal

```
1. Usuario sube documento
      ↓
2. Supabase Storage guarda archivo
      ↓
3. n8n webhook → llama Mistral API
      ↓
4. Mistral extrae movimientos → movimientos_raw
      ↓
5. Mistral clasifica → propuestas_ia
      ↓
6. Frontend muestra bandeja de propuestas
      ↓
7. Usuario aprueba / edita / descarta
      ↓
8. Aprobados → documentos_tributarios o gastos
      ↓
9. Documentos → SII
      ↓
10. periodos_contables se actualiza
```

---

## Uso de n8n (solo periférico)

- Webhook: "documento subido" en Supabase → llama Mistral
- Scheduler: recordatorio F29 el día 15 de cada mes
- Scheduler: resumen semanal por email
- **NO usar n8n para lógica crítica**

---

## Documentos que procesa la IA (Mistral)

- Cartolas bancarias Excel (Banco de Chile, BCI, Santander, etc.)
- Screenshots del banco (OCR)
- Screenshots de Binance, Buda, Orionx
- Exports de WhatsApp (.txt)
- Grillas Excel manuales
- PDFs de cartolas bancarias

---

## Estado actual del proyecto

- [x] Stack configurado
- [x] MCPs conectados en Claude Code
- [x] Ramas Git definidas
- [x] Diseño UI definido (iOS Tahoe dark mode)
- [x] Esquema de base de datos definido
- [x] Lógica tributaria definida
- [x] Modelo de precios definido
- [x] Auth y roles definidos
- [ ] **Siguiente:** crear rama `feature/supabase-setup` y crear tablas en Supabase
- [ ] Configurar Supabase Storage
- [ ] Configurar RLS policies
- [ ] Implementar auth (email + Google OAuth)
- [ ] Implementar paywall
- [ ] Integrar Mistral API
- [ ] Pantalla de ingesta
- [ ] Bandeja de propuestas IA
- [ ] CRM clientes P2P
- [ ] Resumen mensual + F29
- [ ] Integración SII

---

## Equipo

Dos desarrolladores. El socio es contador — consultar con él decisiones de lógica tributaria.
Canal de colaboración: Slack workspace `app-contable` con `@Claude`.

---

*Última actualización: Abril 2026 · rama `dev`*
