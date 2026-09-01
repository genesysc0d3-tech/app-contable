# Inventario de infraestructura — massdte

Mapa de todo lo que está enchufado al producto: qué hace cada proveedor, dónde
viven sus credenciales y qué se rompe si se cae. Última revisión: 2026-08-23.

> **Regla**: si agregas un proveedor nuevo, agrégalo acá el mismo día. Este
> archivo es la única defensa contra perderle el hilo a la infraestructura.

---

## 1. Identidad de la empresa

| | |
|---|---|
| Razón social | **AlphaCode SpA** — RUT 78.448.088-7 |
| Domicilio | Apoquindo 6410 Of 605, Las Condes |
| Correo corporativo | `alphacode.chile@gmail.com` |
| Producto | **massdte** (marca; la SpA puede tener más productos) |
| Solo desarrollo | `genesysc0d3` — nunca de cara al cliente |

---

## 2. Dominio y DNS

| | |
|---|---|
| Registrador | **NIC.cl** — ahí se compró `massdte.cl` |
| DNS / Nameservers | **Vercel** (`ns1/ns2.vercel-dns.com`) — NO están en NIC.cl |
| Landing | `massdte.cl` → Vercel |
| App | `app.massdte.cl` → Vercel |
| Host viejo | `app-contable-five.vercel.app` → 308 al oficial |
| MX (correo) | `send.massdte.cl` → Resend (**envío**). Raíz `@` → ImprovMX `mx1/mx2.improvmx.com` (**recepción**), puesto el 2026-08-23. Los dos no chocan: cada uno en su nivel |
| SPF raíz | `v=spf1 include:spf.improvmx.com -all` — lo exige ImprovMX para validar. **No afecta a Resend**, que se verifica por `send.massdte.cl` + DKIM |
| DMARC | `p=reject; sp=reject; adkim=s; aspf=r; rua+ruf=dmarc@massdte.cl`. `aspf` pasó de estricto a **relajado** el 2026-08-23: con estricto el SPF nunca alineaba (el retorno vive en `send.`, el remitente en la raíz) y el correo se sostenía solo del DKIM — una sola pata bajo `p=reject`, o sea si el DKIM fallaba los correos **desaparecían**. Ahora alinean los dos |
| Carril de marketing | `novedades.massdte.cl`, dominio Resend **separado** con su propia llave DKIM. Verificado 2026-08-23. Remitente `equipo@novedades.massdte.cl`, `Reply-To: novedades@massdte.cl`. Existe para que una campaña que se llene de quejas de spam **no arrastre a los correos de sistema** — la reputación se pega al dominio que firma, y por eso no basta con cambiar de dirección. Tiene su propio `_dmarc.novedades` para verle la salud aparte |

⚠️ Como el DNS vive en Vercel, cualquier servicio que exija nameservers propios
(p.ej. Cloudflare Email Routing) obligaría a mover el DNS de producción. Evitar.

---

## 3. Infraestructura

| Servicio | Para qué | Credenciales |
|---|---|---|
| **Vercel** | Hosting de la app y el landing, crons, env vars | `.vercel/token` |
| **Supabase** | Base de datos, Auth y Storage. Proyecto **`xncnfrwarcrzgldalkzz`** (us-east-1) | `.supabase/token`, `.supabase/massdte-us.dbpass` |
| **Supabase (viejo)** | `aluuuyecwifaakehvcam` (sa-east-1) = **respaldo sellado**, signups y Google apagados. NO borrar sin permiso | mismo token |
| **Cloudflare R2** | Archivos pesados (PDFs de boletas, nómina SII). Cliente en `src/lib/r2.ts` | env `R2_*` |
| **GitHub** | `genesysc0d3-tech/app-contable` y `web-massdte` | credenciales locales aisladas del repo |

---

## 4. Inteligencia artificial

| Servicio | Para qué | Notas |
|---|---|---|
| **OpenCode** (gateway Go) | Clasificar movimientos y OCR de comprobantes | env `OPENCODE_GO_API_KEY`, `OPENCODE_GO_MODEL`. Corta streams a ~49s → cliente con streaming + chunks de 15 |

---

## 5. Emisión al SII

| Pieza | Qué hace | Dónde |
|---|---|---|
| **Extensión Chrome** | Motor local que emite por el portal del SII con la clave del usuario | Chrome Web Store (no listada), ID `klblpnnmbbmicpbnhlkfceiiijppobfe`. Credenciales de publicación en `.chromewebstore/` |
| **Bóveda cifrada** | Guarda la clave SII del cliente (llave partida) | env `EXTENSION_VAULT_WRAP_SECRET` |
| **SimpleAPI** | Carril alternativo con certificado `.pfx` | configurable por empresa |
| **Portal SII (AlphaCode)** | Facturas 33 manuales de la propia empresa | clave SII propia |

---

## 6. Pagos

| Servicio | Estado | Notas |
|---|---|---|
| **Flow** ★ CARRIL PRINCIPAL | Llaves de producción en Vercel (2026-08-24, verificadas en vivo antes de subir); **se enciende con el próximo deploy de `main`** | Cuenta prod a nombre de ALPHA CODE SPA (`www.flow.cl`, correo alphacode.chile@gmail.com), sandbox APARTE en `sandbox.flow.cl`. env `FLOW_API_KEY`, `FLOW_SECRET_KEY`, `FLOW_ENV` (producción solo con la palabra exacta; typo → sandbox). Por debajo es **Transbank OneClick** → acepta crédito/débito/prepago. Comisión 3,19%+IVA (costo real 3,80% del ingreso neto; emite factura 33 → IVA recuperable). NO usamos sus planes (congelan precio, incompatible con UF): tarjeta inscrita una vez + `customer/charge` mensual desde nuestro cron. Callback `app.massdte.cl/api/pagos/flow/inscripcion` (exento de auth en proxy.ts). ⚠️ El formato del `commerceOrder` es CONTRATO: cambiarlo con clientes vivos cobra doble |
| **MercadoPago** | Production ON, webhook verificado en `app.massdte.cl/api/pagos/webhook`; **queda de respaldo** (checkout usa Flow si está configurado) | env `MP_ACCESS_TOKEN`, `MP_WEBHOOK_SECRET`. **Rechaza débito y prepago para recurrencia** → no sirve como carril principal |
| **MercadoPago Empresas** | Cuenta de depósito de AlphaCode SpA | es el destino configurado en Reveniu |
| **Global66 Enterprise** | Cuenta de empresa | alternativa de depósito |
| **Reveniu** | MUERTA 2026-08-24 (decisión del fundador: "solo Flow") | sandbox roto; no re-proponer. La llave expuesta quedó como deuda consciente del fundador |
| **Transbank** | Afiliación iniciada | contacto técnico Osvaldo Cuellar |

---

## 7. Comunicación

| Canal | Estado | Notas |
|---|---|---|
| **Telegram `@massdte_bot`** | VIVO | Clientes mandan fotos de comprobantes. Webhook `app.massdte.cl/api/telegram/webhook`. env `TELEGRAM_*`. **Un solo chat activo por empresa** |
| **Telegram bot de ops** | PENDIENTE | Código listo; falta crearlo en BotFather |
| **Resend** (correo saliente) | ✅ ACTIVO desde 2026-08-23 | Dominio `massdte.cl` verificado, región us-east-1. Envía desde `no-reply@massdte.cl`. DNS en `send.massdte.cl` (MX+SPF) y `resend._domainkey` (DKIM), puestos por su integración con Vercel. API key en `.resend/token` (restringida a solo envío). **Los Logs de Resend son la visibilidad de entrega que antes no existía** |
| **SMTP de Supabase** | ✅ apunta a Resend | `smtp.resend.com:465`, usuario `resend`. Tope subido de 2 a **100 correos/hora** |
| **ImprovMX** (correo entrante) | ✅ ACTIVO desde 2026-08-23 | Cuenta bajo `genesysc0d3@gmail.com` (infra, igual que GitHub/Vercel/Supabase). Dominio `massdte.cl` validado: MX, SPF y DMARC en verde. Plan gratis: **1 dominio, 25 alias, 5 destinos por alias, 500 reenvíos/día, sin SMTP** (no lo necesitamos: el envío lo hace Resend). Solo reenvía, no guarda nada. API key en `.improvmx/token`. ⚠️ Al agregar un dominio, ImprovMX crea solo un alias comodín `*` apuntando a la cuenta con la que entraste — hay que repuntarlo o el correo de clientes cae en la cuenta de desarrollo |
| **Buzón `@massdte.cl`** | ✅ 8 alias activos | Destino: **`massdte.chile@gmail.com`**, un Gmail dedicado al producto (aparte del de la SpA y del de dev). Alias: `hola@` (aún no es cliente), `soporte@` (ya es cliente y algo se rompió), `cobros@` (plata/facturas de AlphaCode), `no-reply@` (red para los que responden los automáticos), `datos@` (canal ARCO Ley 21.719), `privacidad@` (canal ARCO Ley 21.719, declarado en las páginas legales del landing), `novedades@` (respuestas de campañas), `dmarc@` (reportes XML, filtro que archiva sin pasar por la bandeja), `ocuellar@` y `mvillegas@` (personales; corregido 2026-09-01 — antes decía osvaldo@/matias@), más el comodín `*`. El nombre a mostrar sigue la **relación**, no la marca: función para `soporte@`/`cobros@`/`privacidad@`, gente para `hola@` (Equipo MassDTE), marca pelada para lo automático, nombre propio para las personales. Se separan por **filtros de Gmail sobre el campo `Para:`** (la etiqueta sola no hace nada — etiqueta el filtro). Dejar un filtro de red `Para: massdte.cl` para cazar los que lleguen en copia oculta. El "enviar como" desde Gmail usa el SMTP de Resend, y **exige que el reenvío funcione primero** (Gmail manda el código de verificación a esa dirección) |

---

## 8. Google

| Servicio | Para qué |
|---|---|
| **Google Cloud Console** | Cliente OAuth del "Continuar con Google". Redirect: `https://xncnfrwarcrzgldalkzz.supabase.co/auth/v1/callback` |

---

## 9. Tareas automáticas (crons de Vercel)

| Hora UTC | Ruta | Qué hace |
|---|---|---|
| 12:00 | `/api/pagos/cron` | Cobranza: morosos y re-anclaje a la UF |
| 12:30 | `/api/ops/cron` | Alertas de operación |
| 12:45 | `/api/document-processing/cron` | Reintenta documentos atascados |
| 03:00 | `/api/audit/cron` | Retención y anonimización |

Protegidos con `CRON_SECRET`.

---

## 10. Dónde viven las credenciales locales

Ninguna está en el repo (todas ignoradas por git):

```
.vercel/token                    → API de Vercel
.supabase/token                  → Management API de Supabase
.supabase/massdte-us.dbpass      → password de la base de producción
.chromewebstore/credentials.json → publicar la extensión
.mercadopago/                    → credenciales de PRUEBA de MP
.flow/production.json            → llaves de PRODUCCIÓN de Flow (se suben a Vercel con scripts/flow-env-vercel.mjs; las de sandbox van en .env.local)
.resend/token                    → API key de Resend (solo envío)
.improvmx/token                  → API key de ImprovMX (alias del correo entrante)

> **Todo lo hecho el 2026-08-23 está en `docs/bitacora-2026-08-23.md`** — correo,
> respaldo, auditoría del clasificador y de la tokenización, y las correcciones
> de cumplimiento. Empieza por ahí si estás retomando.

**Identidad de git en estos repos (2026-08-23).** Ambos repos llevan
`git config --local` apuntando a `genesysc0d3-tech <genesysc0d3@gmail.com>`.

Antes heredaban la config global del Mac (`Honter <o.cuellaralarcon@gmail.com>`),
que GitHub asocia a una cuenta personal distinta. Vercel no la tiene en su equipo
→ **rechazaba construir las vistas previa** de las ramas y devolvía un enlace de
invitación al equipo en vez de un error entendible. Producción nunca se vio
afectada porque los commits de `main` nacen del squash-merge, que GitHub atribuye
a la cuenta del token (genesys, que sí está en el equipo). De ahí que un repo
desplegara bien y no mostrara previas nunca.

⚠️ `--local` vive en `.git/config` y **no se commitea**: al clonar de nuevo hay
que repetirlo, o vuelve el mismo síntoma.
.env.local                       → apunta a la base de PRODUCCIÓN (ojo)
```

⚠️ `.env.local` apunta a producción. Los scripts destructivos tienen freno
propio (`scripts/reset-db.js` se niega a correr contra los dos proyectos
conocidos sin override explícito).

---

## 11. Si algo se cae — impacto

| Se cae | Qué pasa |
|---|---|
| **Supabase** | La app entera. Es el punto único de falla real |
| **Vercel** | La app entera |
| **OpenCode** | No se procesan cartolas nuevas. Lo ya procesado sigue accesible |
| **R2** | No se ven PDFs ni se suben archivos pesados |
| **Telegram** | Solo el canal de comprobantes por chat |
| **Resend** | Nadie puede registrarse ni recuperar clave |
