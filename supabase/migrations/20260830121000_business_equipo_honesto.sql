-- «Equipo» a secas hace leer "el plan de los socios". Business trae UNA persona
-- incluida: la segunda se compra aparte. La función está construida entera
-- (invitación, roles, aceptación) y la limita ese número, así que la promesa
-- suena a más de lo que entrega justo donde se decide pagar.
update public.planes_config
set features = (
      select jsonb_agg(case when f::text = '"Equipo"'
        then to_jsonb('Equipo: 1 persona incluida, las demás se suman aparte'::text) else f end)
      from jsonb_array_elements(features) as f),
    updated_at = now()
where codigo = 'business' and features::text like '%"Equipo"%';
