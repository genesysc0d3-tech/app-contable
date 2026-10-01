import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Censo de la migración de avisos: el RLS es la ÚLTIMA línea (el cliente marca
// "visto" directo contra Supabase, sin pasar por Vercel). Lo que se sostiene:
// lectura solo de vigentes y de SU empresa, vistos solo propios, escritura de
// avisos solo service role (= /dev con guard), y vuelta atrás completa.

const MIG = "supabase/migrations/20261001120000_avisos_app.sql";
const DOWN = "supabase/migrations/20261001120000_avisos_app_DOWN.sql";
const sql = readFileSync(MIG, "utf8");
const politica = (nombre: string) => {
  const i = sql.indexOf(`create policy ${nombre}`);
  expect(i, nombre).toBeGreaterThan(-1);
  return sql.slice(i, sql.indexOf(";", i));
};

describe("tablas", () => {
  it("avisos_app con tipos, formatos, popup solo urgente, rango válido y audiencia", () => {
    expect(sql).toMatch(/create table if not exists public\.avisos_app/);
    expect(sql).toMatch(/tipo text not null check \(tipo in \('novedad', 'mantencion', 'urgente'\)\)/);
    expect(sql).toMatch(/formato text not null check \(formato in \('toast', 'tarjeta', 'popup'\)\)/);
    expect(sql).toMatch(/check \(formato <> 'popup' or tipo = 'urgente'\)/);
    expect(sql).toMatch(/check \(hasta > desde\)/);
    expect(sql).toMatch(/empresa_ids uuid\[\]/);
    expect(sql).toMatch(/mesa text check \(mesa in \('boletas', 'facturas'\)\)/);
    expect(sql).toMatch(/version_min text/);
  });

  it("índice parcial por vigencia (la única consulta de la app)", () => {
    expect(sql).toMatch(/create index if not exists idx_avisos_app_vigentes\s+on public\.avisos_app \(hasta, desde\)\s+where activo/);
  });

  it("avisos_vistos: PK (aviso, usuario) = visto UNA vez en cualquier computador", () => {
    expect(sql).toMatch(/create table if not exists public\.avisos_vistos/);
    expect(sql).toMatch(/primary key \(aviso_id, user_id\)/);
    expect(sql).toMatch(/aviso_id uuid not null references public\.avisos_app\(id\) on delete cascade/);
    expect(sql).toMatch(/user_id uuid not null default auth\.uid\(\) references auth\.users\(id\) on delete cascade/);
  });
});

describe("RLS", () => {
  it("ambas tablas con RLS", () => {
    expect(sql).toMatch(/alter table public\.avisos_app enable row level security/);
    expect(sql).toMatch(/alter table public\.avisos_vistos enable row level security/);
  });

  it("lectura de avisos: solo activos, vigentes y de la empresa autorizada (o para todas)", () => {
    const p = politica("avisos_app_lectura_vigentes");
    expect(p).toMatch(/for select\s+to authenticated/);
    expect(p).toMatch(/activo/);
    expect(p).toMatch(/desde <= now\(\)/);
    expect(p).toMatch(/hasta > now\(\)/);
    expect(p).toMatch(/empresa_ids is null or \(select public\.empresa_autorizada\(\)\) = any\(empresa_ids\)/);
  });

  it("nadie fuera del service role escribe avisos; B3: se revoca TODO (también references/trigger/maintain)", () => {
    expect(sql).not.toMatch(/on public\.avisos_app\s+for (insert|update|delete|all)/);
    expect(sql).toMatch(/revoke all on public\.avisos_app from anon, authenticated;/);
    expect(sql).toMatch(/revoke all on public\.avisos_vistos from anon, authenticated;/);
    expect(sql).not.toMatch(/grant (all|insert|update|delete)[^;]*on public\.avisos_app/);
  });

  it("B1: la clienta lee SOLO columnas mínimas (sin creado_por ni empresa_ids de otras empresas)", () => {
    const g = /grant select \(([^)]*)\) on public\.avisos_app to authenticated;/.exec(sql);
    expect(g).not.toBeNull();
    const cols = g![1].split(",").map((c) => c.trim());
    expect(cols).toEqual(expect.arrayContaining(["id", "tipo", "titulo", "cuerpo", "formato", "desde", "hasta", "mesa", "version_min", "activo"]));
    expect(cols).not.toContain("creado_por");
    expect(cols).not.toContain("empresa_ids");
    expect(sql).not.toMatch(/grant select on public\.avisos_app to authenticated/);
  });

  it("vistos: cada uno lee y marca SOLO lo suyo, y solo avisos que puede ver", () => {
    const lee = politica("avisos_vistos_lectura_propios");
    expect(lee).toMatch(/for select\s+to authenticated/);
    expect(lee).toMatch(/user_id = \(select auth\.uid\(\)\)/);
    const marca = politica("avisos_vistos_marcar_propios");
    expect(marca).toMatch(/for insert\s+to authenticated/);
    expect(marca).toMatch(/user_id = \(select auth\.uid\(\)\)/);
    // el EXISTS corre con el RLS de quien llama: solo avisos vigentes de su audiencia
    expect(marca).toMatch(/exists \(select 1 from public\.avisos_app a where a\.id = aviso_id\)/);
    expect(sql).toMatch(/grant select, insert on public\.avisos_vistos to authenticated;/);
    expect(sql).not.toMatch(/grant [^;]*(update|delete)[^;]*on public\.avisos_vistos/);
  });
});

describe("vuelta atrás", () => {
  it("el _DOWN borra ambas tablas (vistos primero)", () => {
    const down = readFileSync(DOWN, "utf8");
    const iv = down.indexOf("drop table if exists public.avisos_vistos");
    const ia = down.indexOf("drop table if exists public.avisos_app");
    expect(iv).toBeGreaterThan(-1);
    expect(ia).toBeGreaterThan(iv);
  });
});
