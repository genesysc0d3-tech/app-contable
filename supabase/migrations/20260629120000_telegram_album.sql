-- F0: álbum de Telegram = 1 venta. Las fotos de un álbum llegan en webhooks
-- separados (mismo media_group_id). Se agrupan en UN documento.
--
-- media_group_id en el documento + único por empresa → exactamente UN "creador"
-- gana el insert; las hermanas caen en conflicto y solo dejan su imagen en el
-- buffer. El creador, tras un debounce, junta el buffer y encola UN job
-- multi-imagen (grouped_images, que la cola ya sabe procesar).
ALTER TABLE public.documentos_subidos ADD COLUMN IF NOT EXISTS media_group_id text;

CREATE UNIQUE INDEX IF NOT EXISTS uq_documentos_media_group
  ON public.documentos_subidos (empresa_id, media_group_id)
  WHERE media_group_id IS NOT NULL;

-- Buffer de imágenes de un álbum mientras llegan las fotos (cada foto = un INSERT,
-- sin carreras). El creador las junta y vacía el buffer.
CREATE TABLE IF NOT EXISTS public.telegram_album_buffer (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  media_group_id text NOT NULL,
  image jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_album_buffer_group
  ON public.telegram_album_buffer (empresa_id, media_group_id);

-- Solo el service role la usa (el webhook). RLS on, sin policy pública.
ALTER TABLE public.telegram_album_buffer ENABLE ROW LEVEL SECURITY;
