# Para Matías — 6 afirmaciones, solo "bien" o "mal"

> Formato corto a propósito. El documento largo anterior queda sin efecto.
> Cada punto se contesta con una palabra; si algo está mal, una frase basta.
> Al final de cada una dice qué hace la app si no hay respuesta, para que
> nadie quede esperando a nadie.

---

**1. El monto de la planilla es TOTAL con IVA incluido.**

Si la fila dice $1.190.000, la app entiende: neto $1.000.000 + IVA $190.000.
No: $1.190.000 + IVA.

*Sin respuesta: la app le pregunta al usuario en cada planilla y no asume nada.*

**¿Bien o mal?**

---

**2. La app no pregunta "¿boleta o factura?" — pregunta "¿a quién le vendiste?".**

Si el comprador es contribuyente con giro → factura.
Si es consumidor final → boleta.
Lo define la ley por quién compra (Art. 53 DL 825), no la preferencia del cliente.

*Sin respuesta: se queda el "¿a quién le vendiste?".*

**¿Bien o mal?**

---

**3. La fecha de la factura tiene que caer en el mes de la operación.**

Si vendió el 28 de agosto, la factura va con fecha de agosto. Si el usuario la
mueve a septiembre, la app le advierte antes de emitir.

*Sin respuesta: la app advierte igual, pero deja emitir.*

**¿Bien o mal?**

---

**4. Después de emitir, la app NO dice "listo".**

Dice: "Factura emitida. Recuerda tu F29 del mes." Porque emitir no cierra la
obligación mensual.

*Sin respuesta: se queda con el recordatorio del F29.*

**¿Bien o mal?**

---

**5. La forma de pago por defecto es CONTADO, no crédito.**

Tú propusiste crédito, pero MassDTE emite **después** de que la plata llegó a la
cartola. La venta ya está cobrada cuando se factura.

*Sin respuesta: queda contado, editable por el usuario.*

**¿Bien o mal?**

---

**6. Nota de crédito: la app elige el código sola según lo que se corrige.**

Anular el documento completo → código 1.
Corregir solo texto (giro, dirección mal escrita) → código 2.
Corregir montos → código 3.

Así no hay que anular y reemitir por una dirección mal tipeada.

*Sin respuesta: la app solo ofrece anular (código 1), que es lo más seguro.*

**¿Bien o mal?**

---

## Y una que no es de la app — es de M&E

Su planilla trae **338 operaciones por $13.521.684**.

- Si M&E **compra y vende divisas por cuenta propia** → su venta es el bruto,
  y factura $13.521.684.
- Si M&E **recibe plata para pasarla a terceros** (remesas) → su ingreso es solo
  la comisión, unos $406.000, y factura eso.

Los dos casos son **exentos de IVA**. Lo que cambia es sobre qué monto.

Son 33 veces de diferencia. **¿Cuál de los dos es?**

*(Si no lo sabes con certeza, se lo preguntamos directo a ella — quien sabe si
esa plata es suya o de terceros es la clienta, no nosotros.)*
