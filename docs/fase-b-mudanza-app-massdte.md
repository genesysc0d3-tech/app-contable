# Fase B — mudar la app a app.massdte.cl (checklist ejecutable)

Estado: **Pasos 1 y 2 HECHOS** (2026-08-20). Paso 3 pendiente (al activar cobro real MP).

Ejecutado 2026-08-20: site_url+allow_list Supabase, NEXT_PUBLIC_APP_URL (app+landing) + redeploys, 308 del host viejo, verificación completa (308→app.massdte.cl, landing apunta al nuevo). 0.1.7 PUBLICADA con PROD_APP_ORIGIN nuevo + auto-update. (c) Google OAuth: no se tocó Cloud Console — el flujo va por el callback de Supabase (sin cambio); si el login Google reclamara origen, agregar app.massdte.cl al cliente OAuth.

## Por qué en este orden
La extensión tenía `app-contable-five.vercel.app` quemado (manifest + 5 archivos). Si la app
se muda ANTES de que la extensión nueva llegue al Chrome de los clientes, dejan de emitir.
Por eso: primero extensión que acepta ambos hosts → esperar → después mover la app.

## Paso 1 — Extensión 0.1.6 dual-host ✅
- PR #140: acepta `https://app.massdte.cl` Y `https://app-contable-five.vercel.app`.
- Publicada por API (`scripts/publish-extension.sh 0.1.6`): upload SUCCESS, publish OK.
- Esperar que Google la publique y que llegue a clientes (~horas; Chrome busca updates
  cada ~5 h; forzable en `chrome://extensions` → Actualizar). Verificar en la ficha
  (devconsole) que la versión publicada sea 0.1.6.

## Paso 2 — Mover la app (ejecutar SOLO cuando la 0.1.6 esté en los clientes)
Todo por API/config, sin código salvo el punto 2e. Orden sugerido:

a) **Supabase Auth** (Management API, token en `.supabase/token`):
   - `site_url` → `https://app.massdte.cl`
   - `uri_allow_list` → agregar `https://app.massdte.cl/**` (mantener el viejo un tiempo).
   Sin esto: confirmación de email / OAuth Google / recuperar clave redirigen al host viejo.

b) **Vercel env** `NEXT_PUBLIC_APP_URL` = `https://app.massdte.cl` (production + preview)
   → redeploy prod. Lo usan: back_url de MP, `encadenarKick` del pipeline, links de correos.

c) **Google OAuth** (Cloud Console, cliente "MASSDTE LOGIN"): agregar
   `https://app.massdte.cl` en orígenes autorizados y el callback de Supabase ya cubre
   el redirect (va por `<ref>.supabase.co/auth/v1/callback`, no cambia).

d) **Redirect del host viejo** (Vercel, dominio del proyecto app-contable):
   `app-contable-five.vercel.app` → `redirect: app.massdte.cl` (308). Así links viejos,
   marcadores y la extensión (fallback PROD_APP_ORIGIN) siguen llegando.

e) **Landing** (repo web-massdte, proyecto Vercel): env `NEXT_PUBLIC_APP_URL` →
   `https://app.massdte.cl` → redeploy. (Header "Ingresar"/"Prueba gratis" y Pricing).

f) **Verificar**: login con Google desde app.massdte.cl; confirmación de email; la
   extensión conecta (banner "Extensión conectada") en app.massdte.cl; emitir 1 boleta
   real de prueba chica; `app-contable-five.vercel.app/massdte` → 308 → app.massdte.cl.

g) **Extensión 0.1.7** (después, sin apuro): `PROD_APP_ORIGIN` → `https://app.massdte.cl`
   y, cuando ya nadie use el host viejo, quitarlo de manifests/allowlists.

## Paso 3 — Al activar cobro real de MP
- URL del webhook en MP (modo productivo) → `https://app.massdte.cl/api/pagos/webhook`.
- Envs `MP_ACCESS_TOKEN` + `MP_WEBHOOK_SECRET` en Production (form local 127.0.0.1:3998).

## Gotchas conocidos
- Cambiar `NEXT_PUBLIC_*` requiere redeploy (se hornea en build).
- Un merge a main puede quedar solo como PREVIEW en Vercel: verificar que production
  sirva el commit (forzar con `forceNew=1` + `target: production`).
- Supabase `site_url` en localhost rompió la confirmación de email en el arranque de la
  beta (jul-2026): doble-chequear que quede en `https://app.massdte.cl`.
