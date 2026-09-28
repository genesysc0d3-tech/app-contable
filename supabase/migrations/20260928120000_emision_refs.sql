-- ID interno de emisión "R-XXX-XXX" (2026-09-28, plan-emision-confiable-2026-09-28-referencia.md).
--
-- Para la clienta y para nosotros (soporte, "para no perderse"): NO se imprime en la
-- boleta del SII ni en la personalizada. Uno por PROPUESTA (un reintento lleva el
-- mismo → dos boletas con el mismo ref = doble folio visible). Las boletas sin
-- propuesta (boleta única) reciben uno propio al insertarse.
--
-- Formato: "R-" + 5 caracteres al azar + 1 de control (Luhn mod 24), en dos grupos
-- de 3, alfabeto sin vocales ni confundibles: 23456789BCDFGHJKMNPRSTXZ.
-- El dígito de control es el mismo que valida src/lib/emission/ref-emision.ts.
-- Único por empresa (PK). Idempotente.

create table if not exists public.emision_refs (
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  ref text not null check (ref ~ '^R-[23456789BCDFGHJKMNPRSTXZ]{3}-[23456789BCDFGHJKMNPRSTXZ]{3}$'),
  -- Sin FK a propuestas_ia a propósito: la ref sobrevive si la propuesta o la cartola
  -- se borran (soporte la sigue encontrando). Copia mínima sin PII:
  propuesta_id uuid unique,
  -- Fecha de referencia: la del movimiento si la conoce quien la pide; el trigger de
  -- boletas guarda la fecha de emisión.
  fecha_mov date,
  monto numeric,
  tipo_dte integer,
  created_at timestamptz not null default now(),
  primary key (empresa_id, ref)
);

-- Solo service role (sin políticas): la app lee la ref desde boletas_emitidas / emision_jobs.
alter table public.emision_refs enable row level security;

alter table public.boletas_emitidas add column if not exists ref text;
alter table public.emision_jobs add column if not exists ref text;
create index if not exists idx_boletas_emitidas_empresa_ref on public.boletas_emitidas(empresa_id, ref);

-- Genera una ref nueva (con dígito de control) y la registra. Reintenta si choca.
create or replace function public.emision_ref_nueva(
  p_empresa_id uuid,
  p_propuesta_id uuid default null,
  p_fecha_mov date default null,
  p_monto numeric default null,
  p_tipo_dte integer default null
) returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  alfabeto constant text := '23456789BCDFGHJKMNPRSTXZ';
  n constant integer := 24;
  existente text;
  cuerpo text;
  factor integer;
  suma integer;
  addend integer;
  idx integer;
  i integer;
  control_idx integer;
  candidata text;
  intento integer := 0;
begin
  if p_propuesta_id is not null then
    select ref into existente from public.emision_refs where propuesta_id = p_propuesta_id and empresa_id = p_empresa_id;
    if existente is not null then
      return existente;
    end if;
  end if;

  loop
    intento := intento + 1;
    if intento > 20 then
      raise exception 'EMISION_REF_SIN_ESPACIO';
    end if;
    cuerpo := '';
    for i in 1..5 loop
      cuerpo := cuerpo || substr(alfabeto, 1 + floor(random() * n)::integer, 1);
    end loop;
    -- Luhn mod N: de derecha a izquierda, factor 2,1,2,1…
    factor := 2;
    suma := 0;
    for i in reverse 5..1 loop
      idx := strpos(alfabeto, substr(cuerpo, i, 1)) - 1;
      addend := factor * idx;
      addend := (addend / n) + (addend % n);
      suma := suma + addend;
      factor := case when factor = 2 then 1 else 2 end;
    end loop;
    control_idx := (n - (suma % n)) % n;
    candidata := 'R-' || substr(cuerpo, 1, 3) || '-' || substr(cuerpo, 4, 2) || substr(alfabeto, control_idx + 1, 1);
    begin
      insert into public.emision_refs (empresa_id, ref, propuesta_id, fecha_mov, monto, tipo_dte)
      values (p_empresa_id, candidata, p_propuesta_id, p_fecha_mov, p_monto, p_tipo_dte);
      return candidata;
    exception when unique_violation then
      -- Otra transacción registró la misma propuesta al mismo tiempo: usar la suya.
      if p_propuesta_id is not null then
        select ref into existente from public.emision_refs where propuesta_id = p_propuesta_id;
        if existente is not null then
          return existente;
        end if;
      end if;
      -- Si no, chocó la ref al azar: otra vuelta.
    end;
  end loop;
end;
$$;

revoke all on function public.emision_ref_nueva(uuid, uuid, date, numeric, integer) from public, anon, authenticated;

-- Toda boleta nueva lleva ref: la de su propuesta (misma que el job) o una propia.
create or replace function public.boletas_emitidas_asignar_ref()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- BLINDADO: la ref es un extra; JAMÁS puede impedir que se guarde una boleta real
  -- (folio emitido en el SII). Cualquier error → ref null + warning.
  if new.ref is null then
    begin
      new.ref := public.emision_ref_nueva(new.empresa_id, new.propuesta_id, new.fecha_emision, new.monto_total, new.tipo_dte);
    exception when others then
      new.ref := null;
      raise warning 'emision_ref_nueva: %', sqlerrm;
    end;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_boletas_emitidas_asignar_ref on public.boletas_emitidas;
create trigger trg_boletas_emitidas_asignar_ref
before insert on public.boletas_emitidas
for each row execute function public.boletas_emitidas_asignar_ref();
