-- Rate-limit GLOBAL (auditoría interna #6b).
--
-- El limiter en memoria vive por-instancia serverless: N requests paralelos
-- reparten el contador entre N instancias y el "20/min" se multiplica a
-- voluntad. Este bucket vive en Postgres y lo comparten todas las instancias.
-- Solo lo llama el service role (la función queda revocada para el resto).
--
-- APLICAR A PROD con el ritual: respaldo previo. Cambio ADITIVO (tabla nueva
-- + función nueva; cero filas existentes tocadas).
--
-- _DOWN:
--   drop function if exists public.rate_limit_hit(text, int, int);
--   drop table if exists public.rate_limit_buckets;
--   (solo pierde contadores efímeros de ventana; ningún dato de negocio)

create table if not exists public.rate_limit_buckets (
  key text primary key,
  count integer not null,
  reset_at timestamptz not null
);

alter table public.rate_limit_buckets enable row level security;

create index if not exists idx_rate_limit_buckets_reset on public.rate_limit_buckets(reset_at);

create or replace function public.rate_limit_hit(p_key text, p_limit integer, p_window_ms integer)
returns table (allowed boolean, retry_after_seconds integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := now();
  v_count integer;
  v_reset timestamptz;
begin
  insert into public.rate_limit_buckets as b (key, count, reset_at)
  values (p_key, 1, v_now + make_interval(secs => p_window_ms / 1000.0))
  on conflict (key) do update set
    count = case when b.reset_at <= v_now then 1 else b.count + 1 end,
    reset_at = case when b.reset_at <= v_now then v_now + make_interval(secs => p_window_ms / 1000.0) else b.reset_at end
  returning b.count, b.reset_at into v_count, v_reset;

  -- Limpieza oportunista de ventanas muertas (barata a este volumen).
  if random() < 0.01 then
    delete from public.rate_limit_buckets where reset_at < v_now - interval '1 day';
  end if;

  return query select
    v_count <= p_limit,
    greatest(1, ceil(extract(epoch from (v_reset - v_now))))::integer;
end;
$$;

revoke all on function public.rate_limit_hit(text, integer, integer) from public;
revoke all on function public.rate_limit_hit(text, integer, integer) from anon;
revoke all on function public.rate_limit_hit(text, integer, integer) from authenticated;
grant execute on function public.rate_limit_hit(text, integer, integer) to service_role;
