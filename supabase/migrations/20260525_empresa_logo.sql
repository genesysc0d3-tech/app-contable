alter table public.empresas
  add column if not exists logo_storage_path text,
  add column if not exists logo_mime_type text;
