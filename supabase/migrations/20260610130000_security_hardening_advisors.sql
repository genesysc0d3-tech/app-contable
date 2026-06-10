-- Hardening según security advisors (aplicado vía Management API 2026-06-10).
-- 1. consume_next_folio y rls_auto_enable son SECURITY DEFINER y solo las
--    invoca el backend con service role; no deben ser ejecutables por clientes.
REVOKE EXECUTE ON FUNCTION public.consume_next_folio FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.rls_auto_enable FROM anon, authenticated;

-- 2. parser_logs y audit_chunks solo se insertan desde el servidor (service
--    role bypasea RLS); las policies "todos pueden insert" con CHECK (true)
--    dejaban a cualquier cliente escribir filas arbitrarias.
DROP POLICY IF EXISTS "todos pueden insert audit_chunks" ON public.audit_chunks;
DROP POLICY IF EXISTS "todos pueden insert parser_logs" ON public.parser_logs;
