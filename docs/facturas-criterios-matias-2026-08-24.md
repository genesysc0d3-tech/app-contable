# Criterios de Matías para el motor de facturas — 2026-08-24

Respuesta del contador (socio) a las afirmaciones y a la auditoría normativa.
ES LA ESPECIFICACIÓN FUNCIONAL del motor de facturas: cualquier diseño se
contrasta contra este documento. Texto íntegro, sin editar.

---

## 1. Factura vs. boleta: no corresponde que el sistema interprete

**MassDTE Facturación no debe decidir, interpretar ni sugerir qué documento
tributario corresponde emitir.** El objetivo es acotado: emitir facturas,
principalmente de manera masiva. No preguntar "¿a quién le vendiste?"; no
determinar si corresponde boleta o factura; no hacer juicios tributarios.
El usuario ya está en el módulo de facturación porque quiere emitir facturas.

Flujo principal: **Cargar Excel → leer datos → borrador/revisión → emitir.**

El sistema facilita la emisión, no reemplaza el criterio tributario del
contribuyente.

## 2. Mensaje posterior a la emisión

Simple: **"Tu factura fue emitida correctamente."** Nada de RCV, F29 ni otras
obligaciones. Es un emisor, no un fiscalizador del contribuyente.

## 3. Advertencias: informar, pero nunca bloquear

**MassDTE puede advertir, pero no debe bloquear por criterios tributarios
interpretativos.** La decisión final es del usuario. Aplica también a fechas
y situaciones similares de la auditoría.

## 4. Monto de la planilla: siempre VALOR TOTAL

**Un solo campo de monto = total final del documento.** Nada de neto/IVA/
"IVA incluido" por fila. Facturador exento: el monto ES el total. Facturador
afecto: del total el sistema calcula internamente neto e IVA.

## 5. Emisión individual de facturas

Además del carril masivo (Excel), un modal de **factura única** (similar al
de boletas). Dos vías en el mismo módulo.

## 6. Notas de crédito: módulo ANEXO con flujo propio

Las NC SÍ forman parte del sistema de facturación, pero NO se mezclan con el
flujo masivo. Se emiten **individualmente**, partiendo de la factura emitida:

Factura emitida → seleccionar → "Emitir nota de crédito" → antecedentes se
cargan solos → completar tipo de corrección → emitir NC.

La referencia debe ser a un documento válido (el SII lo exige). Diseñar los
tipos/códigos de NC de la auditoría. **NO simplificar asumiendo que todo se
resuelve anulando y reemitiendo.**

## 7. Forma de pago del lote: selección obligatoria antes de emitir

Selector en la revisión del lote (Contado / Crédito), aplicado al lote
completo. **De preferencia SIN valor preseleccionado**: el usuario escoge
expresamente antes de poder emitir. El sistema no presupone la operación.

## 8. Receptor persona natural

No bloquear, no cambiar a boleta, no sugerir boleta. Ejecutar la factura
pedida. Si el SII informa que el receptor no tiene giro/inicio de
actividades: informar y permitir **ingresar el giro a mano** y reintentar;
ese giro se guarda en la base de clientes para la próxima.

## Principio rector

**MassDTE Facturación es un motor de emisión de DTE, no un asesor tributario
automatizado.** Captura datos, valida campos necesarios, muestra errores del
SII, permite revisar el lote, calcula la matemática del documento, emite y
registra. **Automatizar el trabajo mecánico de facturar, manteniendo las
decisiones tributarias en manos del usuario.**
