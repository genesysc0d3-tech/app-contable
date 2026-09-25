-- Sociedad de profesionales acogida a 2ª categoría (2026-09-25).
--
-- Una sociedad NO emite boleta de honorarios (BHE, Art. 42 N°2 LIR)… salvo la
-- única excepción que admite el SII: la Sociedad de Responsabilidad Limitada de
-- profesionales que tributa en 2ª categoría (ni SpA ni EIRL califican; y si optó
-- por 1ª categoría, desde 2023 emite factura/boleta exenta, no BHE).
--
-- Esa condición vive en el inicio de actividades del SII y NO está en ninguna
-- fuente pública (la nómina de personas jurídicas trae RUT, razón social y
-- término de giro, nada más): solo la empresa la sabe. Por eso es una pregunta
-- del formulario de emisor, y solo se muestra a las Ltda./Limitada.
--
-- Efecto: con true, `normalizarHonorariosPorEmisor` deja la BHE tal cual; con
-- false (default), una sociedad recibe "asesoría/honorarios" como venta.
-- Aditiva; default false = nadie cambia de comportamiento. Rollback: el _DOWN.
alter table public.empresas
  add column if not exists sociedad_profesionales boolean not null default false;

comment on column public.empresas.sociedad_profesionales is
  'Sociedad de profesionales (SRL) acogida a 2ª categoría: sí emite boleta de honorarios. Solo tiene sentido en Ltda./Limitada.';
