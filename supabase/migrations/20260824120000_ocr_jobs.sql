-- Cola de OCR para el worker del Mac mini.
--
-- Por qué existe: hoy el OCR de imágenes viaja a un proveedor remoto (OpenCode),
-- lo que (a) manda la foto COMPLETA con el RUT del tercero fuera del país y (b)
-- depende de un gateway que corta conexiones. El mini corre Vision de Apple en
-- local: la imagen no sale de la casa y el OCR es de ~126 ms.
--
-- El mini NO expone ningún puerto. Se conecta HACIA AFUERA a esta base, escucha
-- el canal `ocr_job_pendiente` (LISTEN/NOTIFY) y saca el trabajo apenas entra —
-- sin polling lento y sin superficie a internet. Si el mini está caído, el job
-- queda en la cola y lo recupera al reconectar (o el pipeline cae a un respaldo).
--
-- Esta tabla guarda solo metadata operacional + el TEXTO extraído. No guarda la
-- imagen (vive en R2/Storage), ni prompts, ni secretos. El texto extraído puede
-- contener identidad de terceros: se trata como el resto del OCR (seudonimizado
-- antes de ir a la IA de clasificación, caduca con el documento).

create table if not exists public.ocr_jobs (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  documento_id uuid references public.documentos_subidos(id) on delete cascade,
  -- Dónde está la imagen a leer. El worker la baja por una URL firmada de vida
  -- corta que deja el encolador en metadata.image_url (así el mini NO necesita
  -- credenciales de R2/Storage), o por storage_path si algún día se le dan.
  storage_path text not null,
  storage_provider text not null default 'r2',
  estado text not null default 'pendiente'
    check (estado in ('pendiente', 'procesando', 'listo', 'error')),
  -- Resultado del OCR: { text, lines[], confianza, ms, por_imagen[] }.
  resultado jsonb,
  intentos integer not null default 0 check (intentos >= 0),
  max_intentos integer not null default 3 check (max_intentos between 1 and 10),
  last_error text,
  -- Para FOR UPDATE SKIP LOCKED entre varios workers (o reintentos): quién lo
  -- tomó y cuándo. Un job 'procesando' con locked_at viejo se puede recuperar.
  locked_at timestamptz,
  locked_by text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_ocr_jobs_pendiente
  on public.ocr_jobs (created_at)
  where estado = 'pendiente';

create index if not exists idx_ocr_jobs_documento
  on public.ocr_jobs (documento_id, created_at desc);

-- Recuperación: jobs 'procesando' que quedaron colgados (mini murió a mitad).
create index if not exists idx_ocr_jobs_colgado
  on public.ocr_jobs (locked_at)
  where estado = 'procesando';

-- NOTIFY al insertar un job pendiente → el mini despierta al instante, sin
-- polling. El payload es el id; el worker hace el SELECT ... FOR UPDATE.
create or replace function public.notificar_ocr_job() returns trigger
  language plpgsql as $$
begin
  if new.estado = 'pendiente' then
    perform pg_notify('ocr_job_pendiente', new.id::text);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_notificar_ocr_job on public.ocr_jobs;
create trigger trg_notificar_ocr_job
  after insert on public.ocr_jobs
  for each row execute function public.notificar_ocr_job();

-- Solo el service role (webhook/pipeline) y el worker (con la connection string
-- de servicio) tocan esta tabla. Sin políticas = nadie más entra.
alter table public.ocr_jobs enable row level security;
