-- VUELTA ATRÁS de 20260830160000_rls_por_cuenta_pagadora.sql
--
-- NO se aplica: existe para que revertir sea copiar un archivo y no improvisar
-- a las 3 de la mañana. Devuelve las 17 policies a colgar de
-- `usuarios.empresa_id` — con la fuga que eso implica, que es justo lo que se
-- vino a cerrar. Usar solo si el cambio rompió algo peor.
--
-- Esta migración NO tocó datos (a diferencia del plan v1, que insertaba filas),
-- así que volver es solo restaurar expresiones.
alter policy "row level via usuarios" on public.clasificacion_reglas using (empresa_id in (select empresa_id from public.usuarios where id = auth.uid()));
alter policy "row level via usuarios" on public.clientes            using (empresa_id in (select empresa_id from public.usuarios where id = auth.uid()));
alter policy "row level via usuarios" on public.creditos_uso        using (empresa_id in (select empresa_id from public.usuarios where id = auth.uid()));
alter policy "row level via usuarios" on public.documentos_subidos  using (empresa_id in (select empresa_id from public.usuarios where id = auth.uid()));
alter policy "row level via usuarios" on public.gastos              using (empresa_id in (select empresa_id from public.usuarios where id = auth.uid()));
alter policy "row level via usuarios" on public.ia_uso              using (empresa_id in (select empresa_id from public.usuarios where id = auth.uid()));
alter policy "row level via usuarios" on public.movimientos_raw     using (empresa_id in (select empresa_id from public.usuarios where id = auth.uid()));
alter policy "row level via usuarios" on public.periodos_contables  using (empresa_id in (select empresa_id from public.usuarios where id = auth.uid()));
alter policy "row level via usuarios" on public.propuestas_ia       using (empresa_id in (select empresa_id from public.usuarios where id = auth.uid()));
alter policy "row level via usuarios" on public.proveedores         using (empresa_id in (select empresa_id from public.usuarios where id = auth.uid()));
alter policy "users see own empresa caf" on public.boletas_caf_mock using (empresa_id in (select empresa_id from public.usuarios where id = auth.uid()));
alter policy "users see own empresa boletas" on public.boletas_emitidas using (empresa_id in (select empresa_id from public.usuarios where id = auth.uid()));
alter policy "miembros leen empresa invitaciones" on public.empresa_invitaciones using (empresa_id in (select empresa_id from public.usuarios where id = auth.uid()));
alter policy "empresas: miembros leen su empresa" on public.empresas using (id in (select empresa_id from public.usuarios where id = auth.uid()));
alter policy "dt select propia empresa" on public.documentos_tributarios using (empresa_id in (select empresa_id from public.usuarios where id = auth.uid()));
alter policy "dt insert propia empresa" on public.documentos_tributarios with check (empresa_id in (select empresa_id from public.usuarios where id = auth.uid()));
alter policy "dt update propia empresa" on public.documentos_tributarios
  using (empresa_id in (select empresa_id from public.usuarios where id = auth.uid()))
  with check (empresa_id in (select empresa_id from public.usuarios where id = auth.uid()));
