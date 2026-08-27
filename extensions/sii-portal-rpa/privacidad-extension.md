# Política de Privacidad — Extensión "MassDTE — Motor Local"

_Última actualización: 27 de agosto de 2026_

Esta política describe cómo la extensión de Chrome **MassDTE — Motor Local** (en
adelante, "la Extensión") trata los datos. La Extensión es parte del servicio App
Contable, operado por **AlphaCode SpA** (RUT 78.448.088-7, domicilio Av. Apoquindo 6410,
oficina 605, Las Condes, Santiago, Chile; contacto alphacode.chile@gmail.com). Complementa la [Política de Privacidad de App
Contable][pp].

## Qué datos maneja la Extensión

- **Credenciales del SII** (RUT y Clave Tributaria) y, si usás emisión por certificado,
  la **contraseña del certificado**. Las ingresás vos en la Extensión.
- **Configuración local** (proveedor de emisión, estado de la bóveda).

La Extensión **no** recolecta tu historial de navegación, **no** lee cookies del SII
hacia App Contable, y **no** solicita permisos sobre "todos los sitios".

## Cómo se protegen

- Las credenciales se guardan **cifradas** en tu equipo (AES-GCM), bajo un esquema de
  **llave partida (envelope)**: la llave para descifrarlas está dividida en dos, y una
  mitad vive **solo en el servidor de App Contable**, que la entrega únicamente a **tu
  sesión iniciada** con permiso de emisión. Sin iniciar sesión, lo guardado en tu
  equipo **no puede descifrarse**.
- App Contable **nunca** ve tus credenciales del SII en texto claro.
- Podés **desconectar** tu clave en todos tus equipos en cualquier momento
  (kill-switch), lo que revoca la mitad del servidor y deja lo local inservible.

## Para qué se usan

Exclusivamente para **autenticarte y emitir boletas electrónicas en el Portal del SII
por tu cuenta**, a partir de las propuestas que aprobaste en App Contable. La Extensión
abre una ventana del Portal del SII con tu sesión, completa la boleta y devuelve el
folio emitido a App Contable.

## Qué NO hacemos

- **No vendemos** ni transferimos tus datos a terceros.
- **No usamos** tus datos para publicidad, evaluación de solvencia ni fines ajenos a la
  emisión.
- **No ejecutamos** código remoto: todo el código de la Extensión viaja en el paquete.

## Terceros

La Extensión interactúa con el **Portal del SII** (sii.cl / eboleta.sii.cl) — el
organismo tributario ante el cual emitís — y con el **servidor de App Contable** para
recibir los trabajos de emisión y guardar el folio. No hay otros terceros.

## Tus derechos (Ley 19.628 / 21.719)

Podés acceder, rectificar, eliminar y portar tus datos, y revocar la conexión de tu
clave, escribiendo a **soporte@massdte.cl** o desde la app.

## Cambios

Publicaremos cualquier cambio en esta misma URL con su fecha de actualización.

[pp]: https://massdte.cl/privacidad
