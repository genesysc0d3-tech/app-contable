# Portal de facturas del SII — page-map REAL (fase 2 del carril RPA)

Levantado en vivo el 2026-08-26 con la sesión del contador (usuario autorizado
de MV Inversiones) navegando hasta la vista previa SIN firmar. Es la fuente de
verdad para el `fillAndEmit` de `facturas-worker.js`. Complementa la
estructura del tutorial (`docs/facturas-portal-sii-flujo.md`) con names/ids y
comportamiento verificados.

## 1. URLs (todas verificadas)

| Paso | URL |
|---|---|
| Entrada por tipo (maneja selección de empresa sola) | `https://www1.sii.cl/cgi-bin/Portal001/mipeLaunchPage.cgi?OPCION=33&TIPO=4` (33) / `OPCION=34` (34) |
| Selector de empresa | `https://www1.sii.cl/cgi-bin/Portal001/mipeSelEmpresa.cgi` |
| Formulario directo (con empresa ya elegida en la sesión) | `https://www1.sii.cl/cgi-bin/Portal001/mipeGenFacEx.cgi?PTDC_CODIGO=33` / `PTDC_CODIGO=34` |
| Vista previa (POST del formulario) | `mipeDisplayPreView.cgi` |
| Firma (POST del preview — **NO tocado**, acá se pide la clave del cert) | `mipeGenXMLFirma.cgi` |

La `start_url` del FacturaJob = `mipeLaunchPage.cgi?OPCION={tipo}&TIPO=4`:
lleva el tipo en la URL y redirige solo (selector si falta empresa, formulario
si ya está). Menú-walk queda como fallback teórico.

## 2. Selector de empresa (equivalente del selector de emisores de e-Boleta)

- Form `fPrmEmpPOP` → POST `mipeSelEmpresa.cgi`; hidden `DESDE_DONDE_URL`.
- `<select name="RUT_EMP">` con **value = RUT CON DV** (`"77155156-4"`).
  ⇒ el fail-closed del worker es match EXACTO por value contra
  `job.emisor_rut` normalizado — más robusto que el matching por texto de
  e-Boleta. 0 o >1 candidatos exactos → abortar.
- Botón submit único ("Enviar").
- Un usuario (contador) puede estar autorizado en N empresas — el caso real
  traía 11. El RUT del job es la ÚNICA verdad.

## 3. Formulario de emisión (`mipeGenFacEx.cgi`, form `VIEW_EFXP`)

HTML clásico + jQuery. **33 y 34 son el MISMO CGI y los mismos names** —
la 34 simplemente no tiene `EFXP_IVA`. Un solo worker sirve ambos.

### Campos (names verificados)
- Cabecera: `EFXP_FCH_EMIS` (input `type=date`, editable, **sin min/max
  client-side**), `EMP_MENOR_TAMANO` (checkbox), `PTDC_CODIGO` (hidden 33/34).
- Emisor (precargado): `EFXP_RZN_SOC`, `EFXP_DIR_ORIGEN` (select),
  `EFXP_CMNA_ORIGEN`, **`EFXP_CIUDAD_ORIGEN` (VACÍA y OBLIGATORIA)**,
  `EFXP_GIRO_EMIS`, `EFXP_ACTECO_SELECT`, `EFXP_TIPOVENTA_SELECT` (1=Del Giro).
- Receptor: **`EFXP_RUT_RECEP` + `EFXP_DV_RECEP` (DOS cajas)**,
  `EFXP_RZN_SOC_RECEP`, `EFXP_TIPOCOMPRA_SELECT` (1=Del Giro default),
  `EFXP_DIR_RECEP`, `EFXP_CMNA_RECEP`, **`EFXP_CIUDAD_RECEP` (VACÍA y
  OBLIGATORIA)**, `EFXP_GIRO_RECEP`, `EFXP_CONTACTO`,
  `EFXP_RUT_SOLICITA`+`EFXP_DV_SOLICITA`.
- Detalle (fila 1; `MAX_LINEA = 10`, botón `AGREGA_DETALLE`):
  `EFXP_NMB_01` (nombre), `DESCRIP_01` (checkbox → `dibujaTextArea` inserta
  la fila `rowDescripcion_01` con **textarea `EFXP_DSC_ITEM_01`**),
  `EFXP_QTY_01`, `EFXP_UNMD_01`, `EFXP_PRC_01`, `EFXP_PCTD_01`,
  `EFXP_SUBT_01` (auto).
- Forma de pago: select **`EFXP_FMA_PAGO`**: `1=Contado · 2=Crédito ·
  3=Sin Costo`; **parte en 0 y validar exige elegir** ("Debe Seleccionar
  Forma de Pago"). Nuestro job manda 1 o 2, jamás 3.
- Totales (auto): `EFXP_SUBTOTAL`, `EFXP_MNT_NETO`, `EFXP_IVA` (solo 33,
  `EFXP_TASA_IVA=19` hidden), `EFXP_MNT_TOTAL`.
- Botones: `Button_Update` ("Validar y visualizar":
  `if (validaFacEx(this)) VIEW_EFXP.submit()`), `limpiar`, `Botton_Borrar`
  (Volver), `Button_Update_Borrador`.

### Autocomplete del receptor (VERIFICADO EN VIVO)
- Gatillo: evento **`change` en `EFXP_DV_RECEP`** → `enviaCGI(this)`.
  (`change` en `EFXP_RUT_RECEP` solo limpia el DV.)
- DV inválido → `alert("Rut Receptor incorrecto")` sin llamada.
- Con DV válido: gif de espera en `#ocultaGifWait` + AJAX; en <2s llenó
  razón social, dirección, comuna y giro (probado con 78.448.088-7 →
  "ALPHA CODE SPA / APOQUINDO 6410 OF 605 / LAS CONDES / ACTIVIDADES DE
  PROGRAMACION INFORMATICA"). **Ciudad NO se llena** (el "bug" de Matías,
  confirmado y en AMBOS lados).
- Espera del worker: gif desaparecido + `EFXP_RZN_SOC_RECEP` no vacía
  (timeout → pausa humana). Después del autocomplete el worker PISA los
  campos con los datos del job si difieren (el documento nace de la app,
  no del autocompletado — decisión receptor completo del fundador) y llena
  las dos ciudades: `job.receptor.ciudad ?? comuna` (receptor) y la ciudad
  del emisor (fallback comuna del emisor).

### Validación
- `validaFacEx` es 100% client-side con **`alert()`** por cada campo
  faltante (mensajes "Debe ingresar …"). Los alerts del MAIN world NO son
  capturables desde el isolated world del content script ⇒ el worker
  **pre-valida TODO antes de clickear** Validar y visualizar (la misma
  lista: razón/giro/acteco emisor, ciudades, receptor completo, detalle,
  forma de pago ≠ 0, fecha YYYY-MM-DD) y trata un alert inesperado como
  pausa humana.
- Los totales los calcula el portal en `change` de QTY/PRC
  (`calculaRelacionadoFacEx`) — el guardarraíl TOTAL_MISMATCH compara
  `EFXP_MNT_TOTAL` contra `job.totales.monto_total` (±$1) ANTES de validar.

## 4. Vista previa (`mipeDisplayPreView.cgi`, form `PreViewDTE`)

- Texto ancla: "REVISIÓN DE DOCUMENTO TRIBUTARIO ELECTRÓNICO" + marca
  "Documento NO válido" en la imagen del documento.
- Todo el documento viaja en hiddens del form (`EFXP_*`).
- Botones: **`btnSign` ("Firmar")** → `goSignDTE`: deshabilita ambos
  botones, muestra espera y hace `action = mipeGenXMLFirma.cgi; submit()`.
  **`btnCorregir` ("Corregir")** → vuelve al formulario con los datos.
- ⇒ **el candado monótono anti-doble-emisión se arma ANTES de clickear
  `btnSign`** (es el acto que puede quemar folio).

## 5. Lo ÚNICO pendiente para la fase 4 (emisión supervisada)

La pantalla de `mipeGenXMLFirma.cgi` (post-Firmar): texto exacto del prompt
de la **clave del certificado digital**, sus errores (clave mala), y si la
pide por documento o por sesión. No se tocó a propósito: llegar ahí puede
quemar folio. Se mapea en la primera factura real de AlphaCode con el
fundador mirando.

## Notas de sesión
- La prueba se hizo con la sesión del contador (RUT personal) operando
  MV Inversiones como usuario autorizado — confirma el modelo "un usuario
  autorizado opera N empresas" del selector.
- "Hacer documento similar al último emitido" existe arriba del formulario
  (futuro: podría acelerar el masivo, no se usa por ahora).
- Nada quedó guardado: no se usó "Guardar Borrador" y el preview no asigna
  folio; se salió con Corregir/navegación.
