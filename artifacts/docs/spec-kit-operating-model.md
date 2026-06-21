---
kind: doc
status: active
created_at: 2026-06-20
tags: [spec-kit, loops, agents]
---

# Spec Kit Y Loops

Spec Kit y loops resuelven problemas distintos.

## Loops

Los loops son el sistema operativo del trabajo continuo. Detectan senales,
eligen que revisar, ejecutan una investigacion o tarea, registran resultados y
dejan memoria para la proxima sesion.

Ejemplos en este repo:

- `loops/engineering`
- `loops/product`
- `loops/dev-operator`

## Spec Kit

Spec Kit es el contrato de una feature concreta. Evita que un agente salte de
una idea grande directo a editar codigo sin capturar requisitos, riesgos,
privacidad, datos y validacion.

Ejemplos:

- `specs/005-cuenta-pagadora-fase-1`
- `specs/006-dev-cuentas-unico`

## Como Se Encajan

1. Un loop o el usuario detecta una necesidad.
2. Si es grande, se abre un spec.
3. El spec produce plan y tasks.
4. Engineering implementa desde tasks.
5. El resultado vuelve al loop log y a artifacts.

## Cuando No Usar Spec Kit

- Fix obvio de compilacion.
- Ajuste menor de copy.
- Cambio local sin decision de producto ni datos.

## Cuando Si Usarlo

- Pagos, planes, cuenta pagadora o add-ons.
- Emision real, locks, jobs, SimpleAPI o SII local.
- Panel dev, soporte o acceso a cuentas.
- Multiempresa, equipo Business, presencia o realtime.
- Telegram o flujos con privacidad sensible.

## Reglas De Privacidad

Nunca guardar en specs/artifacts:

- claves o tokens;
- certificados o claves SII;
- XML, PDFs o imagenes/base64;
- payloads completos de proveedores;
- datos privados de clientes que no sean necesarios para diagnosticar.
