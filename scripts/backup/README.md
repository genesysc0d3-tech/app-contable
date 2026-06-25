# Respaldo de base de datos MassDTE (Mac Mini)

Respaldo **cifrado** de la base Supabase, **cada 6 horas**, con **copia offsite**
y **aviso si falla**. Pensado para correr en la Mac Mini siempre encendida.

## Por qué lo montamos AHORA (con datos de prueba)

No es para proteger los datos de prueba (son desechables). Es para **probar que
el respaldo Y la restauración funcionan** mientras un error no cuesta nada. Esa
es la condición #4 (restore probado), la que todos se saltan. Cuando entre el
primer cliente real, esto ya estará probado.

## Las 4 condiciones (lo que lo hace respaldo de verdad, no un archivo)

1. **Copia offsite** (no solo en la Mac) → sube a R2.
2. **Cifrado** (tiene datos tributarios) → `gpg` AES-256.
3. **Aviso si falla** → healthchecks.io (y/o Telegram).
4. **Restore probado** → `restore-db.sh` + la prueba de la sección 4.

---

## 1. Requisitos en la Mac Mini

```bash
brew install postgresql@17 gnupg awscli
```

- `curl` ya viene en macOS.
- Activa **FileVault** (Ajustes → Privacidad y seguridad): la Mac guardará copias.

## 2. Configuración

```bash
mkdir -p ~/.massdte-backup
cp scripts/backup/config.env.example ~/.massdte-backup/config.env
chmod 600 ~/.massdte-backup/config.env
```

Edita `~/.massdte-backup/config.env`:

- **`BACKUP_PGURL`**: Supabase → Project Settings → Database → Connection string →
  **Direct connection** (URI), puerto **5432** (no el pooler 6543).
- **`BACKUP_PASSPHRASE`**: frase larga y aleatoria. **Guárdala también en tu gestor
  de contraseñas.** Si la pierdes, los respaldos no se pueden abrir.
- **R2 (offsite)**: bucket + endpoint + llaves (tu cuenta R2; bucket nuevo, p.ej.
  `massdte-backups`).
- **Alertas**: `BACKUP_HEALTHCHECK_URL` (recomendado) y/o Telegram.

> El script lee este archivo en cada corrida. El agente nunca lo lee y no se
> versiona: vive fuera del repo y con `chmod 600`.

## 3. Probar el respaldo (manual)

```bash
bash scripts/backup/backup-db.sh
tail -n 20 ~/massdte-backups/backup.log
```

Debe decir `backup OK` y aparecer un archivo `massdte-*.fc.gpg`.

## 4. PROBAR LA RESTAURACIÓN (obligatorio — es el punto de todo esto)

```bash
createdb massdte_restore_test
bash scripts/backup/restore-db.sh \
  ~/massdte-backups/massdte-XXXX.fc.gpg \
  "postgresql://localhost/massdte_restore_test"
```

Luego compara conteos de filas con la base original. Si restaura bien, tienes un
respaldo de verdad. Si no, lo arreglamos **ahora** que no cuesta nada.

## 5. Activar cada 6 horas (launchd)

1. Edita `cl.massdte.backup.plist`: reemplaza los `/REEMPLAZA/RUTA/...` por las
   rutas reales del repo y de `~/massdte-backups`.
2. Instala:
   ```bash
   cp scripts/backup/cl.massdte.backup.plist ~/Library/LaunchAgents/
   launchctl load ~/Library/LaunchAgents/cl.massdte.backup.plist
   ```
3. Corre una vez para confirmar:
   ```bash
   launchctl start cl.massdte.backup
   ```

Evita que la Mac duerma: Ajustes → Batería/Energía → "Evitar que se duerma".

## 6. Alertas: por qué healthchecks.io (no solo Telegram)

Telegram avisa si el script **corre** y falla. Pero si la Mac está apagada o el
job no dispara, no hay error que avisar. healthchecks.io es un **interruptor de
hombre muerto**: espera un ping cada 6h; si **no** llega, te avisa. Eso atrapa el
fallo silencioso. El free tier alcanza. Telegram queda como extra.

## 7. Endurecer antes de clientes reales: rol de solo-lectura

Para no respaldar con el rol nuclear, crea un rol de solo lectura (Supabase →
SQL editor) y usa su connection string en `BACKUP_PGURL`:

```sql
create role massdte_backup login password 'CAMBIA_ESTO';
grant connect on database postgres to massdte_backup;
grant usage on schema public to massdte_backup;
grant select on all tables in schema public to massdte_backup;
grant select on all sequences in schema public to massdte_backup;
alter default privileges in schema public grant select on tables to massdte_backup;
```

(Para la v1 de prueba puedes usar tu conexión actual; cambia al rol antes de
clientes reales.)

## Troubleshooting

- `pg_dump: server version mismatch`: usa pg_dump 17 (`brew install
  postgresql@17`) o define `BACKUP_PG_BIN` en el config.
- launchd "command not found": es el PATH; el script ya lo fija al inicio, pero si
  moviste Homebrew, ajústalo ahí.
- pg_dump se queja de permisos/extensiones en Supabase: el `--no-owner
  --no-privileges` ya está; alternativa: `supabase db dump`.

## Checklist

- [ ] postgresql@17 + gnupg + awscli instalados
- [ ] `config.env` lleno y `chmod 600`
- [ ] passphrase guardada en gestor de contraseñas
- [ ] backup manual OK
- [ ] **restore de prueba OK**  ← el importante
- [ ] R2 recibiendo la copia offsite
- [ ] healthchecks.io configurado
- [ ] launchd activo cada 6h
- [ ] FileVault activado
- [ ] (antes de clientes) rol read-only
