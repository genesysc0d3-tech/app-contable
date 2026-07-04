# Google Login — Configuración (Google Cloud + Supabase)

El código ya está completo y desplegado; **solo falta configurar las consolas**. Tiempo estimado: 15 minutos. No requiere deploy.

## 0. Qué ya existe en el código (no tocar)

| Pieza | Dónde |
|---|---|
| Botón "Continuar con Google" | `src/app/(auth)/auth/login/page.tsx` y `registro/page.tsx` |
| Server action `signInWithGoogle` | `src/app/(auth)/auth/actions.ts` (usa `signInWithOAuth` con `redirectTo` → `/auth/callback`) |
| Callback con onboarding | `src/app/(auth)/auth/callback/route.ts` — usuario sin registro → `/onboarding`; con registro → `/`; con invitación pendiente → `/invitar/...` |

## 1. Google Cloud Console — proyecto y consent screen

1. Entrar a [console.cloud.google.com](https://console.cloud.google.com) → crear proyecto **massdte** (o reutilizar uno existente).
2. **APIs y servicios → Pantalla de consentimiento OAuth** (en consolas nuevas: "Google Auth Platform → Branding/Audience"):
   - User Type: **External** (Externo).
   - App name: `massDTE`. Correo de soporte y correo del desarrollador: el del equipo. **Nada más** (sin logo ni dominios extra: datos mínimos).
   - Scopes: dejar solo los no sensibles por defecto (`email`, `profile`, `openid`). No agregar scopes sensibles.
   - Publishing status: pasar a **In production** (en "Testing" solo entran los test users que agregues a mano).
3. **APIs y servicios → Credenciales → Crear credenciales → ID de cliente de OAuth**:
   - Application type: **Web application**. Name: `massdte-web`.

## 2. URIs de la credencial

| Campo | Valor |
|---|---|
| Authorized JavaScript origins | `https://app-contable-five.vercel.app` |
|  | `http://localhost:3001` |
| Authorized redirect URIs | `https://aluuuyecwifaakehvcam.supabase.co/auth/v1/callback` |

El redirect URI apunta a **Supabase, no a la app**: el flujo es Google → Supabase → `/auth/callback` de la app. Debe quedar exacto, sin slash final.

Al guardar, copiar el **Client ID** y el **Client Secret**.

## 3. Supabase Dashboard — habilitar el provider

1. [supabase.com/dashboard](https://supabase.com/dashboard) → proyecto `aluuuyecwifaakehvcam` → **Authentication → Sign In / Providers → Google**.
2. **Enable Sign in with Google: ON**. Pegar Client ID y Client Secret del paso 2. Save.
3. Verificar que el "Callback URL (for OAuth)" que muestra Supabase sea exactamente el redirect URI del paso 2 — si difiere, corregir en Google Cloud.

## 4. Supabase — Authentication → URL Configuration

| Campo | Valor |
|---|---|
| Site URL | `https://app-contable-five.vercel.app` |
| Redirect URLs | `https://app-contable-five.vercel.app/**` |
|  | `http://localhost:3001/**` |

Sin estas Redirect URLs, Supabase ignora el `redirectTo` del action y el usuario cae al Site URL pelado (se pierde el `next` y el flujo de invitaciones). Opcional: agregar el patrón de previews de Vercel si se quiere probar Google login en ramas (`https://app-contable-*.vercel.app/**`).

## 5. Checklist de verificación del flujo

| # | Paso | Esperado |
|---|---|---|
| 1 | `http://localhost:3001/auth/login` → "Continuar con Google" | Pantalla de Google con el nombre **massDTE** |
| 2 | Entrar con un Gmail **nuevo** (sin cuenta en la app) | Vuelve a la app y cae en **/onboarding** |
| 3 | Completar onboarding, cerrar sesión | — |
| 4 | Entrar de nuevo con el mismo Gmail | Cae directo en **/** (dashboard) |
| 5 | Repetir 1-2 en `https://app-contable-five.vercel.app` | Mismo comportamiento que local |
| 6 | Login Google teniendo invitación pendiente (link `/invitar/...`) | Cae en la página de invitación, no en onboarding |

### Errores típicos

| Síntoma | Causa | Fix |
|---|---|---|
| Google: `redirect_uri_mismatch` | El redirect URI del paso 2 no coincide carácter a carácter | Corregir en Google Cloud (esperar ~5 min de propagación) |
| Vuelve a `/auth/login` tras autorizar | Falta la Redirect URL en el paso 4, o el provider quedó sin habilitar | Revisar pasos 3 y 4 |
| "App not verified" en pantalla de Google | Consent screen quedó en Testing | Pasar a In production (paso 1.2) |
