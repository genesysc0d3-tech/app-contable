-- Business incluye 3 empresas (decisión de pricing del fundador: 2 UF, 3 RUTs,
-- +0,5 UF por RUT adicional). La columna empresas_incluidas nació con default 1
-- después del seed y nunca se alineó — con cupo 1 el "+ Agregar empresa" del
-- switcher no aparece (cupo lleno con la primera empresa).
update public.planes_config set empresas_incluidas = 3 where codigo = 'business';
