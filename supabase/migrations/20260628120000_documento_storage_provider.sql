-- Capa de storage (S0): archivos → Cloudflare R2, datos → Supabase.
-- Marca dónde vive el archivo de cada documento. Lo existente queda 'supabase';
-- las subidas nuevas serán 'r2'. `storage_path` pasa a ser la key en ese proveedor.
-- Aditivo + default → no cambia comportamiento (ADD COLUMN con default es
-- metadata-only en PG, sin reescribir la tabla).
ALTER TABLE public.documentos_subidos
  ADD COLUMN IF NOT EXISTS storage_provider text NOT NULL DEFAULT 'supabase';

COMMENT ON COLUMN public.documentos_subidos.storage_provider IS
  'Dónde vive el archivo: supabase (Storage legacy) | r2 (Cloudflare R2). storage_path es la key en ese proveedor.';
