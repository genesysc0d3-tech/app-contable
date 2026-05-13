-- Crear policies para storage
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('documentos', 'documentos', true, 52428800, NULL)
ON CONFLICT (id) DO UPDATE SET public = true;

CREATE POLICY "upload_documentos" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'documentos');

CREATE POLICY "select_documentos" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'documentos');
