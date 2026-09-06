-- Observaciones del ASISTENTE conectado (MCP): qué sugirió, sobre qué
-- documento, y por qué — en CUARENTENA.
--
-- Para qué (fundador 2026-09-06): aprender de lo que hacen los clientes con su
-- asistente SIN aprender del asistente. La regla es la de Anthropic: la señal
-- de aprendizaje es la ELECCIÓN DEL HUMANO (emitió / corrigió / rechazó en la
-- app), nunca el texto del modelo. Esta tabla guarda lo que el asistente
-- propuso enlazado al documento; el resultado NO se escribe acá — se calcula
-- después mirando en qué terminó ese `propuesta_id` en la mesa. Así no se toca
-- el camino de emisión ni el cobro.
--
-- CUARENTENA = `motivo` es texto de un tercero (el modelo del cliente): puede
-- venir envenenado. Se guarda como dato inerte, con tope de largo, y JAMÁS se
-- pega a un prompt ni se convierte en regla por sí solo. Las reglas las escribe
-- una persona después de mirar los agregados. Cualquier código que lea
-- `motivo` para algo que no sea mostrarlo entre comillas o contarlo está mal.
--
-- Solo escribe el service role (la ruta del MCP). Los miembros de la cuenta
-- pueden LEER las suyas (para el chip "tu asistente lo devolvió: …" en el
-- Check, que hace verdad la promesa "lo ve el usuario").
--
-- Volumen: una fila por documento movido. Con el techo de 40 movidos/día por
-- token, son decenas al día por conector. Nada.

create table if not exists public.asistente_observaciones (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  usuario_id uuid not null references public.usuarios(id) on delete cascade,
  -- El conector que lo hizo. Si el token se borra, la observación queda (es
  -- del cliente, no del token): set null.
  token_id uuid references public.mcp_tokens(id) on delete set null,
  propuesta_id uuid not null references public.propuestas_ia(id) on delete cascade,
  accion text not null check (accion in ('dejar_en_emitir', 'devolver_a_revision')),
  -- Texto del asistente. Tope duro: el que llega ya viene recortado a 300 en la
  -- ruta, y la base lo vuelve a exigir por si aparece otro camino.
  motivo text not null check (char_length(motivo) <= 300),
  created_at timestamptz not null default now()
);

comment on table public.asistente_observaciones is
  'Sugerencias del asistente MCP enlazadas al documento. `motivo` es texto de un tercero en CUARENTENA: no alimenta prompts ni reglas; el aprendizaje sale de lo que después hizo el humano con ese propuesta_id.';

create index if not exists idx_asistente_obs_empresa_fecha
  on public.asistente_observaciones (empresa_id, created_at desc);
create index if not exists idx_asistente_obs_propuesta
  on public.asistente_observaciones (propuesta_id);

alter table public.asistente_observaciones enable row level security;

-- Lectura: los miembros activos de la cuenta, misma regla única que el resto
-- (empresa_autorizada()). Sin policy de INSERT/UPDATE/DELETE para
-- authenticated a propósito: solo el service role escribe, desde la ruta del
-- conector, que ya validó identidad, plan y membresía.
drop policy if exists "asistente_obs select propia empresa" on public.asistente_observaciones;
create policy "asistente_obs select propia empresa"
  on public.asistente_observaciones for select
  to authenticated
  using (empresa_id = (select public.empresa_autorizada()));
