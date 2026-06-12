# Manual Operativo massDTE — INTERNO (no compartir)

Equipo: Honter (producto/código) + contador. Última actualización: 2026-06-12.

## 0. Vocabulario (regla de oro: "entra una cartola, salen boletas")

| Concepto | Palabra ÚNICA en UI/marketing | Prohibido |
|---|---|---|
| Lo que el cliente sube | **cartola** / **archivo** | "documento" |
| Lo que se emite y lo que cuenta el plan | **boleta** | "documento" |
| Término técnico-legal | "documento tributario" (con apellido, solo Términos/manual) | "documento" a secas |

"Documento" a secas significa dos cosas opuestas en este dominio (lo que
entra y lo que sale) — por eso queda prohibida en todo texto visible.
En código, `documentos_subidos` y demás nombres internos NO se tocan.

## 1. Los 3 carriles de emisión

| Carril | Qué es | Cuándo usarlo | Requiere |
|---|---|---|---|
| **Modo de prueba (mock)** | Simulación completa, folios falsos, sin validez | Demos, onboarding de cliente, validar pipeline | Nada |
| **SII Local** | Extensión Chrome opera el emisor gratuito del portal SII en el equipo del cliente | Producción estándar (motor económico: gratis por boleta) | Extensión instalada + clave tributaria del cliente (vault local) |
| **SimpleAPI** | API de terceros; firma con certificado .pfx del cliente | Cliente que no quiere robot o emite desde server | Certificado digital + plan SimpleAPI (costo por documento) |

Se cambia en **Empresa → Emisión** (solo owner/admin). El check de certificado bloquea carriles reales si la empresa no marcó "Certificado SII".

## 2. Flujo estándar de un cliente

1. Alta empresa (wizard 5 pasos): datos emisor (RUT validado), formato cartola, folios, proveedor, IA.
2. Cliente sube cartola → IA clasifica → **Revisar** (aprueba/edita) → **Emitir** (lote o única) → **Boletas**.
3. Regla de oro tributaria: **1 movimiento bancario real = 1 boleta**. Jamás dividir montos (fraccionamiento = elusión).
4. La aprobación del usuario queda registrada (`propuestas_ia.estado` + timestamps) — es nuestra evidencia de que él decidió.

## 3. Incidentes y respuesta

| Síntoma | Causa probable | Acción |
|---|---|---|
| Robot SII falla en todos los pasos | El SII cambió el portal | NO reintentar masivo. Actualizar selectores de la extensión, probar con 1 boleta, recién ahí reabrir lote |
| Boleta real emitida con error | Tipeo/clasificación errada aprobada | **Nunca se borra.** Se corrige con Nota de Crédito tipo 61. Avisar al contador del cliente |
| Folio duplicado (SimpleAPI) | Folios CAF viven en chrome.storage por equipo (pendiente #6) | Mientras no esté el fix: UN solo equipo emite por empresa vía SimpleAPI |
| Usuario nuevo cae a /onboarding teniendo empresa | Embed ambiguo usuarios↔empresas | Ya fixeado (`empresas!usuarios_empresa_id_fkey`). NO recrear el usuario |
| Boleta sobre 135 UF pide datos del comprador | Res. Ex. SII 44/2025 (umbral con UF del día vía mindicador) | Es lo correcto: RUT + nombre + medio de pago. NO es bug |

## 4. Datos y limpieza

- **"limpia"** = limpieza estándar Supabase con confirmación previa. Preserva: aprendizaje (reglas/adapters), auditoría, cuenta. Scripts: `scripts/limpiar-test.sql` + `npm run limpiar:test:storage`.
- **`npm run cb4w`** = reset total de base de trabajo (script del contador). Destructivo — solo en pruebas.
- Cartolas de prueba canónicas: `santander.xlsx` (238 movs) y `Cartola N°02` (675 movs). Nunca se commitean.

## 5. Deploy y ramas

- Nunca trabajar en `main` ni `dev` directo. `feature/*` desde `dev` → PR → merge.
- Merge a `dev` ⇒ Vercel despliega preview automático. **Prod = `main`** (`app-contable-five.vercel.app`) ⇒ requiere merge dev→main deliberado.
- Antes de mergear: `npx tsc --noEmit` + `npm test` + `npm run build` verdes.
- Migraciones en `supabase/migrations/`; aplicar en el proyecto y verificar (el RPC de progreso falla silencioso si falta).

## 6. Seguridad — lo que JAMÁS se hace

- Las claves tributarias y certificados de clientes **nunca** se piden por chat/correo ni se guardan en nuestros servidores: viven cifrados en el navegador del cliente.
- No tocar la cadencia del robot (tiempos con jitter): es la protección anti-detección del SII. El umbral del SII es desconocido — no "optimizar" velocidad.
- Tokens del equipo aislados al proyecto: `.git/.git-credentials-local`, `.vercel/token`, `.supabase/token`. No logins globales.
- Solo `owner/admin/contador` emiten; `viewer` consulta. La key de IA global solo la toca cuenta con `dev_mode`.

## 7. Checklist alta de cliente nuevo

- [ ] Empresa creada con RUT/razón social/giro correctos (wizard)
- [ ] Formato de cartola mapeado y probado con un archivo real suyo
- [ ] Carril de emisión elegido + toggle certificado si es real
- [ ] Extensión instalada y vault configurado (carril SII Local)
- [ ] Primera emisión en **modo prueba** validada por el cliente
- [ ] T&C aceptados al registrarse
