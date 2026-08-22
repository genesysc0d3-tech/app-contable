# Marca massdte — archivos fuente

Rescatados de `~/Downloads` el 2026-08-22 porque **no vivían en ningún repo** y
el fundador ya no recordaba cómo se habían hecho. Si alguna vez hay que rehacer
un logo, empieza acá y no desde un PNG escalado.

## Los archivos

| Archivo | Qué es | Cuándo usarlo |
|---|---|---|
| `massdte-logo-master.ai` | **El master vectorial.** Illustrator, 5 mesas de trabajo con todos los modos | Cualquier cosa que necesite tamaño nuevo, impresión, o una variante que no exista |
| `massdte-tile-naranjo.psd` | Photoshop del tile coral cuadrado, 2000×2000 | Editar el ícono cuadrado (app, extensión, pasarelas) |
| `massdte-tile-naranjo-2000.png` | Export del anterior, 2000×2000 RGBA | Subir a servicios que piden logo cuadrado (Reveniu pide mín. 200×200) |
| `massdte-horizontal-3982.png` | Wordmark horizontal negro, 3982×858 RGBA | Cabeceras y documentos sobre fondo claro |

## Los 5 modos del .ai

1. Wordmark horizontal negro, con márgenes
2. Versión blanca (se ve vacía en preview sobre blanco — es para fondo oscuro)
3. Segunda versión blanca
4. Wordmark horizontal negro, recorte ajustado sin márgenes
5. Compacto cuadrado, blanco sobre fondo oscuro

## Dónde vive cada uno hoy en el producto

- `public/massdte-logo.png` (app y landing) — wordmark horizontal negro 1948×292
- `extensions/sii-portal-rpa/icon-{16,32,48,128}.png` — tile coral de la extensión Chrome
- `web-massdte/src/app/apple-icon.png` — tile coral 180×180
- `web-massdte/src/app/opengraph-image.png` — imagen social 1200×630

## Color de marca

El coral del producto es **`#E8553E`** (variable `--accent` en `globals.css`).
Es el mismo del tile y el que debe usarse como color de marca en pasarelas de
pago y servicios externos, para que el cliente no sienta que cambió de sitio.

## Regla

Estos archivos son fuente, no derivados: **no los reemplaces por exports**. Si
generas un tamaño nuevo, sale de acá y se guarda donde lo consuma el producto,
no en esta carpeta.
