-- El RLS deja de colgar de "dónde estoy parado" y pasa a colgar de "a qué tengo
-- derecho".
--
-- Hasta hoy 17 policies filtraban por `usuarios.empresa_id`, un campo de UNA
-- empresa que el selector reescribe para saber en qué empresa está parado el
-- usuario. Eso NO es un permiso: si el campo queda apuntando a una empresa que
-- se migró a otra cuenta, la base deja entrar igual.
--
-- Es exactamente la fuga del 2026-08-30: un correo viejo quedó apuntando a la
-- empresa de otra cuenta y alcanzaba 375 movimientos bancarios, 42 cartolas y
-- 38 boletas ajenas — con permiso de escribir y borrar, porque las policies
-- `FOR ALL` sin WITH CHECK reusan la expresión de lectura también para escribir.
--
-- La regla nueva exige las dos cosas: que sea la empresa donde estás parado Y
-- que esa empresa viva en una cuenta donde eres miembro activo. No ensancha
-- nada — el alcance sigue siendo una empresa — así que ninguna consulta del
-- producto cambia de resultado.
--
-- Medido antes de escribir esto, sobre movimientos_raw: los 5 usuarios con
-- datos conservan exactamente lo suyo, y el único que pierde (375 → 0) es el
-- que se cerró a mano ese día.

-- Un solo lugar donde vive la regla. Si mañana cambia, cambia acá y no en 17
-- policies — que es justo el error que hizo falta arreglar hoy.
create or replace function public.empresa_autorizada()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select u.empresa_id
  from public.usuarios u
  where u.id = (select auth.uid())
    -- El veto ahora corta también la BASE, no solo la app. Antes vetar a
    -- alguien lo mandaba a /bloqueado y su token seguía leyendo por PostgREST.
    and u.vetado is not true
    and exists (
      select 1
      from public.cuenta_empresas ce
      join public.cuenta_usuarios cu on cu.cuenta_id = ce.cuenta_id
      where ce.empresa_id = u.empresa_id
        and ce.activa
        and cu.usuario_id = u.id
        and cu.activo
    )
$$;

comment on function public.empresa_autorizada() is
  'La empresa que este usuario puede tocar: la que tiene activa Y que vive en una cuenta donde es miembro activo. NULL si no corresponde ninguna (y `empresa_id = NULL` deniega). Es la regla del RLS: cambiarla acá cambia las 17 policies.';

grant execute on function public.empresa_autorizada() to authenticated, anon;

-- Se usa `alter policy` y no drop+create a propósito: con drop+create se puede
-- olvidar re-declarar `for all` o un `with_check` existente, y una policy que
-- desaparece es un deny-all silencioso.
--
-- La forma `= (select ...)` conserva el índice por empresa_id (el planner lo
-- resuelve como InitPlan una sola vez). La forma `in (select ...)` degradaba a
-- hash join y perdía el índice: con 1.700 filas da igual, con 100 mil deja el
-- escritorio inusable.
alter policy "row level via usuarios" on public.clasificacion_reglas using (empresa_id = (select public.empresa_autorizada()));
alter policy "row level via usuarios" on public.clientes            using (empresa_id = (select public.empresa_autorizada()));
alter policy "row level via usuarios" on public.creditos_uso        using (empresa_id = (select public.empresa_autorizada()));
alter policy "row level via usuarios" on public.documentos_subidos  using (empresa_id = (select public.empresa_autorizada()));
alter policy "row level via usuarios" on public.gastos              using (empresa_id = (select public.empresa_autorizada()));
alter policy "row level via usuarios" on public.ia_uso              using (empresa_id = (select public.empresa_autorizada()));
alter policy "row level via usuarios" on public.movimientos_raw     using (empresa_id = (select public.empresa_autorizada()));
alter policy "row level via usuarios" on public.periodos_contables  using (empresa_id = (select public.empresa_autorizada()));
alter policy "row level via usuarios" on public.propuestas_ia       using (empresa_id = (select public.empresa_autorizada()));
alter policy "row level via usuarios" on public.proveedores         using (empresa_id = (select public.empresa_autorizada()));

alter policy "users see own empresa caf" on public.boletas_caf_mock using (empresa_id = (select public.empresa_autorizada()));
alter policy "users see own empresa boletas" on public.boletas_emitidas using (empresa_id = (select public.empresa_autorizada()));
alter policy "miembros leen empresa invitaciones" on public.empresa_invitaciones using (empresa_id = (select public.empresa_autorizada()));

-- OJO: acá la columna es `id`, no `empresa_id`. Un find/replace por patrón
-- saltaba esta policy — y dejarla afuera hace que los datos se vean y la
-- empresa no, que en el escritorio es una pantalla en blanco.
alter policy "empresas: miembros leen su empresa" on public.empresas using (id = (select public.empresa_autorizada()));

-- documentos_tributarios tiene TRES policies y cuatro expresiones (el update
-- lleva using y with_check).
alter policy "dt select propia empresa" on public.documentos_tributarios using (empresa_id = (select public.empresa_autorizada()));
alter policy "dt insert propia empresa" on public.documentos_tributarios with check (empresa_id = (select public.empresa_autorizada()));
alter policy "dt update propia empresa" on public.documentos_tributarios
  using (empresa_id = (select public.empresa_autorizada()))
  with check (empresa_id = (select public.empresa_autorizada()));

-- Si algo quedó colgando del modelo viejo, la migración no pasa. Se excluyen
-- las que legítimamente nombran `cuenta_usuarios`.
do $$
declare pendientes int;
begin
  select count(*) into pendientes
  from pg_policies
  where schemaname = 'public'
    and tablename <> 'usuarios'
    and (
      qual ~ 'FROM usuarios' or with_check ~ 'FROM usuarios'
    );
  if pendientes <> 0 then
    raise exception 'Quedaron % policies colgando de usuarios.empresa_id', pendientes;
  end if;
end $$;
