import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { COLORES_TEAM, colorDeMiembro } from "./team-colores";

/**
 * Chat del team (Team Business fase 3, 2026-09-06). Reglas firmadas que este
 * censo sostiene: (1) apuntar un objeto exige que el RECEPTOR vea esa empresa
 * — se valida en el servidor y la referencia no se guarda; (2) el chat vive a
 * nivel cuenta, solo lo leen los dos de la conversación, y no entra a la
 * publicación realtime de la mesa; (3) el aviso manda: los colores del team
 * excluyen el semáforo; (4) el salto pide permiso; (5) soporte no escribe.
 */
const MIG = "supabase/migrations/20260906200000_team_mensajes.sql";
const ACTIONS = "src/app/(app)/escritorio/v5/actions.ts";
const ORBE = "src/app/(app)/escritorio/v5/GuardarailOrbe.tsx";
const HOOK = "src/app/(app)/escritorio/v5/useTeamChat.ts";
const CONTROLLER = "src/app/(app)/escritorio/v5/MesaController.tsx";

describe("la tabla team_mensajes", () => {
  const sql = readFileSync(MIG, "utf8");

  it("RLS: solo leen remitente y destinatario, y solo siendo miembro activo de la cuenta; nadie escribe por PostgREST", () => {
    expect(sql).toMatch(/enable row level security/);
    expect(sql).toMatch(/\(select auth\.uid\(\)\) = de_usuario_id or \(select auth\.uid\(\)\) = para_usuario_id/);
    expect(sql).toMatch(/cu\.activo/);
    expect(sql).not.toMatch(/for (insert|update|delete|all)/);
  });

  it("NO entra a la publicación realtime (cada mensaje vaciaría la caché de la mesa de todos)", () => {
    expect(sql).not.toMatch(/supabase_realtime/);
    expect(sql).not.toMatch(/replica identity/i);
  });

  it("el objeto apuntado viaja completo o no viaja; texto y label con tope", () => {
    expect(sql).toMatch(/team_mensajes_objeto_completo/);
    expect(sql).toMatch(/char_length\(texto\) between 1 and 1000/);
    expect(sql).toMatch(/char_length\(objeto_label\) <= 120/);
  });

  it("21.719: cae con la cuenta; si se borra un miembro el hilo queda sin autor, no se pierde", () => {
    expect(sql).toMatch(/cuenta_id uuid not null references public\.cuentas\(id\) on delete cascade/);
    expect(sql).toMatch(/de_usuario_id uuid references public\.usuarios\(id\) on delete set null/);
  });
});

describe("enviarMensajeTeam: la regla del fundador, en el servidor", () => {
  const src = readFileSync(ACTIONS, "utf8");
  const fn = src.slice(src.indexOf("export async function enviarMensajeTeam"), src.indexOf("export async function marcarLeidosTeam"));

  it("con objeto apuntado, valida que el RECEPTOR vea esa empresa ANTES de insertar — y el texto es el del fundador", () => {
    const check = fn.indexOf("No puedes compartir esto con esa persona");
    const insert = fn.indexOf('.from("team_mensajes")');
    expect(check).toBeGreaterThan(-1);
    expect(insert).toBeGreaterThan(check);
    expect(fn).toMatch(/puedeVerEmpresa\(ctx\.sb, acceso\.cuentaId, para, empresaId\)/);
  });

  it("también exige que quien manda la vea, que la empresa sea de la cuenta y que el documento exista en ella", () => {
    expect(fn).toMatch(/puedeVerEmpresa\(ctx\.sb, acceso\.cuentaId, ctx\.userId, empresaId\)/);
    expect(fn).toMatch(/from\("cuenta_empresas"\)[\s\S]*?\.eq\("empresa_id", empresaId\)\.eq\("activa", true\)/);
    expect(fn).toMatch(/from\("documentos_subidos"\)\.select\("id"\)\.eq\("id", objetoId\)\.eq\("empresa_id", empresaId\)/);
  });

  it("el receptor tiene que ser miembro ACTIVO de la misma cuenta; nadie se escribe a sí mismo", () => {
    expect(fn).toMatch(/from\("cuenta_usuarios"\)[\s\S]*?\.eq\("usuario_id", para\)[\s\S]*?\.eq\("activo", true\)/);
    expect(fn).toMatch(/para === ctx\.userId/);
  });

  it("soporte mira, no habla por el cliente", () => {
    expect(fn).toMatch(/if \(ctx\.supportMode\) return \{ ok: false/);
  });

  it("la lectura trae solo lo mío (remitente o destinatario) y acotado", () => {
    const lectura = src.slice(src.indexOf("export async function mensajesTeam"), src.indexOf("export async function enviarMensajeTeam"));
    expect(lectura).toMatch(/\.or\(`de_usuario_id\.eq\.\$\{ctx\.userId\},para_usuario_id\.eq\.\$\{ctx\.userId\}`\)/);
    expect(lectura).toMatch(/\.limit\(MENSAJES_MAX\)/);
  });
});

describe("el globito: el aviso manda", () => {
  const orbe = readFileSync(ORBE, "utf8");

  it("los colores del team excluyen verde, ámbar y rojo (el semáforo tributario)", () => {
    for (const c of COLORES_TEAM) {
      const hex = c.toLowerCase();
      expect(["#22c55e", "#16a34a", "#f59e0b", "#d97706", "#ef4444", "#dc2626"]).not.toContain(hex);
    }
    expect(colorDeMiembro(0)).toBe(COLORES_TEAM[0]);
    expect(colorDeMiembro(COLORES_TEAM.length)).toBe(COLORES_TEAM[0]);
    expect(colorDeMiembro(-1)).toBe(COLORES_TEAM[COLORES_TEAM.length - 1]);
  });

  it("con pendientes, el badge es el número de pendientes (nunca los mensajes) y se abre en modo aviso", () => {
    expect(orbe).toMatch(/const badge = hayAvisos \? total : chat\.noLeidos/);
    expect(orbe).toMatch(/setModo\(hayAvisosRef\.current \? \{ tipo: "avisos" \} : \{ tipo: "lobby" \}\)/);
  });

  it("al cerrar vuelve solo a modo aviso; el satélite abre la conversación directo", () => {
    expect(orbe).toMatch(/function cerrar\(\) \{ setOpen\(false\); setModo\(\{ tipo: "avisos" \}\); \}/);
    expect(orbe).toMatch(/if \(s\.satelite\) \{[\s\S]*?setModo\(\{ tipo: "conv", con: s\.satelite \}\)/);
  });

  it("el salto pide permiso y guarda dónde estabas para volver", () => {
    expect(orbe).toMatch(/window\.confirm\(`¿Ir a «\$\{obj\.label\}»[\s\S]*?Termina o guarda lo que estás haciendo\.`\)/);
    expect(orbe).toMatch(/sessionStorage\.setItem\("massdte:volver"/);
    expect(orbe).toMatch(/sessionStorage\.setItem\("massdte:salto"/);
  });

  it("sin pendientes y sin team, el globito no existe", () => {
    expect(orbe).toMatch(/const existe = hayAvisos \|\| teamOn;[\s\S]*?if \(!existe\) return null;/);
  });

  it("la entrega es por poll + foco (patrón de la casa), no por realtime", () => {
    const hook = readFileSync(HOOK, "utf8");
    expect(hook).toMatch(/setInterval/);
    expect(hook).toMatch(/addEventListener\("focus"/);
    expect(hook).not.toMatch(/\.channel\(/);
  });

  it("el salto que cruza de empresa se consume UNA vez al montar la mesa", () => {
    const c = readFileSync(CONTROLLER, "utf8");
    expect(c).toMatch(/sessionStorage\.getItem\("massdte:salto"\)[\s\S]*?sessionStorage\.removeItem\("massdte:salto"\)[\s\S]*?massdte:open-doc/);
  });
});
