-- Fase 3 del clasificador, privacidad: el NOMBRE de una regla aprendida ya no lleva al
-- tercero. Antes: "Auto: JUAN PEREZ → Exenta" (y "Backfill: …" de scripts viejos).
-- Ahora: "Contraparte aprendida · Exenta/Afecta". El patrón (con el que calza) no se
-- toca; "Lo que aprendí" muestra la contraparte desde la evidencia viva (glosas de las
-- cartolas que la sostienen), no desde el nombre.
--
-- Solo UPDATE del nombre. clasificacion_reglas es SAGRADA: no se borra nada.
-- Sin respaldo de los nombres viejos A PROPÓSITO (guardarlos sería guardar al tercero):
-- el _DOWN los rearma desde el patrón.
-- Rollback: 20261005120100_reglas_nombre_sin_tercero_DOWN.sql

set lock_timeout = '5s';

update public.clasificacion_reglas
   set nombre = case
     when tipo_dte in (41, 34) then 'Contraparte aprendida · Exenta'
     when tipo_dte in (39, 33) then 'Contraparte aprendida · Afecta'
     else 'Contraparte aprendida'
   end
 where empresa_id is not null
   and (nombre like 'Auto:%' or nombre like 'Backfill:%');

reset lock_timeout;
