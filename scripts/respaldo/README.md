# Respaldo de la base de producción

Supabase en plan Free **no trae respaldos**: ni diarios ni recuperación en el
tiempo. Se verificó el 2026-08-23 contra su API (`pitr_enabled: false`,
`backups: 0`). Si la base se corrompe, no hay de dónde volver.

Esto lo cubre desde el Mac mini, que está encendido 24/7.

## Qué hace, cada noche a las 03:30

1. **Vuelca** `public` + `auth` + `storage` desde Supabase
2. **Restaura ese volcado en un Postgres local y compara los conteos.** Si una
   tabla testigo no calza, el respaldo se declara FALLIDO aunque el archivo
   exista — un volcado que nunca se restauró es un archivo, no un respaldo
3. Comprime y guarda local
4. Sube una segunda copia a Cloudflare R2
5. **Baja los ARCHIVOS al disco del mini**: el bucket de R2 (PDFs emitidos,
   nómina del SII) y el Storage de Supabase (cartolas e imágenes del cliente).
   El volcado se lleva el esquema `storage`, pero eso son los METADATOS: sin
   este paso, restaurar deja una base que sabe que existía un archivo en tal
   ruta y esa ruta vacía. Se **copia**, nunca se sincroniza: si alguien borra
   arriba por error, la copia de acá tiene que sobrevivirlo
6. Rota a 14 días **solo los volcados**, conservando el primero de cada mes y
   los hechos a demanda. Los archivos no se rotan: pesan poco (~220 MB) y el
   archivo que se borró arriba es justo el que uno quiere de vuelta
7. **Si algo falla, manda un correo.** Si todo anduvo, silencio. Un archivo que
   no se pudo copiar avisa pero NO invalida el volcado: son dos cosas distintas

## Antes de tocar Supabase: respaldo a demanda (REGLA, 2026-09-05)

Cada vez que se va a tocar algo en Supabase —una migración, un borrado, un
cambio de esquema— se corre esto **antes**, en el Mac mini:

```bash
~/.massdte-respaldo/respaldar.sh --ahora
```

Lleva la hora en el nombre, así tres cambios en un mismo día dejan tres
respaldos distintos en vez de pisarse. Y la rotación no los toca: se hicieron
justamente porque alguien iba a mover algo.

## Instalación en una máquina nueva

```bash
brew install postgresql@17 rclone      # pg_dump 17: Supabase corre 17.6
# NO hace falta 'brew services': el guión levanta su propia instancia de
# verificación en el puerto 5433, aislada del Postgres que ya tengas.
mkdir -p ~/.massdte-respaldo && chmod 700 ~/.massdte-respaldo
# crear ~/.massdte-respaldo/config (chmod 600) con:
#   PGURL R2_ACCOUNT_ID R2_ACCESS_KEY_ID R2_SECRET_ACCESS_KEY R2_BUCKET
#   RESEND_KEY ALERTA_A
#   SUPABASE_URL SUPABASE_SERVICE_ROLE   <- para bajar el Storage (paso 5)
cp respaldar.sh ~/.massdte-respaldo/ && chmod +x ~/.massdte-respaldo/respaldar.sh
sed "s|\$HOME|$HOME|g" cl.massdte.respaldo.plist > ~/Library/LaunchAgents/cl.massdte.respaldo.plist
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/cl.massdte.respaldo.plist
```

## Las seis trampas que costaron encontrar

1. **`pg_dump` 16 NO puede volcar un servidor 17.** Supabase corre 17.6; el
   Homebrew por defecto trae 16. Sin `postgresql@17` esto falla todas las noches.
2. **La conexión directa (`db.<ref>.supabase.co`) es IPv6.** Desde una red
   doméstica sin IPv6 ni siquiera resuelve. Hay que ir por el **pooler en modo
   sesión** (`aws-0-<region>.pooler.supabase.com:5432`, usuario
   `postgres.<ref>`) — el puerto 6543 es modo transacción y no sirve para volcar.
3. **Cloudflare le devuelve 403 a `urllib` de Python** (error 1010). El aviso va
   por `curl`. Se descubrió rompiendo la alerta a propósito.
4. **Restaurar contra un Postgres que no es Supabase escupe errores esperados**
   (sus roles no existen, y 17.11 no conoce parámetros de 17.6). Se filtran por
   nombre, para que un error de verdad no se pierda entre el ruido conocido.
5. **`LaunchAgent` no sirve para esto.** Las tareas de usuario solo corren con
   una sesión iniciada; tras un corte de luz el Mac arranca en la pantalla de
   login y el respaldo simplemente no existe — y la alerta tampoco salta, porque
   vive dentro del guión que no corre. Va como **`LaunchDaemon`** de sistema con
   `UserName`, que arranca sin sesión. Mismo problema tenía el Postgres local:
   por eso el guión **levanta su propia instancia** en vez de depender de
   `brew services`.
6. **La regional rompe Postgres en macOS, dos veces.** Una sesión remota llega
   con `LC_*` que `initdb` no acepta; y aunque el cluster se cree, el servidor
   muere al arrancar con `postmaster became multithreaded during startup`. Hay
   que forzar `LC_ALL=C` **en los dos** pasos.

## Restaurar de verdad

```bash
createdb massdte_restaurada
gunzip -c ~/Respaldos/massdte/massdte-AAAA-MM-DD.sql.gz | psql -d massdte_restaurada
```

Los errores de roles son esperados. Lo que importa es el conteo de filas.

## Cuándo dejar de depender de esto

El plan Pro de Supabase son **$25/mes** e incluye respaldos diarios con 7 días
de retención. El gatillo para pagarlo: **el primer cliente que emita una boleta
real y pagada**. Ahí los datos dejan de ser regenerables.

Mientras tanto esto da 14 días en dos lugares, y encima verifica la
restauración — que el plan Pro no hace.
