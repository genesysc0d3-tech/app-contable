-- `computa_cupo`: si un documento emitido DESCUENTA de la cuota del plan.
-- Se SELLA al emitir y nunca se recalcula al leer.
--
-- Regla del fundador (2026-09-06): la factura ÚNICA digitada a mano en la app
-- es ilimitada, igual que la boleta única; solo lo que sale de cartola (masivo)
-- descuenta. Hasta hoy pasaba AL REVÉS: la factura única crea una propuesta
-- (`fuente_clasificacion = 'factura_unica'`) y la emisión la enlaza por
-- `propuesta_id`, que es justo lo que `contarMasivas` cuenta. Cobro en contra
-- del cliente, y la página de planes prometiendo "únicas ilimitadas".
--
-- Por qué una COLUMNA SELLADA y no "excluir al contar": si se recalcula al
-- leer, cualquier cambio futuro de la regla (o revocar un token del conector,
-- cuando llegue el cobro por canal) reescribe la cuota de un mes ya cerrado.
-- Sellar al emitir deja cada fila con la verdad de su momento.
--
-- Por qué un TRIGGER y no cada ruta: en boletas_emitidas insertan al menos
-- cinco caminos (lote mock, sii-local/result, simpleapi/result, reconcile,
-- folio-reservas). Poner la regla en uno y olvidar otro es exactamente cómo
-- nació este bug. El trigger la aplica a TODOS, incluidos los que no existen
-- todavía. `propuesta_id` NO se vacía: lo necesita la protección de doble folio.
--
-- Retroactividad: default TRUE. Nada de lo ya emitido cambia de cuenta por
-- esta migración (lo masivo ya contaba; y hoy no hay facturas únicas emitidas
-- en producción — verificado antes de aplicar).

alter table public.boletas_emitidas
  add column if not exists computa_cupo boolean not null default true;

comment on column public.boletas_emitidas.computa_cupo is
  'Sellado al emitir por trg_sellar_computa_cupo: TRUE = descuenta de la cuota (salió de cartola); FALSE = única digitada a mano (boleta sin propuesta o factura_unica). Nunca recalcular al leer.';

create or replace function public.sellar_computa_cupo()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.propuesta_id is null then
    -- Boleta única / directa: nunca contó, sigue sin contar.
    new.computa_cupo := false;
  elsif exists (
    select 1 from public.propuestas_ia p
    where p.id = new.propuesta_id and p.fuente_clasificacion = 'factura_unica'
  ) then
    -- Factura única digitada en la app: ilimitada (regla del fundador).
    new.computa_cupo := false;
  else
    new.computa_cupo := true;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_sellar_computa_cupo on public.boletas_emitidas;
create trigger trg_sellar_computa_cupo
  before insert on public.boletas_emitidas
  for each row execute function public.sellar_computa_cupo();

-- El conteo consulta por empresa + fecha + este flag; a este volumen no hace
-- falta índice propio (el parcial existente por empresa/created_at alcanza).
