-- Rollback de 20260925120000_regla_transf_sin_preposicion.sql.
-- Lo que destruye: la regla global 119 "Transferencia recibida (sin preposición)".
-- Las propuestas ya creadas con ella NO se tocan (quedan con su regla_id huérfano,
-- como cualquier regla borrada).
DELETE FROM public.clasificacion_reglas
WHERE nombre = 'Transferencia recibida (sin preposición)' AND empresa_id IS NULL;
