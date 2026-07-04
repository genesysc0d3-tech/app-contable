-- Galería del álbum de Telegram: hoy las N imágenes del álbum solo viven en
-- document_processing_jobs.metadata.grouped_images (tabla interna, efímera). Para que
-- el visor/editor del escritorio muestre las 3-4 fotos (zoom + flechas), se persiste el
-- arreglo [{path, mime, name}] en el propio documento (columna estable que el pipeline
-- NO reescribe, a diferencia de progreso_ia). Foto suelta = null (1 imagen, como hoy).
ALTER TABLE public.documentos_subidos ADD COLUMN IF NOT EXISTS album_imagenes jsonb;
