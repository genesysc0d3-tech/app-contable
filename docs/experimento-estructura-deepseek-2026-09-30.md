# Experimento: paso de ESTRUCTURA con DeepSeek (OpenCode Go) — 2026-09-30

Idea del fundador: cuando el lector determinístico no entiende una cartola, agregar un paso que entienda la
ESTRUCTURA (qué columna es qué) y después leer los montos igual que siempre. No reemplaza al lector: le da el mapa.

Script: `scripts/experimento-estructura-deepseek.ts` (datos 100% sintéticos; nada de clientas sale del Mac).
5 formatos (chile, santander single_col, bci detallado, estado con "$ 1.234", itaú) × 10 variantes
(base, títulos en inglés, títulos genéricos, columna insertada, columnas movidas, sin títulos, basura extra arriba,
glosa con "TOTAL", montos formato inglés "1,234,567", sin saldo) = 50 cartolas. DeepSeek (deepseek-v4-flash,
OpenCode Go, tool strict + enum, temperatura 0) recibe una grilla con índices (22 primeras + 6 últimas filas) y
devuelve SOLO el AdapterConfig. applyAdapter lee los montos; el validador decide; se compara contra la verdad.

## Resultados (estables en 3 corridas)
| | OK | error silencioso | atrapado | rechazo falso | otro |
|---|---|---|---|---|---|
| Lector de hoy | 38 | **5** | 3 | 4 | |
| DeepSeek solo (mapa) | 46 | 1 | 3 | 0 | |
| "IA solo si el lector falla" | 42 | **5** | 3 | 0 | |
| **Dos opiniones + desempate por saldo** | **44** | **1** | 3 (ambos fallan) | 0 | 2 al humano |

- "IA solo si falla" NO sirve para los silenciosos: si el lector se equivoca y el validador no lo ve, la IA nunca entra.
- Dos opiniones: lector y DeepSeek corren siempre. Iguales + valida → acepta. Distintos → gana el único que valida;
  si ambos validan, gana el comprobado por la ecuación del saldo (`formatoVerificadoPorSaldo`); si no → al humano
  mostrando las columnas en disputa.
- El 1 silencioso restante y los 3 "ambos fallan" son TODOS "montos formato inglés": no es de estructura, es el bug
  de `parseChileanNumber` (apply.ts:19, "250,000" → 250). DeepSeek sí dice `number_format: generic`, pero
  applyAdapter IGNORA `number_format`. Arreglar el lector primero.
- Latencia: mediana ~3 s. 1 de 150 llamadas tardó 252 s → timeout (~20 s) y seguir sin IA.

## Fallas del lector encontradas (nuevas, sintéticas)
1. BancoEstado ("$ 1.234.567" en texto) sin títulos / títulos genéricos / en inglés: la heurística toma el SALDO
   como monto (transactions_log, todo ENTRADA) y el validador lo acepta → 30/30 malos en silencio.
2. Santander con columnas en orden inverso: toma el Saldo como monto y el N° documento como saldo → silencioso.
3. Itaú sin títulos: toma N° documento correlativo (5000, 5001…) como saldo → rechazo falso (montos bien).
4. "$ -418.370" se lee POSITIVO (se pierde el signo después del $).
5. BCI con columna insertada: rechazo falso por saldo (DeepSeek lo rescata).

## Siguiente
1. Arreglar parseChileanNumber / respetar number_format por columna (+ signo tras "$").
2. Paso de estructura "dos opiniones" en el orquestador, antes de la capa 4 (que hoy manda la hoja entera como
   texto a la IA y la IA lee montos). Guardar el mapa ganador como adaptador → la próxima vez es caché.
3. Pasar el experimento a cartolas reales (localmente, sin mandar datos de clientas a la nube sin DPA).
