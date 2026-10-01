-- Mapas de columnas PROVISORIOS vs CONFIRMADOS (lector con juez, 2026-09-30).
--
-- Diagnóstico en prod: 44 mapas heurísticos se reusaban con confianza 1.0 sin
-- que nadie los hubiera confirmado (aprendíamos nuestra propia adivinanza).
-- Desde ahora un mapa derivado (heurística / nombres / IA de estructura) nace
-- 'provisorio' y solo pasa a 'confirmado' con PRUEBA: saldo corrido, total
-- impreso por el banco, el cliente ("Se ve bien" o su saldo final cuadró) o el
-- cliente aprobando en Check lo que el mapa leyó sin editarlo. Un provisorio no
-- se comparte entre empresas.
--
-- El código es fail-safe: sin estas columnas trata todo como provisorio.
-- SOLO ESCRITA — no aplicada. Respaldar parser_adapters antes de aplicarla.

alter table public.parser_adapters
  add column if not exists estado text not null default 'provisorio',
  add column if not exists confirmado_por text,
  add column if not exists confirmado_en timestamptz;

alter table public.parser_adapters
  drop constraint if exists parser_adapters_estado_check;
alter table public.parser_adapters
  add constraint parser_adapters_estado_check
  check (estado in ('provisorio', 'confirmado'));

alter table public.parser_adapters
  drop constraint if exists parser_adapters_confirmado_por_check;
alter table public.parser_adapters
  add constraint parser_adapters_confirmado_por_check
  check (confirmado_por is null or confirmado_por in ('saldo', 'total_banco', 'cliente', 'check', 'manual', 'plantilla', 'consenso'));

comment on column public.parser_adapters.estado is
  'provisorio = derivado sin prueba (no se comparte entre empresas, no sube confianza por reuso); confirmado = probado por saldo/total del banco o confirmado por el cliente.';
comment on column public.parser_adapters.confirmado_por is
  'Qué lo confirmó: saldo | total_banco | cliente | check | manual | plantilla | consenso (global: 2+ dueños y cuentas bancarias distintas lo probaron por saldo/total del banco).';

-- Backfill. Solo lo que SABEMOS que fue confirmado por una persona o es nuestro:
--   * manual (el cliente mapeó a mano)            → confirmado / manual
--   * plantilla massDTE (config.plantilla = true)  → confirmado / plantilla
-- Todo lo demás (heurísticos/nombres, incluidos los globales viejos: no hay forma
-- de saber cuáles cuadraron por saldo al nacer) queda provisorio con confianza
-- bajo la de un manual.
--
-- QUÉ PASA CON LAS CLIENTAS EL PRIMER DÍA (revisión adversarial 2026-09-30, M3):
-- un global provisorio NO se usa para ninguna empresa (el código solo comparte
-- globales confirmados) y NO se re-confirma solo (nunca vuelve a pasar por el
-- caché): queda muerto en la tabla, sin borrarse. Cada clienta sin mapa propio
-- re-deriva su formato con la heurística actual en su próxima subida (la misma
-- lectura determinística, milisegundos) y ese mapa queda como SUYO: confirmado
-- si el saldo cierra al peso o el banco calza, provisorio si no. Un global nuevo
-- solo nace por CONSENSO de pruebas OBJETIVAS (saldo al peso o total del banco;
-- nunca "cliente"/"check") de 2+ empresas con DUEÑOS distintos y cuentas
-- bancarias distintas (revisión adversarial vuelta 2, N1). Los manuales ya eran
-- de su empresa y quedan confirmados.
update public.parser_adapters
   set estado = 'confirmado', confirmado_por = 'manual', confirmado_en = now()
 where source = 'manual' and estado = 'provisorio';

update public.parser_adapters
   set estado = 'confirmado', confirmado_por = 'plantilla', confirmado_en = now()
 where estado = 'provisorio' and (config ->> 'plantilla') = 'true';

update public.parser_adapters
   set confianza = least(confianza, 0.7)
 where estado = 'provisorio';

create index if not exists idx_parser_adapters_empresa_estado
  on public.parser_adapters (creado_por_empresa_id, estado);
