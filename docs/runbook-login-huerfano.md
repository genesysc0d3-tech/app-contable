# Runbook: cerrarle el acceso a un login que quedó colgado

El código de la migración de empresas dice, textual, que resolver el login del
origen "es un paso HUMANO aparte (runbook)". **Ese runbook no existía.** El
2026-08-30 se ejecutó de memoria y salió mal tres veces seguidas. Esto es lo que
se aprendió.

## Cuándo aplica

Después de mover una empresa de una cuenta a otra, el dueño anterior queda con
`usuarios.empresa_id` apuntando a una empresa que ya no es suya.

El panel ahora lo grita solo, en la ficha de la cuenta que RECIBIÓ la empresa:

> **N logins ven datos de esta cuenta sin estar en el equipo**

## Por qué importa más de lo que parece

Toda la RLS de Postgres cuelga de `usuarios.empresa_id`, con policies `FOR ALL`
y sin `WITH CHECK`. Eso significa **leer, escribir y borrar**.

La app manda a esa persona a `/bloqueado` —porque no está en `cuenta_usuarios`—
pero para cuando la ve, **su navegador ya tiene un token válido**. Copiarlo y
pegarlo contra la API es todo lo que hace falta. En el caso real alcanzaba 375
movimientos bancarios y 42 cartolas de un tenant ajeno.

**El bloqueo de la app no es el control. El control es el token.**

## Lo que NO funciona (probado)

- **Borrar la fila de `usuario_empresas`.** No cierra nada: ninguna policy ni
  ninguna línea de la app lee esa tabla. El paso del plan multiempresa que la
  iba a usar nunca se ejecutó. Además el backfill de la migración la vuelve a
  crear si alguna vez se re-corre.
- **Poner `usuarios.empresa_id` en null.** La columna es `NOT NULL`. La base
  rechaza el UPDATE entero — lo cual, dicho sea de paso, evitó dejar algo a
  medias.
- **Solo `vetado = true`.** Corta la app y **no la base**. Sirve, pero no basta.

## Lo que sí cierra

En este orden, y los dos:

1. **`usuarios.vetado = true`** — corta el acceso por la app.
2. **Suspender el usuario en Auth** (`PUT /auth/v1/admin/users/{id}` con
   `ban_duration`) — corta la emisión de token, que es lo que de verdad apaga la
   RLS. Reversible: el mismo llamado con `"none"` lo revive.

Después verificar que el correo ya **no** obtiene token, y que nadie más quedó
tocado.

## Si además hay que LIBERAR el correo

Suspender **no** libera: la fila de Auth sigue existiendo, así que ese correo
**no puede volver a registrarse**. Si la idea es dejarlo como si nunca hubiera
tenido cuenta —por ejemplo, la persona se llevó su empresa a otra cuenta y ese
correo queda sin uso— hay que **borrar** el usuario de `usuarios` y de Auth.

**Antes de borrar, avisarle.** Si entra y encuentra un onboarding en blanco, va
a creer que perdió todo.

## La deuda que hay detrás

La migración `20260610190000_multiempresa_bases.sql` dejó escrito el plan de
mover las policies a `empresas_del_usuario()` y creó la función. **Ninguna
policy la usa.** Mientras la seguridad siga colgando de un campo de una sola
empresa, este runbook va a seguir haciendo falta.
