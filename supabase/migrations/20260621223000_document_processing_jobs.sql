-- Cola durable para procesamiento OCR/IA/documentos.
-- Esta tabla guarda solo metadata operacional. No guardar contenido crudo,
-- OCR completo, prompts/respuestas IA, PDFs/XML/base64 ni secretos.

create table if not exists public.document_processing_jobs (
  id uuid primary key default gen_random_uuid(),
  documento_id uuid not null references public.documentos_subidos(id) on delete cascade,
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  usuario_id uuid references public.usuarios(id) on delete set null,
  tipo text not null,
  storage_path text not null,
  status text not null default 'queued'
    check (status in ('queued', 'running', 'retryable', 'completed', 'failed', 'cancelled')),
  attempts integer not null default 0 check (attempts >= 0),
  max_attempts integer not null default 3 check (max_attempts between 1 and 10),
  idempotency_key text not null unique,
  pipeline_version text not null default 'document-processing:v1',
  last_error text,
  locked_at timestamptz,
  locked_by text,
  next_run_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_document_processing_jobs_status_next_run
  on public.document_processing_jobs(status, next_run_at, created_at);

create index if not exists idx_document_processing_jobs_documento
  on public.document_processing_jobs(documento_id, created_at desc);

create index if not exists idx_document_processing_jobs_empresa_status
  on public.document_processing_jobs(empresa_id, status, created_at desc);

create index if not exists idx_document_processing_jobs_locked
  on public.document_processing_jobs(status, locked_at)
  where status = 'running';

alter table public.document_processing_jobs enable row level security;
