-- Revierte 20261005120100_reglas_nombre_sin_tercero.sql: rearma "Auto: NOMBRE → Tipo"
-- desde el PATRÓN (regexContraparte de src/lib/ai/aprender-regla.ts):
--   (^|[^a-zà-ÿ])juan perez([^a-zà-ÿ]|$)  →  "Auto: JUAN PEREZ → Exenta"
-- Un patrón de otra forma (contains viejo) se usa tal cual, en mayúsculas.
-- No toca las huérfanas (patrón centinela "(?!)…": su tercero ya no existe) ni las
-- reglas con otro nombre. Las de "Backfill:" vuelven como "Auto:" (el prefijo no se
-- guardó, a propósito). Solo UPDATE del nombre: no borra filas.

set lock_timeout = '5s';

update public.clasificacion_reglas
   set nombre = 'Auto: ' || upper(
         case
           when left(patron, 13) = '(^|[^a-zà-ÿ])' and right(patron, 13) = '([^a-zà-ÿ]|$)' and char_length(patron) > 26
             then substr(patron, 14, char_length(patron) - 26)
           else patron
         end)
       || case
            when tipo_dte in (41, 34) then ' → Exenta'
            when tipo_dte in (39, 33) then ' → Afecta'
            else ''
          end
 where empresa_id is not null
   and nombre in ('Contraparte aprendida · Exenta', 'Contraparte aprendida · Afecta', 'Contraparte aprendida')
   and patron not like '(?!)%';

reset lock_timeout;
