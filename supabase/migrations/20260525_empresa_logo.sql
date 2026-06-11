alter table public.empresas
  add column if not exists logo_storage_path text,
  add column if not exists logo_mime_type text;

-- Ensure storage bucket exists for document/logos uploads
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('documentos', 'documentos', false, 52428800, null)
on conflict (id) do nothing;

-- Refresh Supabase/PostgREST schema cache after adding columns.
select pg_notify('pgrst', 'reload schema');
