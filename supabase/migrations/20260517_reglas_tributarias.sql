-- ═══════════════════════════════════════════════════════════════════
-- Migration: Reglas de clasificación tributaria chilena
-- Basado en conocimiento de contador tributario chileno (DL 824, DL 825)
-- ═══════════════════════════════════════════════════════════════════

-- Prioridad 80 — Patrones SII y previsionales (muy específicos)
INSERT INTO public.clasificacion_reglas (nombre, patron, patron_tipo, tipo_propuesto, tipo_flujo_match, confianza, prioridad) VALUES
('Pago F29 SII', '\bF29\b|formulario\s+29|declaracion\s+mensual|debito\s+fiscal', 'regex', 'impuesto', 'salida', 0.95, 80),
('PPM', '\bPPM\b|pago\s+provisional\s+mensual', 'regex', 'impuesto', 'salida', 0.95, 80),
('Pago TGR/SII', '\b(TGR|tesoreria|SII)\b', 'regex', 'impuesto', 'salida', 0.92, 80),
('Cotización AFP', '\bAFP\s+(HABITAT|PROVIDA|CAPITAL|CUPRUM|MODELO|PLANVITAL|UNO)\b', 'regex', 'cotizacion_previsional', 'salida', 0.98, 80),
('Cotización ISAPRE', '\bISAPRE\s+(BANMEDICA|CONSALUD|CRUZ\s+BLANCA|COLMENA|VIDA\s+TRES|NUEVA\s+MASVIDA|ESENCIAL)\b', 'regex', 'cotizacion_previsional', 'salida', 0.98, 80),
('Pago FONASA', '\bFONASA\b', 'regex', 'cotizacion_previsional', 'salida', 0.98, 80),
('Mutual/ACHS', '\b(MUTUAL|ACHS|IST|ISL)\b', 'regex', 'cotizacion_previsional', 'salida', 0.95, 80),
('Patente Municipal', '\bpatente\s+(comercial|municipal)\b', 'regex', 'impuesto', 'salida', 0.95, 80),
('Contribuciones', '\bcontribuciones\s+de?\s+bienes?\s+raices?\b', 'regex', 'impuesto', 'salida', 0.95, 80);

-- Prioridad 90 — Retenciones, pagos especiales
INSERT INTO public.clasificacion_reglas (nombre, patron, patron_tipo, tipo_propuesto, tipo_flujo_match, confianza, prioridad) VALUES
('Retención Honorarios', '\b(ret\b|retencion)\s+honorarios?\b', 'regex', 'retencion', 'salida', 0.93, 90),
('Pago Dividendo', '\b(dividendos?|reparto\s+utilidades?)\b', 'regex', 'dividendo', 'salida', 0.90, 90),
('Donación', '\b(donacion|donativo|ley\s+valdes)\b', 'regex', 'donacion', 'salida', 0.90, 90);

-- Prioridad 91 — Honorarios profesionales (ingreso)
INSERT INTO public.clasificacion_reglas (nombre, patron, patron_tipo, tipo_propuesto, tipo_flujo_match, confianza, prioridad) VALUES
('Boleta Honorarios', '\b(honorarios?|servicios?\s+profesionales?|consultoria|asesoria|prestacion\s+servicios?)\b', 'regex', 'boleta_honorarios', 'entrada', 0.85, 91);

-- Prioridad 100 — Arriendos, remuneraciones, comisiones
INSERT INTO public.clasificacion_reglas (nombre, patron, patron_tipo, tipo_propuesto, tipo_flujo_match, confianza, prioridad) VALUES
('Pago Arriendo Comercial', '\barriendo\s+(amoblado|comercial|oficina|local)\b', 'regex', 'factura_afecta', 'salida', 0.90, 100),
('Pago Arriendo Residencial', '\barriendo\s+(departamento|casa|no\s+amoblado|inmueble|vivienda)\b', 'regex', 'arriendo', 'salida', 0.90, 100),
('Pago Remuneraciones', '\b(sueldos?|remuneracion|nomina|liquidacion\s+sueldo|salarios?)\b', 'regex', 'remuneracion', 'salida', 0.92, 100),
('Pago Finiquito', '\bfiniquito\b', 'regex', 'remuneracion', 'salida', 0.92, 100),
('Pago Comisión', '\bcomisiones?|comision\b', 'regex', 'comision', 'salida', 0.87, 100),
('Pago Interés', '\binteres(es)?\s+(credito|prestamo|hipoteca|linea|sobregiro)\b', 'regex', 'interes', 'salida', 0.92, 100),
('Ingreso Interés', '\binteres(es)?\s+(deposito|ahorro|inversion|plazo|ganados?)\b', 'regex', 'interes', 'entrada', 0.90, 100);

-- Prioridad 105 — Facturas de compra/IVA crédito
INSERT INTO public.clasificacion_reglas (nombre, patron, patron_tipo, tipo_propuesto, tipo_flujo_match, confianza, prioridad) VALUES
('Pago Factura Proveedor', '\b(factura|fact\.)|pago\s+proveedor\b', 'regex', 'factura_afecta', 'salida', 0.82, 105),
('Compra Mercadería', '\bcompra\s+(de\s+)?(mercaderia|insumos?|materia\s+prima|productos?)\b', 'regex', 'factura_afecta', 'salida', 0.85, 105);
