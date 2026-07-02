-- Retención de artefactos de debug con PII (auditoría #11, Ley 21.719 — limitación
-- de conservación). audit_chunks guarda texto CRUDO de cartolas (RUTs, nombres,
-- montos) y parser_logs diagnósticos estructurales. Son artefactos de depuración,
-- no registros de negocio: se purgan a 30 días vía /api/audit/cron (Vercel Cron).
-- El purge corre sobre created_at; estos índices lo hacen barato.

create index if not exists idx_audit_chunks_created_at
  on public.audit_chunks (created_at);

create index if not exists idx_parser_logs_created_at
  on public.parser_logs (created_at);

comment on table public.audit_chunks is
  'Debug/auditoría de chunks IA. Contiene texto crudo (PII). Retención 30 días vía /api/audit/cron (Ley 21.719, limitación de conservación).';
