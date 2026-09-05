# Runbook: robo del Mac mini o filtración de sus llaves

El Mac mini guarda, en un disco **sin cifrar** (decisión consciente: si se
cifrara, tras un corte de luz no arrancaría el respaldo), el archivo
`~/.massdte-respaldo/config` con las llaves de producción en texto plano. Si el
mini se **roba, se pierde, o sospechas que alguien copió ese archivo**, ejecuta
este runbook. El orden es de mayor a menor daño posible.

**Regla de oro:** rotar una llave la INVALIDA. Cualquiera que la tenga deja de
poder usarla. Es preferible rotar de más y reconfigurar, que dudar y quedar
expuesto. Todo esto se hace desde OTRA máquina (la MacBook Air), no desde el mini.

---

## Qué hay expuesto (para dimensionar)
En `config` viven: `PGURL` (usuario `postgres` = **superusuario**, puede borrar
la base entera), `SUPABASE_SERVICE_ROLE` (saltea toda la seguridad de la app),
las llaves de Cloudflare R2 (leer/escribir/**borrar** el bucket, incluidos los
respaldos), y `RESEND_KEY` (mandar correo como no-reply@massdte.cl).

Lo que el mini **NO** tiene (verificado 2026-09-05, reduce el daño): ninguna
llave privada SSH, ningún token de Vercel/GitHub/Supabase-management, ningún
checkout del repo. Un ladrón del mini NO puede pivotear a la infra de deploy.

---

## Orden de rotación

### 1. Base de datos — lo más grave (borrado irreversible)
Supabase Free no tiene respaldo propio ni point-in-time recovery: tu única red
es el respaldo del propio mini. Si el ladrón hace `DROP`, se restaura desde la
copia (ver `README.md` → restaurar).
- **Rotar la contraseña de `postgres`:** panel de Supabase → Project Settings →
  Database → *Reset database password*. Eso invalida el `PGURL` robado.
- **Regenerar el `service_role`:** Project Settings → API → *Reset service_role
  JWT*. OJO: esto también rota la llave que usa la app en Vercel → hay que pegar
  la nueva en las env vars de Vercel (prod) o la app deja de escribir.

### 2. Cloudflare R2 — para que no borren los respaldos
- Panel de Cloudflare → R2 → *Manage API tokens* → **revocar** el token del mini
  y crear uno nuevo.
- Revisa el bucket: si el versioning ya está activo (ver plan Tanda 2), un
  borrado es recuperable; si no, verifica que los respaldos sigan ahí.

### 3. Resend — para que no manden phishing desde tu dominio
- Panel de Resend → API Keys → revocar la llave del mini, crear otra.

### 4. Poner las llaves nuevas donde correspondan
- En el mini (si se recuperó o en uno nuevo): editar `~/.massdte-respaldo/config`
  con las llaves nuevas, `chmod 600`.
- En Vercel: solo el `service_role` nuevo (la app no usa las otras del mini).
- Correr un respaldo a mano para confirmar que todo quedó bien:
  `~/.massdte-respaldo/respaldar.sh --ahora`

### 5. Encontrar / borrar el mini
- iCloud → Find My → ubicar el mini → *Borrar este dispositivo* si no se
  recupera. No protege el disco frío (ya sacaron el SSD), pero cierra el equipo.

---

## Cómo se detecta que pasó
El respaldo late a healthchecks.io al terminar (ver Tanda 1). Si el mini se
apaga, el latido no llega y healthchecks avisa por AUSENCIA. Además el vigilante
de la app (cron de Vercel) alerta si el respaldo en R2 tiene más de 48h. Un
silencio de esos dos = revisar el mini.

---

*Este runbook no reemplaza asesoría legal: una filtración de datos personales de
terceros puede ser un incidente notificable bajo la Ley 21.719 (vigente
dic-2026). Ver `.compliance/`.*
