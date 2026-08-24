-- `empresa_id` pasa a ser opcional en la cola de OCR.
--
-- El OCR es una operación de "imagen → texto" que no necesita saber de qué
-- empresa es: el punto de entrada (`ocrImage`) recibe solo los bytes. Forzar la
-- empresa obligaba a arrastrar el dato por firmas que no lo tienen, sin ganar
-- nada. Donde SÍ se conoce (el pipeline de cartolas/Telegram) se sigue
-- guardando, que sirve para auditoría y limpieza.
alter table public.ocr_jobs alter column empresa_id drop not null;
