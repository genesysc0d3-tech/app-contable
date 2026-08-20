-- RUT de empresa ÚNICO (anti multi-cuenta / trial farming).
--
-- Historia: el onboarding SIEMPRE manejó el error 23505 con "Ese RUT ya está
-- registrado", pero la constraint que lo dispara nunca existió (código muerto
-- verificado contra prod 2026-08-20: empresas solo tenía pkey + checks).
-- Sin esto, correo nuevo = cuenta nueva = mismo RUT = trial fresco infinito.
--
-- Índice por EXPRESIÓN porque el RUT se guarda tal como se digita:
-- "77.612.308-0", "77612308-0" y "77612308-K"/"k" deben colisionar igual.
-- Se normaliza a solo dígitos + K mayúscula.
--
-- Aplicable con la base al día: verificado 0 RUTs duplicados en prod al crearlo.
-- Rollback: drop index if exists public.empresas_rut_unico;

create unique index if not exists empresas_rut_unico
  on public.empresas ((upper(regexp_replace(rut, '[^0-9kK]', '', 'g'))))
  where rut is not null and rut <> '';
