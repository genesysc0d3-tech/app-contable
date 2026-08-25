# Portal de facturas del SII — flujo real (guía de Matías, 2026-08-24)

Fuente: tutorial con capturas del portal que mandó Matías (PDF en poder del
fundador; acá solo la estructura, sin datos de terceros). Es la referencia
para el módulo de facturas de la extensión (el hermano del de eboleta).

## Ruta de navegación (8 pasos)

1. www.sii.cl → 2. Mi SII → 3. Autenticarse con RUT y clave →
4. Servicios Online → 5. Factura Electrónica →
6. **Sistema de Facturación Gratuito SII** → 7. Emisión DTE →
8. Tipo de documento: "Factura no afecta o exenta" (34) / "Factura" (33)

## El formulario de emisión

**Datos emisor**: precargados por el SII (razón social, dirección con
selector, comuna, tipo de venta, giro, act. económica, email, teléfono).
Checkbox "Empresa Menor Tamaño". Fecha de emisión editable.

**Datos receptor**: Rut, Razón Social, Tipo de Compra (default "Del Giro"),
Dirección, Comuna, Ciudad, Giro, Contacto, Rut solicita.
⚠️ CLAVE: **al digitar el RUT, el SII autocompleta el resto solo.** Por eso
la plantilla puede ser mínima (RUT + detalle + total); las columnas de
respaldo sirven para el caso persona natural sin giro (criterio 8 de Matías:
se informa, se ingresa a mano, se reintenta, se guarda).

**Detalle** (repetible con "Agrega línea de Detalle"): Cod Producto
(checkbox), Nombre Producto, checkbox **Descrip.** (abre glosa extendida),
Cantidad, Unidad, Precio, %Desc., SubTotal (el portal multiplica solo).

**Forma de Pago**: selector Contado/Crédito — el criterio 7 de Matías calza
1:1: el selector del lote en massdte alimenta este campo. Checkboxes
Referencias e Info. Pago.

**Totales**: Sub Total, Descuento Global (% y monto), Monto Exento, Total —
los calcula el portal.

## Ciclo de emisión

Botones: **Validar y visualizar** | Limpiar | Volver | **Guardar Borrador**.
Validar → Vista Previa del borrador (con marca "documento no válido") →
**Firmar** | Corregir.

⚠️ **Al Firmar pide la Clave del CERTIFICADO DIGITAL** — es un secreto
DISTINTO de la clave SII. La bóveda de la extensión necesita guardar ambos
(el certificado vive centralizado en el SII; la clave lo desbloquea).

## El documento resultante (patrón de la factura real 635, DTE 34)

Emisor arriba-izquierda (razón social, giro, dirección, email, teléfono,
"TIPO DE VENTA: DEL GIRO"); recuadro rojo arriba-derecha (RUT, "FACTURA NO
AFECTA O EXENTA ELECTRONICA", N° folio, S.I.I. + comuna); bloque receptor
(SEÑOR(ES), RUT, GIRO, DIRECCION, COMUNA, CIUDAD, CONTACTO, TIPO DE COMPRA);
tabla detalle (Código, Descripción multilínea, Cantidad+moneda, Precio,
%Impto Adic., %Desc., Valor); "Forma de Pago:" bajo la tabla; totales a la
derecha (IMPUESTO ADICIONAL, EXENTO, TOTAL); timbre TED abajo-izquierda con
"Res.99 de 2014 Verifique documento: www.sii.cl".
