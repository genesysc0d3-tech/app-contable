-- Minimización histórica del receptor bajo umbral (Ley 19.628).
--
-- Espeja la regla de emisión: bajo 135 UF el receptor es OPCIONAL (Res. Ex. SII
-- 44/2025), así que la identidad del tercero auto-extraída de la glosa no se
-- conserva. El contador (ex-SII) confirmó que no hay necesidad tributaria de
-- guardarla bajo umbral: IVA/F29, RCV (boletas van resumidas, no nominadas) y
-- Renta/F22 dependen de monto+fecha+folio, no de quién transfirió. De aquí en
-- adelante el processor ya no la guarda (gate por monto); esto limpia lo previo.
--
-- Cutoff CONSERVADOR = referencia 135 UF * 40.611 = 5.482.485. La UF real solo
-- sube, así que el umbral real ≥ este monto → todo lo que tocamos está
-- DEFINITIVAMENTE bajo el umbral real (jamás borramos algo que la ley exigía
-- identificar). Solo se anulan columnas de texto (sin FK). Monto/fecha/folio y
-- los clientes registrados quedan intactos.

UPDATE public.propuestas_ia
SET receptor_nombre = NULL,
    receptor_rut = NULL
WHERE total <= 5482485
  AND (receptor_nombre IS NOT NULL OR receptor_rut IS NOT NULL);

-- La glosa/notas también se imprime en la boleta (máxima precedencia en
-- resolverGlosa). De aquí en adelante el processor descarta la nota generada por
-- la IA bajo umbral; esto limpia lo previo cuando la nota trae un RUT de tercero
-- (patrón alto-confianza). Nombres sin RUT no se detectan en SQL — el gate
-- forward cubre lo nuevo y esto es data de prueba pre-beta.
UPDATE public.propuestas_ia
SET notas = NULL
WHERE total <= 5482485
  AND notas ~ '[0-9]{1,2}\.?[0-9]{3}\.?[0-9]{3}-[0-9kK]';

-- cliente_id enlaza al tercero: aunque el receptor esté en null, la emisión lo
-- resucita vía `p.receptor_rut ?? cliente?.rut`. Se desvincula bajo umbral (el
-- cliente en sí queda intacto en la tabla `clientes`; solo se corta el enlace que
-- reintroduciría su identidad en la boleta).
UPDATE public.propuestas_ia
SET cliente_id = NULL
WHERE total <= 5482485
  AND cliente_id IS NOT NULL;
