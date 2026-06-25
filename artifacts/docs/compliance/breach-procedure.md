---
kind: doc
status: active
created_at: 2026-06-24
tags: [compliance, ley-21719, breach, security]
---

# Procedimiento de brecha de datos (1 página)

No es asesoría legal. Es el mínimo operativo para reaccionar bien. El abogado lo
valida cuando haya revenue.

## Qué cuenta como brecha

Acceso, pérdida o filtración no autorizada de datos personales/tributarios de
clientes (RUT, montos, documentos, credenciales).

## Pasos (en orden)

1. **Detectar y registrar**: hora, qué se vio, cómo se supo (alerta ops, reporte
   del cliente, etc.).
2. **Contener**: cortar el acceso. Rotar credenciales expuestas (`service_role`,
   tokens, passphrases). Revocar sesiones.
3. **Evaluar**: ¿qué datos?, ¿de cuántos/cuáles clientes?, ¿siguen expuestos?
4. **Notificar**:
   - Interno: fundador + contador, de inmediato.
   - Clientes afectados: qué pasó, qué datos, qué hacer — en lenguaje simple.
   - Autoridad: evaluar con abogado según Ley 21.719 (plazos/agencia). Documentar
     la decisión aunque se decida no notificar.
5. **Remediar**: parchar la causa y agregar el test/gate que lo habría evitado.
6. **Documentar**: evidencia sanitizada en `artifacts/runs/` (sin datos crudos).

## Responsables

- Fundador: decisión y comunicación.
- Contador: impacto tributario.
- Abogado externo: cuando haya revenue (valida y formaliza este procedimiento).

## Objetivos de tiempo (autoimpuestos, ajustar con abogado)

- Contención: horas.
- Aviso interno: inmediato.
- Aviso a clientes: dentro de 72 h, o antes si el riesgo es alto.

## Prevención (lo que reduce la probabilidad)

Backups/PITR probados, gates de secretos, `service_role` fuera de scripts de
agente, least-privilege de tokens, logs sanitizados, beta chica y controlada.
