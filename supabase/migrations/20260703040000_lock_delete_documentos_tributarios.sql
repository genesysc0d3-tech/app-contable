-- Cierra el borrado cliente de DTE emitidos (auditoría #3). El schema base
-- (20260410) crea sobre documentos_tributarios una policy `FOR ALL USING (empresa
-- match)` que INCLUYE DELETE → un usuario logueado podía borrar su propio DTE
-- emitido con la anon key, saltando el flujo (no hay Nota de Crédito; los errores
-- van a soporte). Se reemplaza por policies por-comando SELECT/INSERT/UPDATE, SIN
-- DELETE. Los borrados legítimos (si alguna vez hacen falta) van por service-role,
-- que no pasa por RLS. La tabla hoy no la escribe el cliente (los DTE reales van a
-- boletas_emitidas, que ya es solo-SELECT), así que apretar esto no rompe features.

alter table public.documentos_tributarios enable row level security;

drop policy if exists "row level via usuarios" on public.documentos_tributarios;

create policy "dt select propia empresa" on public.documentos_tributarios
  for select using (
    empresa_id in (select empresa_id from public.usuarios where id = auth.uid())
  );

create policy "dt insert propia empresa" on public.documentos_tributarios
  for insert with check (
    empresa_id in (select empresa_id from public.usuarios where id = auth.uid())
  );

create policy "dt update propia empresa" on public.documentos_tributarios
  for update using (
    empresa_id in (select empresa_id from public.usuarios where id = auth.uid())
  ) with check (
    empresa_id in (select empresa_id from public.usuarios where id = auth.uid())
  );

-- A propósito SIN policy `for delete` → el DELETE cliente queda denegado por RLS.
