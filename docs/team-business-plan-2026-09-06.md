# Team Business — plan de ejecución (2026-09-06)

Decisión del fundador: el chat SÍ va en la V1. Compartir un objeto de una empresa
con alguien que no tiene tick en esa empresa = "No puedes compartir esto con esa
persona", y ya. El chequeo va en el servidor al mandar.

## Orden

1. **Puerta** — personas de Business = 3; apartado Team en el popup del botón de
   empresa (gris con upsell en Start/Pro); "Agregar alguien al team" con selector
   de empresas con ticks; editar ticks / quitar; invitación de punta a punta.
2. **Cuota** — el candado ya es por cuenta (`emision_locks.cuenta_id` PK). El hoyo
   real: reaping del lock por TTL con emisión en vuelo (`jobs/route.ts:314` gate
   lee `boletas_emitidas`, el insert llega minutos después en `/result`). Cierre:
   RPC `reservar_cupo_masivo` con advisory lock por cuenta que cuente emitidas +
   `emision_jobs` vivos con propuesta_id; y el trial cuenta `[empresaId]` en
   `metering.ts:267` en vez de la cuenta (3 empresas = 3× cupo) — arreglar.
3. **Chat** — mensajes persistentes (tabla propia, RLS por cuenta, NO entra a la
   publicación realtime de la mesa), satélites de color en el orbe, apuntar
   objeto por click (`documentos_subidos.id` es el único id direccionable hoy:
   evento `massdte:open-doc` + `pendingOpenDoc`). Canales privados con Realtime
   Authorization (hoy `presence:cuenta:<uuid>` es público). Modo soporte no
   escribe. Texto del chat jamás a IA sin `tokenizeForAI`.
4. **Gris de emisión + microatribución** — banner con dueño y avance desde el
   estado real del lote; "clasificada por X · hace 2h" desde `cuenta_audit_events`.

## Estado (2026-09-06)

- Fase 1 PR #472 (mergeada a dev) + migración `20260906180000_team_ticks.sql` EN PROD.
- Fase 2 PR #473 (mergeada a dev), sin migración.
- Fase 3 chat: migración `20260906200000_team_mensajes.sql` (la aplica el
  fundador), acciones `mensajesTeam/enviarMensajeTeam/marcarLeidosTeam`, hook
  `useTeamChat` (poll 20 s + foco), `GuardarailOrbe` como contenedor (satélites,
  lobby, conversación, apuntar `ultimoDocAbierto`, salto con confirmación y
  `massdte:salto`/`massdte:volver` en sessionStorage). Test `team-chat.test.ts`.
- Fase 4 (#475): avance en el gris + `AtribucionDoc`. Todo en main (#476).
- Prueba real a dos navegadores (2026-09-06): funcionó el circuito completo;
  tres hoyos arreglados en #477 (onboarding "Unirme al team", leído en
  servidor, salto navega al mes si el doc no está en la mesa).

## Hechos verificados (2026-09-06)

- `crearInvitacionEmpresa` (`src/app/(app)/empresa/actions.ts:383`) existe y NADIE
  la llama. Devuelve `invitePath` una sola vez; no hay email.
- No existe quitar miembro ni revocar invitación (estado `revocada` jamás se escribe).
- Aceptar: si el invitado ya tiene otra `empresa_id` → rebota (multi-cuenta indefinido).
- `empresa_autorizada()` (`20260830160000`) es la regla única de las 17 policies.
- `EmpresaPopup` (wizard) no sabe del plan; `EmpresaBrand` es el botón de empresa
  con su popup (conmutador). El apartado Team va en `EmpresaBrand`.
- `listarEquipoBusiness()` (`v5/actions.ts:556`) no expone `es_titular` ni pendientes.
- `revalidatePath("/empresa")` es no-op (no existe la ruta); usar `/escritorio/v5` y `/massdte`.
- Orbe: `GuardarailOrbe.tsx` montado en `MesaController` y desaparece con 0
  pendientes → el chat necesita vivir en `V5Root` y el orbe volverse contenedor.
- `TabsV5` remonta el contenido con `key={tab-fecha}`; el estado del chat vive fuera.

## Segunda tanda (firmada 2026-09-06 noche) — construir en dev, NO promover a main

### A. "Colaboras en" (multi-cuenta)
- Una persona puede tener su cuenta Y ser miembro de otras (`cuenta_usuarios`
  ya lo permite: PK cuenta+usuario). Aceptar la invitación deja de rebotar si
  ya tiene empresa: agrega membresía + ticks y NO le mueve `empresa_id`.
- `listarEmpresasSelector` devuelve además `colaboraciones` (cuentas donde es
  miembro no titular, con sus empresas con tick) y `cuentaPropia` (la empresa
  principal de la cuenta donde es titular) para "← Volver a tu cuenta".
- `cambiarEmpresaActiva` acepta destino en CUALQUIER cuenta donde sea miembro
  activo: titular o tick, plan activo de ESA cuenta. Cruzar cuentas no exige
  multiempresa (eso es para agregar empresas dentro de una cuenta).
- Popup del botón de empresa: siempre dos apartados, "Team" (gris: viene con
  Business) y "Colaboras en" (gris: "No te han invitado a ningún team").
  Parado en una cuenta ajena: arriba "← Volver a tu cuenta", y la lista es
  la del team.
- Regla nº1 (migración `team_quitar_miembro` v2, NO aplicada en prod): al
  quitar a alguien, si estaba parado en una empresa de esa cuenta se lo
  devuelve a la empresa principal de su cuenta propia.
- El MCP sigue siendo solo del titular (no cambia).

### B. Modo apuntar (la fase Figma)
- Objetivos apuntables marcados con `data-apuntable="documento|tx|boleta"`,
  `data-apuntable-id`, `data-apuntable-label`, `data-apuntable-doc` (doc que
  contiene la tx) — en cards de documentos, filas de tx de Emitir y del
  editor de cartola, y boletas de la mesa.
- El clip del chat entra en MODO APUNTAR: velo sobre la pantalla, cursor en
  cruz, lo apuntable se ilumina al pasar, un toque lo elige (Esc sale). La
  referencia queda en el compose con su nombre ("tx 12 sep · $45.900").
- `team_mensajes.objeto_tipo` se amplía a tx/boleta (migración NO aplicada en
  prod) + `objeto_doc_id`. El servidor valida que la tx/boleta exista en la
  empresa y que el receptor tenga tick.
- El salto del receptor abre el doc (o la pestaña Boletas) Y resalta la fila
  (`massdte:resaltar` → scrollIntoView + halo 3 s).
