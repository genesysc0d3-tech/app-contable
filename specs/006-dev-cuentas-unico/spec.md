---
kind: feature-spec
status: in_progress
created_at: 2026-06-20
feature: 006-dev-cuentas-unico
tags: [dev-operator, soporte, cuentas, privacidad]
---

# Feature: Panel Dev Unico En `/dev/cuentas`

## Contexto

La cuenta dev `genesysc0d3@gmail.com` necesita un panel operador para revisar
cuentas pagadoras, pagos, add-ons, empresas asociadas, estado de funciones y
salud operativa sin entrar a datos privados innecesarios.

El panel viejo `/dev` contiene controles legacy y rutas con sentido ambiguo. La
superficie dev debe concentrarse en `/dev/cuentas`.

## Usuarios

- Operador dev Genesys: unico usuario autorizado a ver y operar el panel dev.
- Cliente MassDTE: nunca ve el panel dev y no pierde acceso cuando el operador
  entra en modo soporte.
- Agentes IA del equipo dev: pueden leer artifacts/specs y auditar sin ver
  secretos ni datos privados innecesarios.

## Historias

### Historia 1 - Entrar Al Panel Dev Correcto

Como operador dev, quiero entrar a `/dev/cuentas` y ver el panel operador, para
no depender de rutas legacy ni controles duplicados.

**Criterios de aceptacion:**

- `genesysc0d3@gmail.com` es reconocido como operador dev.
- Usuarios no dev no pueden ver el panel.
- `/dev` no expone controles legacy peligrosos; debe redirigir o quedar
  retirado cuando se implemente esta feature.

### Historia 2 - Ver Salud De Una Cuenta Pagadora

Como operador dev, quiero ver una cuenta pagadora con empresas, plan, add-ons,
pagos, cupos, locks y estado de funciones, para confirmar si el pago libero lo
correcto.

**Criterios de aceptacion:**

- El panel muestra plan activo, add-ons activos, empresas, personas y cupos.
- El panel muestra si pagos/refills/personas adicionales quedaron asociados a
  la cuenta pagadora correcta.
- El panel no muestra documentos crudos, XML, PDFs, imagenes ni claves.

### Historia 3 - Entrar En Modo Cliente Read-Only

Como operador dev, quiero entrar a una cuenta en modo cliente read-only, para
ver lo que ve el cliente segun su plan sin bloquearle el acceso ni ejecutar
acciones destructivas.

**Criterios de aceptacion:**

- Hay un boton claro para entrar en modo cliente desde la cuenta.
- Hay un boton claro para volver a modo dev.
- El cliente puede seguir usando su cuenta.
- El modo soporte bloquea acciones de escritura y emision, no solo subir o
  emitir.
- La UI muestra un aviso persistente de modo soporte.

### Historia 4 - Diagnosticar Sin Exponer De Mas

Como operador dev, quiero diagnosticar problemas con informacion suficiente y
privacidad por defecto, para resolver soporte sin copiar datos sensibles.

**Criterios de aceptacion:**

- Busqueda por cuenta, empresa, RUT o email cuando sea necesario para soporte.
- Resultados muestran lo minimo necesario para identificar la cuenta.
- Acciones sensibles requieren confirmacion y auditoria antes de existir.
- La auditoria registra quien entro, que cuenta vio y que accion intento.

## Requisitos

- REQ-001: `/dev/cuentas` sera la superficie principal y unica del operador dev.
- REQ-002: El acceso dev se valida server-side contra el usuario autenticado y
  la lista de operadores permitidos.
- REQ-003: `genesysc0d3@gmail.com` es operador dev autorizado.
- REQ-004: El panel debe mostrar mapa de cuenta pagadora: cuenta, empresas,
  usuarios, plan, add-ons, pagos, cupos, locks y flags de funciones.
- REQ-005: El modo cliente debe ser read-only por defecto y bloquear escrituras,
  emision, subida, cambios de empresa, invitaciones y acciones de pago.
- REQ-006: El modo cliente no debe secuestrar la sesion del cliente ni bloquear
  su uso normal.
- REQ-007: Start/Pro/Business deben poder verse como cliente segun lo comprado,
  sin mostrar paneles dev al cliente.
- REQ-008: No se muestran ni almacenan secretos, certificados, XML, PDFs,
  imagenes/base64 o payloads privados completos.
- REQ-009: Toda entrada a modo cliente y toda accion dev sensible queda
  auditada.
- REQ-010: Controles legacy de `/dev` se retiran o redirigen a `/dev/cuentas`.

## No Objetivos

- No crear un panel para clientes.
- No permitir soporte write-mode en esta fase.
- No resolver automaticamente pagos dudosos sin confirmacion/auditoria.
- No exponer documentos tributarios crudos en el panel dev.
- No tocar el funcionamiento interno de la extension SII.

## Datos Y Privacidad

Datos necesarios:

- cuenta pagadora, empresas asociadas, usuarios asociados;
- plan activo, add-ons, pagos y refills;
- contadores de uso y locks de emision;
- estado de integraciones sin secretos.

Datos excluidos:

- claves SII, certificados, tokens, XML, PDFs, imagenes/base64;
- payloads completos de proveedores;
- contenido privado de documentos salvo resumen minimo necesario.

Auditoria requerida:

- operador dev;
- cuenta vista;
- entrada/salida de modo cliente;
- acciones sensibles intentadas o ejecutadas;
- fecha/hora y resultado.

## Criterios De Exito

- El operador dev entra por `/dev/cuentas` y no por `/dev`.
- Se puede confirmar si un pago libero plan/add-ons correctos.
- Se puede abrir vista cliente read-only y volver a modo dev.
- Un intento de escritura en modo cliente queda bloqueado server-side.
- Ningun usuario no dev ve rutas ni botones dev.

## Estado 2026-06-20

- `/dev` redirige a `/dev/cuentas`.
- `/dev/cuentas` lista cuentas y tiene busqueda server-side por cuenta,
  empresa, RUT, plan o correo; los resultados siguen mostrando identificadores
  enmascarados.
- `/dev/cuentas` agrega vistas rapidas: todas, alertas, bloqueadas, sin pago y
  sobre cupo, con contadores operativos arriba del listado.
- `/dev/cuentas` mejora jerarquia visual del listado: filtros con conteo,
  resumen "mostrando X de Y", severidad por fila, problema principal visible y
  accion "Ver cliente" explicita.
- `/dev/cuentas/[cuentaId]` muestra arriba un bloque "Prioridad" con errores y
  advertencias antes de los detalles, mas chequeos rapidos de plan, pago, cupos
  y emision.
- `/dev/cuentas/[cuentaId]` muestra chips de estado en el encabezado y una linea
  "Siguiente paso" dentro del bloque de prioridad.
- El detalle de cuenta usa una franja compacta de resumen operativo en vez de
  cuatro cards altas, explica empty states de pagos/emision y limita la
  auditoria visible para que eventos repetidos no dominen la pantalla.
- Modo cliente vuelve a `/dev/cuentas`.
- Modo soporte bloquea escrituras principales server-side: revisar, clientes,
  subida, pagos, emision directa, emision en lote, jobs de emision y SimpleAPI.
- Entrada/salida de modo soporte se registra en auditoria de cuenta.
- Pendiente: prueba manual con `genesysc0d3@gmail.com` y con usuario no dev.

## Preguntas Abiertas

- Si habra mas operadores dev ademas de `genesysc0d3@gmail.com`, definir tabla o
  lista administrable antes de abrir acceso.
- Definir si las acciones de reparacion de pagos se hacen en esta feature o en
  una fase posterior.
