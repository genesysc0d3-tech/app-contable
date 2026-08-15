# Publicar en la Chrome Web Store — MassDTE — Motor Local

Guía + textos listos para copiar/pegar en la [Developer Console](https://chrome.google.com/webstore/devconsole).
Recomendación: **visibilidad "No listada"** (se instala con link, no aparece en búsquedas) para la beta.

---

## 0. Antes de empezar (una vez)
1. Cuenta de desarrollador de Chrome Web Store: **US$5** (pago único) con una cuenta de Google.
2. Generar el paquete: `bash scripts/build-extension.sh` → deja el `.zip` en `dist/extension/`.
   Ese zip usa `manifest.prod.json` (sin localhost) y no incluye archivos de desarrollo.

## 1. Subir el paquete
- En la consola: **Nuevo elemento** → subir `dist/extension/massdte-motor-local-v0.1.5.zip`.

## 2. Ficha de la tienda (copiar/pegar)

**Nombre:** `MassDTE — Motor Local`

**Descripción corta (132 car. máx):**
> Emite tus boletas electrónicas en el Portal del SII directamente desde App Contable, en tu propio computador.

**Descripción larga:**
> MassDTE — Motor Local es el complemento que emite tus boletas electrónicas de venta (afecta 39 / exenta 41) en el Portal del SII (eboleta.sii.cl), por tu cuenta y desde tu propio equipo, a partir de las propuestas que ya aprobaste en App Contable.
>
> Cómo funciona:
> • App Contable te propone las boletas a partir de tus cartolas.
> • Vos las revisás y apruebás en la app.
> • Esta extensión abre una ventana del Portal del SII con TU sesión, completa la boleta y guarda el folio de vuelta en la app.
>
> Seguridad:
> • Tus credenciales del SII se guardan CIFRADAS y con llave partida: una mitad vive solo en el servidor de App Contable y solo se entrega a tu sesión iniciada. Sin iniciar sesión, lo guardado no se puede descifrar.
> • La extensión NO lee las cookies del SII, NO envía tu clave a terceros y NO usa permisos sobre "todos los sitios".
> • Podés desconectar tu clave en todos tus equipos desde la app (kill-switch).
>
> Requiere una cuenta de App Contable.

**Categoría:** Flujo de trabajo y planificación (Workflow & Planning)
**Idioma:** Español (Chile)

## 3. Justificación de permisos (el revisor de Google los pide uno por uno)

| Permiso | Justificación (pegar) |
|---|---|
| `tabs` | Abrir y coordinar una ventana dedicada del Portal del SII donde se emite la boleta, y devolver el resultado a la pestaña de App Contable. |
| `scripting` | Completar el formulario de boleta y leer el folio/confirmación en la sesión del SII del propio usuario, para automatizar la emisión que él ya aprobó. |
| `storage` | Guardar localmente las credenciales del SII del usuario CIFRADAS y su configuración de la extensión. |
| Host `https://*.sii.cl/*`, `https://www.sii.cl/*` | Operar el Portal del SII / e-Boleta para emitir la boleta (función central de la extensión). |
| Host `https://eboleta.s3.amazonaws.com/*` | Descargar el PDF/comprobante de la boleta que el SII sirve desde S3. |
| Host `https://app-contable-five.vercel.app/*` | Recibir los trabajos de emisión desde la app web de App Contable y devolver el folio emitido. |

**Propósito único (single purpose):**
> Automatizar la emisión de boletas electrónicas en el Portal del SII, por cuenta del propio usuario, a partir de las propuestas generadas en App Contable.

**¿Usa código remoto?** No. Todo el código va dentro del paquete; no se descarga ni ejecuta código externo. (Es la causa #1 de rechazo — y acá no aplica.)

## 4. Privacidad (pestaña "Privacy practices")

Declarar el uso de datos así:
- **Información de autenticación** (RUT + Clave Tributaria del SII, y contraseña del certificado si usa facturas): **SÍ** se maneja. Uso: exclusivamente para autenticar y emitir en el SII **por cuenta del usuario**. Se guarda **cifrada con llave partida**; App Contable nunca ve la clave en claro.
- **NO** se vende ni transfiere a terceros.
- **NO** se usa para fines ajenos a la función principal.
- **NO** se usa para determinar solvencia ni para publicidad.

Marcar las 3 casillas obligatorias (no se vende, no se usa fuera del propósito, no para solvencia/publicidad).

**URL de política de privacidad** (obligatoria): ya está hospedada y en vivo →
**`https://app-contable-five.vercel.app/legal/extension`**. Pegá esa URL. (El texto fuente
está en `privacidad-extension.md`; la página vive en `src/app/legal/extension/page.tsx` y
difiere RUT/domicilio de la SpA igual que la política general, así que no bloquea la beta.)

## 5. Después de publicar (¡importante!)
1. Copiá la URL de la ficha (algo como `https://chromewebstore.google.com/detail/<id>`).
2. En Vercel → Project `app-contable` → Settings → Environment Variables:
   `NEXT_PUBLIC_EXTENSION_STORE_URL = <esa URL>`  (Production).
3. Redeploy. A partir de ahí, los botones **"Instalar extensión"** de la app llevan directo a la store (antes mostraban los pasos manuales).

## Notas
- La revisión de Google suele tardar días; puede tardar más por los permisos amplios + automatizar un portal de gobierno. Respondé claro que la extensión actúa **por cuenta del propio usuario, con su consentimiento**.
- Para actualizar: subí una versión con `version` mayor en `manifest.prod.json`, re-corré el build y subí el nuevo zip. Los usuarios se auto-actualizan.
