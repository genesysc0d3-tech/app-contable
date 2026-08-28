-- El copy de los planes decía "boletas" y el medidor cuenta boletas Y FACTURAS.
--
-- `contarMasivas` (lib/pagos/metering.ts) cuenta filas de `boletas_emitidas`
-- con propuesta enlazada SIN filtrar por tipo_dte, y las facturas 33/34 se
-- guardan en esa misma tabla. Verificado con los folios 961-968: los siete
-- descuentan cuota. O sea, alguien que contrata "1.000 boletas" y emite 300
-- facturas se queda con 700, y en ninguna parte se lo avisamos. Eso no es un
-- detalle de redacción: es lo que el cliente cree que compró.
--
-- Y en Business se agrega la condición real del multiempresa, que ninguna
-- pantalla dice hoy: al SII no entra la empresa, entra la PERSONA. El motor
-- solo puede emitir por las empresas donde el RUT de quien tiene la clave está
-- autorizado en el SII; eso se habilita allá, no acá.

update public.planes_config
set
  features = case codigo
    when 'start' then '["300 documentos desde cartolas al mes (boletas o facturas)","Boletas y facturas únicas ilimitadas","1 empresa","1 persona","Historial básico"]'::jsonb
    when 'pro' then '["1.000 documentos desde cartolas al mes (boletas o facturas)","100 comprobantes por Telegram","Boletas y facturas únicas ilimitadas","1 empresa","Historial completo"]'::jsonb
    when 'business' then '["3.000 documentos desde cartolas al mes (boletas o facturas)","500 comprobantes por Telegram","Equipo","Hasta 3 empresas (tu RUT debe estar autorizado en el SII en cada una)","Reportes consolidados"]'::jsonb
    else features
  end,
  updated_at = now()
where codigo in ('start', 'pro', 'business');
