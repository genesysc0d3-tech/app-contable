-- Semilla SINTÉTICA para ensayar medir-clasificador.mjs en el Postgres local
-- desechable (probar-migracion-local.sh). Nada real: empresas y glosas inventadas.
-- 2 empresas reales (A grande, B chica) + 1 es_prueba (que la medición debe ignorar).
insert into public.empresas (id, razon_social, es_prueba) values
  ('00000000-0000-4000-8000-00000000000a', 'EMPRESA A', false),
  ('00000000-0000-4000-8000-00000000000b', 'EMPRESA B', false),
  ('00000000-0000-4000-8000-00000000000c', 'EMPRESA PRUEBA', true);
insert into public.documentos_subidos (id, empresa_id, estado) values
  ('00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-00000000000a', 'procesado'),
  ('00000000-0000-4000-8000-0000000000b1', '00000000-0000-4000-8000-00000000000b', 'procesado'),
  ('00000000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-00000000000c', 'procesado');

-- 120 abonos en A, 12 en B, 50 en la de prueba.
insert into public.movimientos_raw (empresa_id, documento_id, descripcion, monto, tipo_flujo)
select e, d, 'ABONO ' || g, 1000 + g, 'entrada'
from (values ('00000000-0000-4000-8000-00000000000a'::uuid, '00000000-0000-4000-8000-0000000000a1'::uuid, 120),
             ('00000000-0000-4000-8000-00000000000b'::uuid, '00000000-0000-4000-8000-0000000000b1'::uuid, 12),
             ('00000000-0000-4000-8000-00000000000c'::uuid, '00000000-0000-4000-8000-0000000000c1'::uuid, 50)) v(e, d, k),
     generate_series(1, v.k) g;

insert into public.propuestas_ia (empresa_id, movimiento_id, tipo_propuesto, tipo_dte, confianza, total, fuente_clasificacion, estado, orig_tipo_dte_fuente)
select m.empresa_id, m.id, 'exenta',
       case when r % 3 = 0 then null else 41 end,
       case when r % 4 = 0 then 0.6 when r % 4 = 1 then 0.8 else 0.95 end,
       m.monto,
       case when r % 2 = 0 then 'regla' else 'ia_opencode' end,
       'pendiente',
       case when r % 2 = 0 then 'regla' else 'auto_glosa_exenta' end
from (select m.*, row_number() over (partition by m.empresa_id order by m.descripcion) r from public.movimientos_raw m) m;

-- Gestos con sello: A mira 30 filas (10 las corrige a 39), aprueba el resto en lote; B aprueba todo en lote.
update public.propuestas_ia p set estado = 'listo', decision_canal = 'check_detalle', decision_lote = gen_random_uuid(),
       decision_lote_n = 1, decision_abierta = true
 where p.empresa_id = '00000000-0000-4000-8000-00000000000a'
   and p.movimiento_id in (select id from public.movimientos_raw where empresa_id = p.empresa_id order by descripcion limit 30);
update public.propuestas_ia p set tipo_dte = 39, estado = 'editado', decision_canal = 'check_detalle', decision_lote = gen_random_uuid(),
       decision_lote_n = 1, decision_abierta = true
 where p.empresa_id = '00000000-0000-4000-8000-00000000000a'
   and p.movimiento_id in (select id from public.movimientos_raw where empresa_id = p.empresa_id order by descripcion limit 10);
update public.propuestas_ia set estado = 'rechazado', decision_canal = 'check_lote', decision_lote = gen_random_uuid(), decision_lote_n = 8, decision_abierta = false
 where empresa_id = '00000000-0000-4000-8000-00000000000a'
   and movimiento_id in (select id from public.movimientos_raw where empresa_id = '00000000-0000-4000-8000-00000000000a' order by descripcion desc limit 8);
update public.propuestas_ia set estado = 'aprobado', decision_canal = 'aprobar_cartola', decision_lote = gen_random_uuid(), decision_lote_n = 200, decision_abierta = false
 where estado in ('pendiente', 'listo', 'editado');
