---
kind: signal
status: open
priority: high
created_at: 2026-06-20
frequency: 1
sources:
  - docs/DECISION_FINAL_PRODUCTO.txt
  - docs/MEMORIA.md
tags: [producto, reglas, gating]
---

# Reglas De Producto No Negociables Deben Leerse Antes De Cambios

## Observation

MassDTE tiene reglas finas que se pueden romper si un agente trabaja solo desde
memoria de chat: Business no regala cupos, Start/Pro no muestran equipo,
Telegram no consume boletas desde cartolas y resultados de extension se guardan
por job.

## Evidence

El proyecto ya paso por varias compactaciones y correcciones conceptuales. La
decision final vive en `docs/DECISION_FINAL_PRODUCTO.txt`.

## Possible Causes

- Sesiones de agentes sin contexto completo.
- Cambios de UI que mezclan experiencia Business con Start/Pro.
- Cambios de backend que validan en UI pero no server-side.

## Suggested Next Action

Mantener este signal abierto como recordatorio operativo. Todo loop que toque
planes, cuenta pagadora, equipo, Telegram, emision o gating debe leer la
decision final antes de editar.

## Timeline

- 2026-06-20 - Creado al incorporar loop engineering al repo.
