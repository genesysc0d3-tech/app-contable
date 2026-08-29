# Plan: cerrar el RLS por cuenta pagadora

> Estado: **plan v2, sin ejecutar.** La v1 la revisaron dos agentes y hay que
> contar cómo salió, porque el error es más instructivo que el plan.
>
> **La v1 se anulaba a sí misma.** Su paso 1 sincronizaba `usuario_empresas`
> desde `usuarios.empresa_id`, y el usuario que se cerró a mano el 2026-08-30
> apunta justamente a una empresa ajena sin tener vínculo. Ese paso le habría
> devuelto el acceso a **375 movimientos**, y el paso 2 lo habría convertido en
> permiso de leer, escribir y borrar. O sea: el plan para cerrar la fuga la
> reabría en su primera línea. Medido, no supuesto.

## El problema

18 policies cuelgan de `usuarios.empresa_id` — **un campo de UNA empresa** que
dice "dónde estoy parado", no "a qué tengo derecho". Si ese campo queda
apuntando a una empresa que se migró a otra cuenta, la base deja entrar igual.
Eso es exactamente la fuga del 2026-08-30.

## La decisión de diseño (lo que cambió respecto de la v1)

La v1 quería mover las policies a `usuario_empresas`. **Mal**, por dos razones
que las revisiones encontraron:

1. **Esa tabla no tiene revocación y nadie la limpia.** Tres escritores, cero
   borradores. El downgrade desactiva empresas en `cuenta_empresas` y no la
   toca; la herramienta de migración de soporte agrega el vínculo del destino y
   **no quita el del origen**. Colgar la seguridad de ahí convertía la
   herramienta que arregla fugas en una fábrica de fugas permanentes.
2. **Ya existe un modelo mantenido**: 7 policies cuelgan de
   `cuentas_del_usuario()`, sobre `cuenta_usuarios`/`cuenta_empresas`, que sí
   tienen `activo`, sí se revocan y sí están auditadas. La v1 creaba un **tercer**
   modelo en paralelo por inercia.

**La expresión nueva no ensancha nada.** Sigue siendo una empresa —la activa—
pero además exige que esa empresa esté **en una cuenta donde el usuario es
miembro activo**:

```sql
empresa_id = (select u.empresa_id from public.usuarios u where u.id = (select auth.uid()))
and exists (
  select 1 from public.cuenta_empresas ce
  join public.cuenta_usuarios cu on cu.cuenta_id = ce.cuenta_id
  where ce.empresa_id = empresa_id and ce.activa
    and cu.usuario_id = (select auth.uid()) and cu.activo
)
```

Con esto:
- **No hace falta tocar `usuario_empresas`.** Se queda como está, huérfana, y se
  decide su destino aparte.
- **No se ensancha lectura ni escritura.** Importa porque en Postgres una policy
  `FOR ALL` sin `WITH CHECK` usa el `USING` **también para escribir** — la v1
  decía que no tocaba la escritura y era falso.
- El multiempresa sigue andando: el selector escribe `usuarios.empresa_id` y el
  alcance se mueve con él.

## La medición, hecha hoy

Visibilidad de `movimientos_raw` por usuario, hoy contra la expresión propuesta:

| usuario | hoy | propuesto |
|---|---|---|
| genesysc0d3 | 943 | 943 |
| angy.marcano69 | 375 | 375 |
| **mye.spa3.0** | **375** | **0** |
| e2e-… | 238 | 238 |
| mvillegas | 12 | 12 |
| resto | 0 | 0 |

**Todos conservan lo suyo y el único que pierde es el que se cerró a propósito.**
Esta tabla se vuelve a correr el día de la ejecución, sobre las 14 tablas con
`empresa_id`, y **es la aprobación**: cada fila que pierde es un cliente que va a
ver "no hay datos", y cada fila que gana hay que justificarla.

## Cómo se ejecuta

**1. Enumerar las 18 policies por nombre**, no por patrón de texto. Hay al menos
cuatro formas sintácticas distintas y un find/replace salta tres: `empresas` usa
la columna `id` (no `empresa_id`), `empresa_invitaciones` usa alias, y
`documentos_tributarios` tiene cuatro expresiones incluyendo `WITH CHECK`.
Dejarlas fuera es peor que no hacer nada: los datos se ven y la empresa no, y eso
en el escritorio es una pantalla en blanco.

**2. Usar `alter policy`, no `drop` + `create`.** Con drop+create se puede
olvidar re-declarar `for all`, el `to public` o un `with_check` existente — y una
policy que desaparece es un deny-all silencioso.

**3. Forma que conserva el índice.** Medido con `EXPLAIN` en producción: la forma
ingenua degrada a hash join y **pierde `idx_movimientos_empresa`**. Con 1.700
filas da igual; con 100 mil deja el escritorio inusable. Envolver el subselect
para que el planner lo resuelva una sola vez.

**4. Con `lock_timeout`.** `alter policy` toma `ACCESS EXCLUSIVE`. Si un job de
emisión tiene una transacción abierta, la migración espera **con los locks ya
tomados de las tablas anteriores** y cuelga el escritorio entero. Encabezar con
`set local lock_timeout = '3s'`, y correrla sin emisiones en curso — esa
comprobación ya existe en `dev/actions.ts` y se reusa.

**5. Un assert al final de la migración**: que no quede ninguna policy colgando
de `usuarios`, o `raise exception`. Si algo se saltó, la migración no pasa.

## Cómo se verifica (la de la v1 no servía)

**No sirve "abrir el escritorio y mirar".** `getUsuario()` tiene un respaldo con
permisos totales: si la policy de `empresas` queda rota, el escritorio **se ve
perfecto igual**. Y el paso 4 de la v1 era inejecutable — proponía probar con el
token del usuario baneado, que por definición no puede obtener token.

La verificación real:

1. **Antes**: correr el diff de visibilidad sobre las 14 tablas y guardarlo.
2. **Después**: repetirlo *desde una sesión real* (`set local role authenticated`
   + claims del usuario) y comprobar que los conteos coinciden con la columna
   "propuesto". Eso detecta el cero silencioso sin depender de que alguien mire
   una pantalla.
3. **Un usuario de prueba nuevo, sin vínculo**, para probar contra la API directa
   que no alcanza nada. No se puede usar al baneado.
4. Probar un **INSERT cruzado**, no solo lectura.

## La vuelta atrás

Se escribe junto con la de ida: el `alter policy` con la expresión vieja, tabla
por tabla. Como este plan **no modifica datos** —a diferencia de la v1, que
insertaba filas— volver es solo restaurar expresiones. Esa es otra ventaja de
haber sacado el paso 1.

## Lo que queda afuera, a propósito

- **`WITH CHECK` explícito** en las 10 `FOR ALL`. Hoy heredan el `USING`, que con
  esta expresión ya es correcto. Hacerlo explícito es prolijidad, no urgencia.
- **`usuario_empresas`**: qué se hace con ella. Hoy tres escritores, cero
  borradores, cero lectores reales. O se le da dueño y regla, o se borra. No
  puede quedar como está, pero tampoco es parte de este cambio.
- **`/api/archivo/[id]`**: su única autorización es el RLS, y sirve cartolas y
  comprobantes. Con esta expresión queda bien igual, pero merece su
  `.eq("empresa_id", …)` explícito — una línea, independiente de esto.
- **25 tablas con RLS activo y cero policies** (deny-all salvo service role),
  varias con datos de cliente. Correcto hoy porque solo las toca el servidor. El
  riesgo es futuro: quien les agregue una policy va a tener tres modelos donde
  elegir. Este documento fija cuál gana: **el de la cuenta pagadora**.
