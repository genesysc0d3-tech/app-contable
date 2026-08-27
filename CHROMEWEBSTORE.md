# Chrome Web Store — MassDTE — Motor Local

> Última actualización: 2026-08-27 · Versión en preparación: **0.2.0**
> Ítem existente: `klblpnnmbbmicpbnhlkfceiiijppobfe` (publicado como **No listada** desde 0.1.5)

Este archivo es la fuente única de lo que va en el Panel del Desarrollador: textos,
justificación de permisos, declaración de datos e historial. Se actualiza cada vez que
cambia el manifest o algo que el usuario ve.

---

## Ficha de la tienda

**Nombre**
MassDTE — Motor Local

**Descripción corta** (máx. 132)
Emite tus boletas y facturas electrónicas en el portal del SII desde tu propio computador, con tus claves.

**Descripción detallada**

MassDTE — Motor Local emite tus documentos tributarios en el portal del Servicio de
Impuestos Internos de Chile desde tu propio computador.

Qué hace por ti:
Toma los documentos que ya revisaste y aprobaste en massdte.cl y los emite uno por uno en
el portal del SII, llenando el formulario, firmando y guardando el folio y el PDF oficial
de cada uno. Tú apruebas; el motor hace el trámite.

Emite boletas electrónicas (afectas y exentas) y facturas electrónicas (afectas y exentas)
por el Sistema de Facturación Gratuito del SII.

Cómo se usa:
1. Instala la extensión y entra a tu cuenta en massdte.cl.
2. Guarda tus claves del SII en las opciones de la extensión: quedan cifradas en tu equipo.
3. Revisa y aprueba tus documentos en la aplicación.
4. Aprieta emitir. Se abre una ventana del SII y el motor hace el trabajo a ritmo humano,
   sin que tengas que tocar nada.

Sobre tus datos y tus claves:
Tus claves del SII se guardan cifradas en tu propio equipo y se usan únicamente para
iniciar sesión en el portal del SII. La extensión no lee tu historial de navegación, no
pide permisos sobre "todos los sitios" y solo actúa en las páginas del SII y en tu propia
cuenta de massdte.cl.

Requiere una cuenta activa en massdte.cl y tus credenciales del SII.

Soporte: soporte@massdte.cl

**Categoría**
Productivity

**Propósito único**
Emitir los documentos tributarios electrónicos del usuario en el portal del SII de Chile,
usando sus propias credenciales, desde su computador.

**Idioma principal**
Español (Chile)

---

## Gráficos

| Recurso | Medidas | Estado | Archivo |
|---|---|---|---|
| Ícono de tienda | 128×128 PNG | ✅ Listo | `extensions/sii-portal-rpa/icon-128.png` |
| Captura 1 | 1280×800 | 🟡 Refrescar para 0.2.0 | mostrar la mesa de facturas y el botón Emitir |
| Captura 2 | 1280×800 | 🟡 Refrescar para 0.2.0 | la ventana segura del SII trabajando con su aviso |
| Captura 3 | 1280×800 | ⬜ Sugerida | el resultado: folio y PDF guardados en la app |
| Mosaico chico | 440×280 | ⬜ Opcional | — |

Nota: la ficha ya está publicada con las capturas de 0.1.x. Como es **No listada**, no
compite en búsqueda; refrescarlas es deseable, no bloqueante.

---

## Justificación de permisos

Sin cambios respecto de la versión 0.1.8 ya aprobada: la 0.2.0 no agrega ni un permiso.

| Permiso | Tipo | Justificación |
|---|---|---|
| `tabs` | permissions | El motor abre una ventana dedicada del portal del SII y necesita saber cuándo terminó de cargar cada paso (seleccionar empresa, validar, firmar) para continuar el trámite. También detecta si esa ventana sale del dominio del SII, para detenerse y no seguir automatizando fuera de él. |
| `scripting` | permissions | Reinyecta el puente de comunicación en la pestaña de massdte.cl cuando la extensión se actualiza, para que el usuario no pierda lo que estaba haciendo ni tenga que recargar la página. |
| `storage` | permissions | Guarda en el equipo del usuario sus credenciales del SII cifradas y sus preferencias del motor (proveedor de emisión, estado de la bóveda). |
| `https://*.sii.cl/*`, `https://www.sii.cl/*` | host_permissions | Es donde ocurre la emisión: el motor llena el formulario del documento, lo valida, lo firma con la clave del certificado del usuario y lee el folio resultante en el portal del SII. Sin acceso a estas páginas la extensión no puede hacer nada de lo que ofrece. |
| `https://eboleta.s3.amazonaws.com/*` | host_permissions | El SII entrega el PDF de las boletas electrónicas desde este almacenamiento. Se usa solo para descargar el comprobante oficial del documento que el propio usuario acaba de emitir. |
| `https://app.massdte.cl/*` | host_permissions | Es la aplicación del usuario: por ahí llegan los documentos aprobados que se van a emitir y por ahí se devuelve el folio y el PDF una vez emitidos. |
| `https://app-contable-five.vercel.app/*` | host_permissions | Dominio anterior de la misma aplicación, mantenido durante la transición para no romper a los usuarios que aún lo tienen abierto. |

Ningún permiso se usa fuera de lo descrito. No se pide `<all_urls>`.

---

## Privacidad y uso de datos

### ¿Recolecta datos del usuario?
**No se transmiten a terceros.** Los datos que la extensión maneja viajan únicamente entre
el equipo del usuario, el portal del SII y la cuenta del propio usuario en massdte.cl.

| Tipo de dato | ¿Se maneja? | ¿Sale del equipo? | Propósito | ¿Se comparte con terceros? |
|---|---|---|---|---|
| Información de autenticación | Sí (RUT + Clave Tributaria del SII y, si corresponde, clave del certificado digital) | No. Se guardan **cifradas en el equipo** y solo se envían al portal del SII para iniciar sesión y firmar. | Emitir los documentos del propio usuario | No |
| Información financiera | Sí (montos y folios de los documentos emitidos) | Sí, a la cuenta del propio usuario en massdte.cl | Registrar el documento emitido y su comprobante | No |
| Identificación personal | Sí (RUT y razón social del receptor, dato del propio documento tributario) | Sí, a la cuenta del propio usuario en massdte.cl | Emitir el documento con su receptor | No |
| Historial de navegación | No | — | — | — |
| Ubicación, salud, comunicaciones personales | No | — | — | — |
| Contenido de sitios web | Solo las páginas del portal del SII durante una emisión | No se almacena | Leer el folio y el comprobante del documento recién emitido | No |
| Actividad del usuario | No se rastrea | — | — | — |

### Certificación
- [x] Los datos **no** se venden a terceros
- [x] Los datos **no** se usan para fines ajenos a la función principal
- [x] Los datos **no** se usan para evaluación crediticia ni préstamos

### Notas de seguridad
Las credenciales se cifran con AES-GCM bajo un esquema de **llave partida**: una mitad vive
en el equipo y la otra en el servidor de massdte.cl, que la entrega solo a la sesión
iniciada del propio usuario con permiso de emisión. Sin iniciar sesión, lo guardado en el
equipo no se puede descifrar. La extensión nunca envía las credenciales a massdte.cl ni a
ningún tercero: solo al formulario del SII.

---

## Política de privacidad

Documento fuente: `extensions/sii-portal-rpa/privacidad-extension.md`

**URL pública** — ⚠️ **CONFIRMAR ANTES DE ENVIAR**: debe estar publicada y accesible. La
ficha actual ya declara una; verificar que siga viva y que refleje el manejo de la clave
del certificado (nuevo en 0.2.0).

---

## Distribución

**Visibilidad**: No listada (solo por enlace)
**Regiones**: Todas
**Motivo**: el motor solo sirve a contribuyentes chilenos con cuenta en massdte.cl; no
tiene sentido ofrecerlo en búsqueda abierta.

---

## Desarrollador

**Editor**: AlphaCode SpA
**RUT**: 78.448.088-7
**Domicilio**: Av. Apoquindo 6410, oficina 605, Las Condes, Santiago, Chile
**Contacto**: alphacode.chile@gmail.com
**Soporte**: soporte@massdte.cl
**Sitio**: https://massdte.cl

---

## Historial de versiones

| Versión | Fecha | Cambios | Estado |
|---|---|---|---|
| 0.2.0 | 2026-08-27 | **Emisión de facturas electrónicas (afectas y exentas)** por el Sistema de Facturación Gratuito del SII: llenado del formulario, firma con la clave del certificado, captura del folio y del PDF oficial. Sin permisos nuevos. | Preparada |
| 0.1.8 | 2026-08-22 | La aplicación pasa a ser la fuente única del RUT emisor (arregla las cuentas con más de una empresa). | Publicada |
| 0.1.7 | 2026-08-20 | Traslado al dominio app.massdte.cl. | Publicada |
| 0.1.6 | 2026-08-20 | Primera versión pública. | Publicada |
| 0.1.5 | 2026-08-14 | Primera publicación (No listada). | Publicada |

---

## Notas de revisión

### Qué mirará el revisor (y la respuesta)
- **Automatiza un sitio de gobierno.** Sí, con las credenciales del propio usuario, en su
  equipo y sobre sus propios documentos. No accede a datos de terceros ni evade controles:
  hace el mismo trámite que la persona haría a mano, a ritmo humano.
- **Pide `tabs` + acceso amplio a `*.sii.cl`.** El portal del SII reparte el trámite entre
  varios subdominios (`www1`, `zeusr`, `misiir`) y cada paso es una página distinta; sin el
  comodín el flujo se corta a la mitad.
- **Maneja credenciales.** Cifradas en el equipo, con llave partida, y nunca se envían a un
  tercero — solo al formulario del propio SII.

### Cambios respecto de la versión aprobada
La 0.2.0 **no agrega permisos**. Suma un archivo de contenido (`facturas-worker.js`) que
corre en los mismos dominios del SII ya autorizados.

### Antes de enviar
- [x] Versión sincronizada en manifest.json, manifest.prod.json, modules/core.js y la app
- [x] El paquete excluye `node_modules`, `.git` y archivos de desarrollo
- [x] Permisos sin cambios respecto de la versión aprobada
- [ ] Confirmar que la URL de la política de privacidad está viva
- [ ] Refrescar capturas mostrando la mesa de facturas (deseable, no bloqueante)
