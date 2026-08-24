# Bot de Telegram: flujo con sesión

**Estado:** plan cerrado 2026-08-23. Rama `feat/telegram-sesion`, commit `eda7330`.
Falta construir el flujo; el tope de fotos y la migración ya están.

---

## Qué es el bot (definición, no reinterpretar)

Telegram **no es massdte ni el carril masivo**. Es **boleta única desde el
teléfono**: el P2P de última hora, la persona en la cama con sueño que no quiere
levantarse a la app del SII a digitar todo.

Compite contra la app de boletas del SII, no contra nuestra propia mesa.

**No emite.** Deja una propuesta en Check → Agregados → panel Telegram
(`aprobarBot` solo pone `estado:'aprobado'`). La emisión pasa después, desde la
mesa, junto con el resto. El bot es una bandeja de captura para no olvidarse.

---

## El flujo

```
hola / cualquier cosa
  → [Empresa A] [Cancelar]                    ← con UNA empresa igual sale el botón
    [Emp A] [Emp B] [Emp C] [Cancelar]        ← Business: una por empresa

elige empresa
  → "Elegiste Empresa A. ¿Qué vamos a hacer?"
    [Boleta] [Factura] [Cancelar]

elige mesa
  → "Mándame las imágenes (máximo 4)."

manda fotos (sueltas o en álbum, da lo mismo)
  → procesa

  → propuesta: [Aprobar] [Editar] [Cancelar]

aprueba
  → "Listo: boleta $150.000 — 23/08 23:41 — en tu mesa de boletas.
     Revísala en la app para emitirla."
```

**Una foto sin sesión abierta NO se procesa** (ni OCR ni storage): el bot
responde con el paso 1.

---

## Decisiones tomadas

| Decisión | Por qué |
|---|---|
| Se pregunta ANTES de recibir fotos | Hoy se procesa y recién ahí se pregunta, lo que obliga a inferir qué fotos van juntas mirando el `media_group_id` de Telegram — que depende de si el usuario las mandó de una o una por una, cosa que ni nota |
| Con 1 empresa igual sale el botón | Decisión del fundador. El paso es el mismo siempre |
| **Editar se queda** junto a Aprobar y Cancelar | Sin Editar, un monto mal leído obliga a abrir la app — justo lo que el bot venía a evitar |
| **Factura visible pero apagada** ("pronto") | La mesa de facturas no existe todavía. Se enciende sola cuando esté, sin tocar el bot de nuevo. El esquema ya acepta `mesa='factura'` |
| Tope **4 imágenes**, y se **rechaza el envío entero** | Un comprobante P2P real son 2-4 capturas (Binance, banco propio, el del cliente). Procesar un subconjunto en silencio emitiría sobre evidencia parcial sin que nadie sepa qué quedó afuera |
| El OCR de Telegram **sigue remoto por ahora** | Acá manda la velocidad: la persona está con sueño esperando. El OCR local (Vision en el mini) entra primero en el **carril masivo**, donde procesar unos minutos no molesta a nadie |
| La sesión expira a **15 min** | Mismo TTL que los pendientes de hoy. Sin esto alguien elige factura el lunes y manda la foto el jueves |
| La fase de fotos cierra con la ventana de 3 s ya existente | No es adivinar: la sesión YA declaró que es un comprobante. La ventana solo detecta que dejó de mandar |

---

## Implementación

**Idea central:** usar el token de sesión como `media_group_id` (`ses_<token>`).
Eso reutiliza tal cual la maquinaria de álbum que ya existe —buffer, ventana de
asentamiento, encolado agrupado— y de paso hace que fotos sueltas y álbum se
comporten igual, porque quien las agrupa ya no es Telegram sino la sesión.

**Hecho** (commit `eda7330`, 755 tests verdes, lint limpio):
- `MAX_FOTOS_ALBUM = 4` con rechazo del envío completo.
- La marca de rechazo vive en `documentos_subidos` (índice único por
  `media_group_id`), **no** en el buffer: si viviera en el buffer y lo limpiara,
  las fotos que llegan después armarían un álbum nuevo con las sobras.
- Migración `20260823210000_telegram_sesion.sql` escrita, **sin aplicar**.

**Falta:**
1. `src/lib/telegram/sesion.ts` — abrir, elegir empresa, elegir mesa, cerrar, expirar.
2. Recablear `handleMessage`: texto sin sesión → menú; foto sin sesión → menú.
3. Callbacks `ses:emp:<token>:<índice>`, `ses:mesa:<boleta|factura>`, `ses:cancel`.
   El callback manda el **índice**, no el uuid: la data de un callback de Telegram
   topa en 64 bytes.
4. Mensaje final tras aprobar.
5. Tests.
6. `db push` de la migración.

---

## Bug preexistente que este rediseño mata

Hoy, una cuenta Business con 2 o más empresas que manda un álbum se salta
`recibirAlbumFoto` por completo (está marcado "v1: solo chats de UNA empresa") y
cada foto **cancela la pendiente anterior**: llegan 4 mensajes "elige empresa",
3 con botones muertos, y se procesa **una sola foto**, la última.

Con la sesión no hay nada que cancelar: la empresa ya se eligió antes de mandar
fotos.

---

## Fuera de alcance (a propósito)

- No se toca el carril masivo ni la mesa.
- No se construye la mesa de facturas (bloquea el botón, no el bot).
- No se cambia el proveedor de OCR de este carril.

---

## Trampas anotadas

- Telegram manda las fotos de un álbum **en serie**, esperando el 200 de cada
  una. Por eso el tope no tiene carrera de concurrencia.
- El "reaper" que menciona un comentario del webhook **no existe**.
- El bajo peso de las imágenes **no es nuestro**: no comprimimos en ninguna
  parte, es Telegram que re-comprime las fotos. En el escritorio, en cambio, el
  tope es 10 MB y no se achica nada — una foto de celular viaja entera al modelo.
