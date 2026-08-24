# OCR local en el Mac mini (Apple Vision)

Motor de OCR que corre **en el mini, sin salir de la casa**. Reemplaza el OCR
remoto (OpenCode) para las imágenes de comprobantes: la foto con el RUT del
tercero ya no viaja a un proveedor sin contrato, es ~126 ms en vez de segundos,
y cuesta $0.

## Por qué así

- **Sin puertos abiertos.** El mini se conecta *hacia afuera* a Supabase y
  escucha la cola por `LISTEN/NOTIFY`. Nada entra al mini desde internet.
- **Instantáneo.** El NOTIFY despierta al worker apenas entra un job — sin
  polling lento. Un barrido periódico es solo la red de seguridad.
- **A prueba de caídas.** Si el mini está apagado, el job espera en la cola y se
  recupera al reconectar. Si un job se agota, el pipeline puede caer a un
  respaldo remoto (Document AI) — eso se cablea en el paso de Vercel.

## Piezas

| Archivo | Qué es |
|---|---|
| `ocr.swift` / `ocr` | Binario Vision: imagen → JSON (texto + filas por geometría). |
| `worker.mjs` | Escucha la cola, baja la imagen, corre el binario, escribe el texto. |
| `smoke-test.mjs` | Prueba e2e: inserta un job y espera el resultado. |
| `cl.massdte.ocr.plist` | LaunchAgent para que arranque 24/7 y se reinicie solo. |
| `../../supabase/migrations/20260824120000_ocr_jobs.sql` | La cola `ocr_jobs` + trigger NOTIFY. |

## Instalar en el mini

1. **Compilar el binario** (una vez, en el mini):
   ```bash
   swiftc -O -o ocr ocr.swift
   ```

2. **Node + dependencia** (el mini necesita Node 18+):
   ```bash
   npm install        # instala pg
   ```

3. **La connection string** — la misma del respaldo nocturno (pooler modo
   sesión, puerto 5432, usuario `postgres.<ref>`). Es la ÚNICA credencial que
   necesita el mini: no lleva llaves de R2 ni de Storage, porque la imagen la
   baja por una URL firmada de vida corta que le deja el encolador.

4. **Aplicar la migración** de `ocr_jobs` a la base (por Management API, como el
   resto — ver memoria `project_soporte_intervencion`).

5. **launchd**: edita `cl.massdte.ocr.plist` (rutas + `DATABASE_URL`), luego:
   ```bash
   cp cl.massdte.ocr.plist ~/Library/LaunchAgents/
   launchctl load ~/Library/LaunchAgents/cl.massdte.ocr.plist
   ```
   Es **LaunchAgent** (tu usuario), no Daemon: Vision necesita correr como
   usuario, no como root.

## Probar

Con el worker corriendo (`npm start` o vía launchd), en otra terminal:

```bash
DATABASE_URL=... EMPRESA_ID=<uuid real> IMAGE_URL=https://... npm run smoke
```

Debe imprimir el texto extraído en menos de un segundo.

## Lo que falta (paso de Vercel, aparte)

Este worker procesa la cola `ocr_jobs` de forma aislada. **Todavía no está
cableado al pipeline de producción.** El siguiente paso, con cuidado y detrás de
un flag, es que `src/lib/ai/ocr.ts` **encole** un `ocr_job` (con la URL firmada)
en vez de llamar a OpenCode, y espere el resultado — con respaldo automático al
OCR remoto si el mini no responde en unos segundos. Eso toca el camino crítico,
por eso va después de probar el mini aislado.
