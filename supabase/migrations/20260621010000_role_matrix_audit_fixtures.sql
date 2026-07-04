-- Fixtures operativos para completar auditoria de matriz Start/Pro/Business.
-- No contienen documentos, XML, certificados, payloads de pagos ni credenciales.
-- Se cuelgan del operador Genesys para que /dev/cuentas pueda entrar en modo
-- soporte read-only y validar señales de plan.

do $$
declare
  v_genesys_id uuid;
  v_pro_empresa_id uuid := '00000000-0000-4000-8000-0000000000a1';
  v_business_empresa_id uuid := '00000000-0000-4000-8000-0000000000b1';
  v_pro_cuenta_id uuid := '00000000-0000-4000-8000-0000000000a2';
  v_business_cuenta_id uuid := '00000000-0000-4000-8000-0000000000b2';
begin
  select id
    into v_genesys_id
  from public.usuarios
  where lower(email) = 'genesysc0d3@gmail.com'
  limit 1;

  if v_genesys_id is null then
    raise notice 'No se crearon fixtures de matriz: usuario Genesys no existe.';
    return;
  end if;

  insert into public.empresas (
    id,
    rut,
    razon_social,
    giro,
    direccion,
    comuna,
    region,
    plan,
    plan_activo,
    tipo_contribuyente,
    boletas_emision_proveedor,
    facturas_emision_proveedor,
    emision_proveedor,
    tiene_certificado_sii
  )
  values
    (
      v_pro_empresa_id,
      '99.999.991-5',
      'AUDIT PRO FIXTURE SPA',
      'Servicios de auditoria interna',
      'Fixture sin direccion comercial',
      'Santiago',
      'Metropolitana',
      'pro',
      true,
      'exento',
      'mock',
      'mock',
      'mock',
      false
    ),
    (
      v_business_empresa_id,
      '99.999.992-3',
      'AUDIT BUSINESS FIXTURE SPA',
      'Servicios de auditoria interna',
      'Fixture sin direccion comercial',
      'Santiago',
      'Metropolitana',
      'business',
      true,
      'exento',
      'mock',
      'mock',
      'mock',
      false
    )
  on conflict (id) do update set
    razon_social = excluded.razon_social,
    giro = excluded.giro,
    direccion = excluded.direccion,
    comuna = excluded.comuna,
    region = excluded.region,
    plan = excluded.plan,
    plan_activo = excluded.plan_activo,
    tipo_contribuyente = excluded.tipo_contribuyente,
    boletas_emision_proveedor = excluded.boletas_emision_proveedor,
    facturas_emision_proveedor = excluded.facturas_emision_proveedor,
    emision_proveedor = excluded.emision_proveedor,
    tiene_certificado_sii = excluded.tiene_certificado_sii;

  insert into public.cuentas (
    id,
    nombre,
    owner_usuario_id,
    plan_codigo,
    plan_activo
  )
  values
    (
      v_pro_cuenta_id,
      'AUDIT PRO FIXTURE',
      v_genesys_id,
      'pro',
      true
    ),
    (
      v_business_cuenta_id,
      'AUDIT BUSINESS FIXTURE',
      v_genesys_id,
      'business',
      true
    )
  on conflict (id) do update set
    nombre = excluded.nombre,
    owner_usuario_id = excluded.owner_usuario_id,
    plan_codigo = excluded.plan_codigo,
    plan_activo = excluded.plan_activo,
    updated_at = now();

  insert into public.cuenta_empresas (
    cuenta_id,
    empresa_id,
    activa,
    es_principal
  )
  values
    (v_pro_cuenta_id, v_pro_empresa_id, true, true),
    (v_business_cuenta_id, v_business_empresa_id, true, true)
  on conflict (cuenta_id, empresa_id) do update set
    activa = excluded.activa,
    es_principal = excluded.es_principal;

  insert into public.cuenta_usuarios (
    cuenta_id,
    usuario_id,
    activo,
    es_titular
  )
  values
    (v_pro_cuenta_id, v_genesys_id, true, true),
    (v_business_cuenta_id, v_genesys_id, true, true)
  on conflict (cuenta_id, usuario_id) do update set
    activo = excluded.activo,
    es_titular = excluded.es_titular;

  insert into public.usuario_empresas (
    usuario_id,
    empresa_id,
    rol
  )
  values
    (v_genesys_id, v_pro_empresa_id, 'fixture_audit'),
    (v_genesys_id, v_business_empresa_id, 'fixture_audit')
  on conflict (usuario_id, empresa_id) do update set
    rol = excluded.rol;
end $$;
