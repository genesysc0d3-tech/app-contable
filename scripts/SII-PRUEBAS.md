# ⚠️ Scripts de prueba SII — EMITEN BOLETAS REALES

Estos scripts manejan la extensión `sii-portal-rpa` contra el **portal real del
SII** (eboleta.sii.cl). Algunos **emiten boletas tributarias reales** (consumen
folio, van al RCOF/F29). Úsalos solo con autorización y a sabiendas.

| Script | Qué hace | ¿Emite? |
|---|---|---|
| `sii-real-drive.mjs [puerto] [PIN] [emisorRUT]` | Flujo completo: desbloquea bóveda, emite boleta exenta $1 | **SÍ — boleta real** |
| `sii-modal-inspect.mjs [puerto] [PIN] [emisorRUT]` | Abre el modal y vuelca su DOM | No (allow_final_emit=false) |
| `sii-detalle-inspect.mjs [puerto] [PIN] [emisorRUT]` | Inspecciona el campo glosa/Detalle | No |
| `sii-verify.mjs` | Lee el Resumen de Ventas (solo lectura) | No |

Reglas:
- El **PIN y el RUT van por argumento** — nunca se guardan en los archivos ni
  se commitean.
- El perfil de Chromium queda en `/tmp/sii-real-test-profile` con la sesión SII
  abierta y la bóveda cifrada; **bórralo al terminar**: `rm -rf /tmp/sii-real-test-profile`.
- No corras estos scripts en CI ni sin entender que `sii-real-drive.mjs` crea un
  documento tributario real (se anula vía Nota de Crédito, no se borra).

Ver `extensions/sii-portal-rpa/ARQUITECTURA.md` para el detalle del flujo.
