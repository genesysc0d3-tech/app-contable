import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

/**
 * Team Business, fase 1 (fundador 2026-09-06): los TICKS deciden qué empresa
 * ve cada persona del team. La lección de la fuga 2026-08-30 es que todo
 * plano de acceso nuevo pasa por UNA regla (empresa_autorizada). Este censo
 * sostiene que: (1) la regla RLS exige el tick, (2) todo camino que escribe
 * la empresa activa lo valida, (3) los ticks se copian de la fila de la
 * invitación y no del request, (4) las RPC de team no son llamables por el
 * cliente, y (5) el popup pinta el team gris fuera de Business.
 */
const MIG = "supabase/migrations/20260906180000_team_ticks.sql";
const DOWN = "supabase/migrations/20260906180000_team_ticks_DOWN.sql";
const V5 = "src/app/(app)/escritorio/v5/actions.ts";
const EMPRESA = "src/app/(app)/empresa/actions.ts";
const BRAND = "src/app/(app)/escritorio/v5/EmpresaBrand.tsx";
const SECTION = "src/app/(app)/escritorio/v5/TeamSection.tsx";

describe("la migración: una tabla de ticks y UNA regla", () => {
  const sql = readFileSync(MIG, "utf8");

  it("Business pasa a 3 personas (con 1 no se podía invitar a nadie)", () => {
    expect(sql).toMatch(/set personas_incluidas = 3[\s\S]*?where codigo = 'business'/);
  });

  it("los ticks cuelgan de la membresía: sin membresía caen solos", () => {
    expect(sql).toMatch(/create table if not exists public\.cuenta_usuario_empresas/);
    expect(sql).toMatch(/foreign key \(cuenta_id, usuario_id\)\s+references public\.cuenta_usuarios\(cuenta_id, usuario_id\) on delete cascade/);
    expect(sql).toMatch(/alter table public\.cuenta_usuario_empresas enable row level security/);
    // solo lectura por PostgREST; escribe el service role vía RPC
    expect(sql).not.toMatch(/cuenta_usuario_empresas\s+for (insert|update|delete|all)/);
  });

  it("empresa_autorizada() exige titular O tick de ESA empresa (fail-closed: sin fila, NULL)", () => {
    const fn = sql.slice(sql.indexOf("create or replace function public.empresa_autorizada()"), sql.indexOf("comment on function public.empresa_autorizada()"));
    expect(fn).toMatch(/c\.owner_usuario_id = u\.id/);
    expect(fn).toMatch(/or cu\.es_titular/);
    expect(fn).toMatch(/from public\.cuenta_usuario_empresas t[\s\S]*?t\.usuario_id = u\.id[\s\S]*?t\.empresa_id = u\.empresa_id/);
    // sigue exigiendo lo de antes: miembro activo de la cuenta y sin veto
    expect(fn).toMatch(/cu\.activo/);
    expect(fn).toMatch(/u\.vetado is not true/);
  });

  it("la invitación lleva los ticks y la RPC los valida contra la cuenta (nada de otra cuenta, nada vacío)", () => {
    expect(sql).toMatch(/add column if not exists empresas_permitidas uuid\[\]/);
    expect(sql).toMatch(/p_empresas_permitidas uuid\[\] default null/);
    expect(sql).toMatch(/'TICKS_VACIOS'/);
    expect(sql).toMatch(/'TICK_FUERA_DE_CUENTA'/);
    // la firma vieja (sin ticks) se va: no quedan dos caminos
    expect(sql).toMatch(/drop function if exists public\.crear_empresa_invitacion_titular\(uuid, text, text, text, uuid, timestamptz\);/);
  });

  it("las cuatro RPC team_* son solo del service role (ni anon ni authenticated)", () => {
    for (const fn of ["team_es_titular", "team_actualizar_ticks", "team_quitar_miembro", "team_revocar_invitacion"]) {
      expect(sql, fn).toMatch(new RegExp(`revoke all on function public\\.${fn}\\([^)]*\\) from public, anon, authenticated;`));
      expect(sql, fn).toMatch(new RegExp(`grant execute on function public\\.${fn}\\([^)]*\\) to service_role;`));
    }
  });

  it("quitar a alguien es ATÓMICO: ticks fuera, membresía inactiva y conector MCP revocado en la misma función", () => {
    const fn = sql.slice(sql.indexOf("create or replace function public.team_quitar_miembro"), sql.indexOf("create or replace function public.team_revocar_invitacion"));
    expect(fn).toMatch(/delete from public\.cuenta_usuario_empresas/);
    expect(fn).toMatch(/set activo = false/);
    expect(fn).toMatch(/update public\.mcp_tokens[\s\S]*?set revoked_at = now\(\)/);
    expect(fn).toMatch(/'NO_SE_QUITA_AL_TITULAR'/);
    expect(fn).toMatch(/pg_advisory_xact_lock/);
  });

  it("editar ticks nunca deja a la persona parada en una empresa que no ve", () => {
    const fn = sql.slice(sql.indexOf("create or replace function public.team_actualizar_ticks"), sql.indexOf("create or replace function public.team_quitar_miembro"));
    expect(fn).toMatch(/v_actual <> all \(v_ticks\)[\s\S]*?update public\.usuarios set empresa_id = v_actual/);
  });

  it("tiene vuelta atrás completa (regla vieja, tabla, columna, RPC vieja, 1 persona)", () => {
    const down = readFileSync(DOWN, "utf8");
    expect(down).toMatch(/drop table if exists public\.cuenta_usuario_empresas/);
    expect(down).toMatch(/drop column if exists empresas_permitidas/);
    expect(down).toMatch(/set personas_incluidas = 1/);
    expect(down).toMatch(/create or replace function public\.crear_empresa_invitacion_titular\(\s*p_empresa_id uuid,\s*p_email text,\s*p_rol text,\s*p_token_hash text,\s*p_invited_by uuid,\s*p_expires_at timestamptz\s*\)/);
    const fn = down.slice(down.indexOf("create or replace function public.empresa_autorizada()"), down.indexOf("drop table if exists"));
    expect(fn).not.toMatch(/cuenta_usuario_empresas/);
  });
});

describe("todo camino que ESCRIBE la empresa activa valida el tick", () => {
  const src = readFileSync(V5, "utf8");

  it("cambiarEmpresaActiva rebota sin tick (salvo titular) ANTES del update", () => {
    const fn = src.slice(src.indexOf("export async function cambiarEmpresaActiva"), src.indexOf("type CrearEmpresaAdicionalResult"));
    const guard = fn.indexOf('error: "EMPRESA_SIN_TICK"');
    const update = fn.indexOf(".update({ empresa_id: targetEmpresaId })");
    expect(guard).toBeGreaterThan(-1);
    expect(update).toBeGreaterThan(guard);
    expect(fn).toMatch(/esTitularDeCuenta\(ctx\.sb, acceso\.cuentaId, ctx\.userId\)/);
    expect(fn).toMatch(/ticks\.has\(targetEmpresaId\)/);
  });

  it("el selector no ofrece empresas sin tick", () => {
    const fn = src.slice(src.indexOf("export async function listarEmpresasSelector"), src.indexOf("export async function cambiarEmpresaActiva"));
    expect(fn).toMatch(/\.filter\(\(id\) => !ticks \|\| ticks\.has\(id\)\)/);
  });

  it("las acciones del team pasan por las RPC (la regla vive en la base) y no escriben en modo soporte", () => {
    for (const rpc of ["team_actualizar_ticks", "team_quitar_miembro", "team_revocar_invitacion"]) {
      expect(src).toMatch(new RegExp(`\\.rpc\\("${rpc}"`));
    }
    expect(src).toMatch(/p_empresas_permitidas: empresas/);
    const bloqueos = src.match(/if \(ctx\.supportMode\) return \{ ok: false, error: "En modo soporte no se toca el team\." \}/g) ?? [];
    expect(bloqueos.length).toBeGreaterThanOrEqual(4);
  });
});

describe("aceptar la invitación copia los ticks de la FILA, jamás del request", () => {
  const src = readFileSync(EMPRESA, "utf8");
  const fn = src.slice(src.indexOf("export async function aceptarInvitacionEmpresa"));

  it("lee empresas_permitidas de la invitación y siembra los ticks en las DOS ramas", () => {
    expect(fn).toMatch(/select\("id, empresa_id, email, rol, estado, expires_at, empresas_permitidas"\)/);
    expect(fn).toMatch(/ticksParaInvitacion\(sb, cupoAceptacion\.cuentaId, invitacion\.empresas_permitidas\)/);
    expect((fn.match(/await sembrarTicks\(sb, cupoAceptacion\.cuentaId, user\.id, ticks\)/g) ?? []).length).toBe(2);
  });

  it("la persona nueva aterriza en una empresa que SÍ ve", () => {
    expect(fn).toMatch(/empresa_id: empresaInicial,/);
    expect(fn).not.toMatch(/empresa_id: invitacion\.empresa_id,/);
  });

  it("si sembrar los ticks falla, la fila de usuario nuevo no queda a medias", () => {
    expect(fn).toMatch(/if \(ticksError\) \{\s*await sb\.from\("cuenta_usuarios"\)\.delete\(\)[\s\S]*?await sb\.from\("usuarios"\)\.delete\(\)/);
  });

  it("los ticks de la fila se filtran contra las empresas que SIGUEN activas en la cuenta", () => {
    expect(src).toMatch(/return ids\.filter\(\(id\) => permitidas\.includes\(id\)\)/);
  });
});

describe("el popup: Team gris con upsell fuera de Business, activo adentro", () => {
  const brand = readFileSync(BRAND, "utf8");
  const section = readFileSync(SECTION, "utf8");

  it("EmpresaBrand recibe el estado del team y monta la sección", () => {
    expect(brand).toMatch(/team\?: TeamEstado \| null/);
    expect(brand).toMatch(/\{team && <TeamSection team=\{team\} \/>\}/);
  });

  it("sin equipo: una línea de upsell a /planes; con equipo: agregar solo si es titular y hay cupo", () => {
    expect(section).toMatch(/if \(!team\.equipo\) \{[\s\S]*?href="\/planes"/);
    expect(section).toMatch(/\{team\.esTitular && \([\s\S]*?disabled=\{quedan <= 0\}/);
  });

  it("el link de invitación se muestra una vez y avisa que no se vuelve a mostrar", () => {
    expect(section).toMatch(/no se vuelve a mostrar/);
  });
});
