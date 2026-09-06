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
