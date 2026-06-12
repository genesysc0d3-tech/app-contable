# F1 — Facturas masivas vía robot + portal gratuito del SII

> Fuente del flujo: tutoriales del contador (junio 2026) para sus clientes —
> "Tutorial Emisión Facturas Afectas/Exentas Electrónicas". El portal
> gratuito del SII emite facturas igual que boletas; costo $0 por documento.
> Objetivo: "facturas masivas desde tu cartola" — lo que ni contando.cl
> tiene (su masivo está capado a 100-500 DTEs).

## Flujo del portal (confirmado por el tutorial de exentas)

1. www.sii.cl → Mi SII → autenticación RUT + clave personal *(el robot ya lo hace)*
2. Servicios online → Factura electrónica → **Sistema de facturación gratuito SII**
3. **Emisión DTE** →
   - Factura electrónica (afecta, tipo 33)
   - Factura no afecta o exenta (tipo 34)
4. Formulario:
   - **Receptor: solo el RUT** — el SII autocompleta razón social y dirección
   - Nombre del producto/servicio (breve; "Descripción" expande la glosa)
   - Cantidad (el sistema multiplica)
   - Precio
   - **Forma de pago: CONTADO | CRÉDITO** (ya capturado: drafts.formaPago / medio_pago)
5. **Validar y visualizar** → borrador en pantalla
6. **FIRMAR** → pide la **clave del Certificado Digital**
   - ⇒ el certificado vive CENTRALIZADO en el SII (se sube una vez, setup del
     cliente); al firmar solo se ingresa su clave → **el vault guarda la clave
     del cert cifrada, mismo patrón que la clave tributaria. Cero custodia.**

## Qué se puede construir "a ciegas" (tanda de agentes)

- Pipeline: las propuestas tipo `factura` (el clasificador YA las marca) dejan
  de excluirse; pestaña Emitir distingue boleta/factura; receptor obligatorio
  SIEMPRE (B2B) con match a `clientes` por RUT; tipo 33/34 según afecta/exenta.
- Payload de job de factura para la extensión (espejo del de boleta + campos:
  receptor_rut, cantidad, precio, forma_pago contado|credito).
- Vault: campo nuevo "clave certificado digital" (cifrado idéntico al PIN/clave).
- Metering: facturas masivas cuentan contra la misma cuota del plan (decisión
  pricing pendiente de confirmar: ¿misma cuota o cuota separada?).

## Qué REQUIERE sesión en vivo con el fundador (NO es trabajo a ciegas)

- Enseñarle al robot los selectores reales del formulario de factura
  (mismo método que las boletas: sii-explorer + sesión real + folios de
  prueba). El tutorial da el mapa; los selectores se levantan en vivo.
- Setup one-time por cliente: subir certificado al almacenamiento
  centralizado del SII (documentar como parte del onboarding).
- Verificar el flujo de la clave del certificado en sesión (¿la pide por
  documento o por sesión? — impacta la cadencia del lote).

## Después de F1

- **F2 — certificación como facturador propio** (motor server-side 24/7,
  $0 eterno, sin extensión): dte-xml.ts ya genera DTE+TED del mock como
  esqueleto; web services SII (semilla/token, EnvioDTE) + set de pruebas
  en maullin. El dossier SII es del contador; la ingeniería, de Claude.
- Ciclo B2B completo (acuse de recibo, NC/ND tipo 56/61 para facturas,
  cesión) — por fases, no bloquea la emisión simple.
