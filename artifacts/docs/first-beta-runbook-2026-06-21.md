---
kind: doc
status: active
created_at: 2026-06-21
tags: [launch, beta, runbook, support, privacy, massdte]
---

# Runbook Primera Beta Controlada MassDTE

## Decision De Uso

La beta controlada permite probar la app web SaaS con clientes reales o
semirreales, pero el mensaje comercial debe ser acotado:

- Permitido: "beta controlada para subir cartolas, revisar propuestas, emitir
  pruebas controladas, ver historial/reportes y recibir soporte".
- No permitido: prometer operacion masiva abierta de emision tributaria sin
  observabilidad, soporte y compliance operacional, aunque `LAUNCH-001` ya haya
  sido reportado OK en smoke manual controlado.
- Si se cobra, debe quedar claro que es una beta controlada y que soporte puede
  intervenir en modo solo lectura.

## Perfil Del Primer Beta

Elegir una cuenta que cumpla todo:

- 1 empresa, bajo volumen, sin urgencia tributaria critica.
- Persona disponible durante la sesion de onboarding.
- Cartola de prueba o real autorizada, sin exigir resultado tributario final en
  la primera sesion.
- Acepta que soporte Genesys pueda mirar la cuenta en modo solo lectura.
- No requiere equipo/multiempresa en el primer dia, salvo que se pruebe plan
  Business de forma controlada.

## Go / No-Go Antes De Invitar

Go:

- `npm run lint`, `npm run test` y `npm run build` verdes.
- Auditorias productivas app/roles/locks verdes despues del deploy.
- Runbook leido por quien hara soporte.
- Checklist de privacidad minimo completo: politica/DPA borrador, ARCO manual,
  retencion, brechas y proveedores.
- Canal de soporte definido y atendido durante la prueba.

No-go:

- El mensaje comercial promete emision masiva abierta sin observabilidad,
  soporte ni plan de incidentes.
- Lint/build/test rojo.
- Upload/IA/pagos sin rollback operativo.
- No hay forma clara de contactar al usuario si una emision, pago o carga queda
  a medias.
- El usuario espera operar obligaciones tributarias urgentes sin respaldo.

## Flujo De Onboarding

1. Registrar usuario y confirmar acceso a `/massdte`.
2. Completar empresa: nombre, RUT, datos de emisor y configuracion minima.
3. Confirmar plan: Start, Pro o Business; explicar cupos en lenguaje simple.
4. Subir una cartola pequena o documento controlado.
5. Revisar propuestas y explicar que el usuario siempre aprueba antes de emitir.
6. Revisar historial/reportes.
7. Si se prueba pago, usar una compra chica o fixture controlado.
8. Si se prueba emision real, usar el checklist de `LAUNCH-001`, registrar solo
   evidencia no sensible y confirmar lock/job/folio sin guardar documentos
   tributarios crudos.

## Soporte Genesys

Usar `/dev/cuentas` para:

- Ver estado de plan, pago, cupos, locks, jobs y auditoria.
- Entrar con "Ver cliente" solo cuando el usuario lo autorice o haya incidente.
- Confirmar banner "Modo soporte Genesys" en rutas app.
- No subir, emitir, pagar, invitar ni cambiar empresa en modo soporte.
- Salir con "Volver a dev" y revisar que quede auditado.

## Fallos Y Rollback

Upload/IA:

- Si falla upload, revisar tamano, extension, MIME y estado del documento.
- Si queda `procesando`, esperar polling; si no avanza, documentar `documento_id`
  y no reintentar masivamente.
- Si hay datos sensibles, no copiar archivo crudo a artifacts.

Pago:

- Si falla checkout, revisar estado de cuenta/addon antes de crear otro.
- Si hay compra pendiente, no iniciar segundo pago hasta confirmar idempotencia.

Lock/emision:

- Si hay lock atascado, revisar Account 360 y usar cancelacion controlada.
- Si extension/SII falla, no marcar como emitido sin resultado persistido.
- Si hay cambio de empresa durante el flujo, verificar que el resultado quede
  asociado al `job.empresa_id`.

Privacidad:

- No guardar claves, cookies, CAF, XML/PDF tributarios, cartolas ni capturas con
  datos completos en artifacts.
- En reportes, usar IDs tecnicos, datos enmascarados y resumen del problema.

## Criterio De Exito

La beta inicial funciona si:

- El usuario entra sin ayuda tecnica excesiva.
- Sube un documento controlado y entiende el estado del procesamiento.
- Revisa al menos una propuesta o historial.
- Soporte puede observar la cuenta sin permisos de escritura.
- No hay errores de consola/pageerror altos en auditoria posterior.
- Queda claro si la emision real fue probada o sigue fuera de alcance.

## Metricas Post-Sesion

Registrar en artifact:

- Tiempo hasta primer documento subido.
- Tiempo hasta primera propuesta revisada.
- Errores de upload/IA/pago/lock.
- Rutas usadas.
- Si soporte entro en modo cliente y por que.
- Si hubo datos sensibles expuestos en logs o artifacts.
- Decision final: seguir, pausar, corregir antes de otro beta.

## Comandos De Verificacion Post-Deploy

```bash
npm run audit:roles -- --base-url=https://app-contable-five.vercel.app --state=/tmp/e2e-state-vercel.json
AUDIT_NONDEV_STATE=/tmp/e2e-state-nondev.json npm run audit:app -- --base-url=https://app-contable-five.vercel.app --state=/tmp/e2e-state-vercel.json --expect-dev
npm run audit:locks -- --base-url=https://app-contable-five.vercel.app --state=/tmp/e2e-state-vercel.json
```
