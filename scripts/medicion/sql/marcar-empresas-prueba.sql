-- Marca empresas.es_prueba = true en las empresas internas (decisión del fundador
-- 2026-10-04, estilo livemode de Stripe). NO va en la migración: se corre A MANO,
-- después de mirar la lista de verificar-instrumentacion.sql (sección 5) y de que el
-- fundador la confirme. Respaldo antes (regla de la casa). Idempotente.
--
-- Revertir: update public.empresas set es_prueba = false where id in (…mismos ids…);
begin;

update public.empresas e
   set es_prueba = true
 where not e.es_prueba
   and (
     e.id in ('5fe96a36-9f7e-408c-b315-2b55d534e1d1',   -- MV INVERSIONES (pruebas RPA)
              '7060be65-a566-469b-aea3-65457b55fe19')   -- EMPRESA DOS PRUEBA
     or e.id in (                                        -- cuenta interna genesys (copias de auditoría)
       select ce.empresa_id
       from public.cuenta_empresas ce
       join public.cuenta_usuarios cu on cu.cuenta_id = ce.cuenta_id
       join public.usuarios u on u.id = cu.usuario_id
       where lower(u.email) = 'genesysc0d3@gmail.com'
     )
   )
returning e.id;

-- Mirar el returning: si calza con la lista confirmada → commit; si no → rollback.
-- commit;
