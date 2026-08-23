# Contratos de tratamiento de datos — evidencia

Capturados el **2026-08-23** desde la web pública de cada proveedor.

## Por qué están acá

El **Art. 8° de la Ley 19.628** (vigente hoy) exige que el tratamiento por
mandato conste **por escrito**, *"dejando especial constancia de las condiciones
de la utilización de los datos"*. Estos cuatro proveedores lo satisfacen sin
trámite: su contrato de tratamiento **se incorpora al aceptar sus términos**.

Supabase lo dice textual: *"Acceptance of the Agreement shall have the same
effect as signing the SCCs"*. Vercel: *"By entering into the Agreement, Data
Exporter is deemed to have signed these Standard Contractual Clauses"*.

O sea el mandato escrito **ya existe**. Lo que faltaba no era firmarlo: era
tener a mano la copia con su fecha, que es lo que se exhibe si la Agencia
pregunta. Eso es esto.

## Lo guardado

| Proveedor | Archivo | sha256 (16) | Origen |
|---|---|---|---|
| Supabase | `supabase-dpa-2026-08-23.txt` | `9683f9bd9f872466` | <https://supabase.com/legal/dpa> |
| Vercel | `vercel-dpa-2026-08-23.txt` | `54df81fe70f0b594` | <https://vercel.com/legal/dpa> |
| Cloudflare | `cloudflare-dpa-2026-08-23.txt` | `8d4bd428bc8b3a2b` | <https://www.cloudflare.com/cloudflare-customer-dpa/> |
| Resend | `resend-dpa-2026-08-23.txt` | `a824b5ee405a51c6` | <https://resend.com/legal/dpa> |

El hash permite acreditar que la copia no se alteró después de capturarla.

**Se guardan como texto, no como HTML, y no es por gusto.** La primera versión
guardó el HTML original de cada sitio y eso **rompió el build**: Tailwind escanea
todo el proyecto buscando clases, se comió las del marcado ajeno, y generó CSS
pidiendo una imagen (`/static/texture-btn.png`) que solo existe en el sitio de
Resend. Un documento de terceros dentro del árbol del proyecto no es inerte.

## Los que NO están acá, y por qué

| Proveedor | Situación |
|---|---|
| **OpenCode** (Anomaly Innovations, Inc.) | No ofrece contrato de tratamiento. Ver `../21719-evaluacion-proveedor-ia.md`: evaluación de riesgo, controles compensatorios y plazos |
| **Telegram** | Servicio de mensajería de consumo, no ofrece contrato a nadie. Declarado en los T&C §5.1 y aceptado por el usuario. Canal **opcional**: la app funciona sin él |
| **Mercado Pago** | Transitorio — se reemplaza por Reveniu. No se gestiona contrato con un proveedor que sale |
| **ImprovMX** | Pendiente de evaluar |

## Cuándo volver a capturarlos

Estos documentos cambian sin aviso. Recapturar **al menos una vez al año**, y
siempre que se contrate un plan distinto o se agregue un proveedor. Si un hash
cambia respecto de la captura anterior, hay que leer qué se modificó antes de
reemplazar el archivo.

---
*Evidencia recopilada con compliance-cl. No constituye asesoría legal.*
