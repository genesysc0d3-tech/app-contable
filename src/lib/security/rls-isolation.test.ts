// RLS cross-tenant isolation test (integration).
//
// Proves that an authenticated user from account/empresa A cannot read account
// B's data through the public (anon) client — i.e. RLS denies cross-tenant reads.
// This is the boundary a static scanner cannot verify.
//
// SKIPS automatically unless the test environment is configured, so it never
// breaks CI or local unit runs. To actually run it, create two disposable test
// users on a NON-PROD database and set:
//
//   NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY  (or SUPABASE_*)
//   RLS_TEST_A_EMAIL / RLS_TEST_A_PASSWORD   (user in empresa A)
//   RLS_TEST_B_EMAIL / RLS_TEST_B_PASSWORD   (user in empresa B)
//   RLS_TEST_B_EMPRESA_ID                    (a known empresa id owned by B)
//
// Then: npm run test -- src/lib/security/rls-isolation.test.ts

import { describe, it, expect, beforeAll } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url =
  process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || "";
const anon =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  process.env.SUPABASE_ANON_KEY ||
  "";
const A = {
  email: process.env.RLS_TEST_A_EMAIL || "",
  password: process.env.RLS_TEST_A_PASSWORD || "",
};
const B = {
  email: process.env.RLS_TEST_B_EMAIL || "",
  password: process.env.RLS_TEST_B_PASSWORD || "",
};
const bEmpresaId = process.env.RLS_TEST_B_EMPRESA_ID || "";

// Guard: never let this run against an obvious production host by accident.
const looksProd = /aluuuyecwifaakehvcam/.test(url);

const configured =
  !!url &&
  !!anon &&
  !!A.email &&
  !!A.password &&
  !!B.email &&
  !!B.password &&
  !!bEmpresaId &&
  !looksProd;

(configured ? describe : describe.skip)(
  "RLS cross-tenant isolation (empresa A cannot read empresa B)",
  () => {
    let clientA: SupabaseClient;

    beforeAll(async () => {
      clientA = createClient(url, anon);
      const { error } = await clientA.auth.signInWithPassword({
        email: A.email,
        password: A.password,
      });
      if (error) throw new Error(`sign-in as A failed: ${error.message}`);
    });

    it("does not return B's empresa when listing empresas", async () => {
      const { data, error } = await clientA.from("empresas").select("id");
      expect(error).toBeNull();
      const ids = (data ?? []).map((r) => r.id as string);
      expect(ids).not.toContain(bEmpresaId);
    });

    it("returns empty when querying B's empresa by id", async () => {
      const { data, error } = await clientA
        .from("empresas")
        .select("id")
        .eq("id", bEmpresaId);
      expect(error).toBeNull();
      expect(data ?? []).toHaveLength(0);
    });

    it("returns no boletas belonging to B's empresa", async () => {
      const { data, error } = await clientA
        .from("boletas_emitidas")
        .select("id, empresa_id")
        .eq("empresa_id", bEmpresaId);
      expect(error).toBeNull();
      expect(data ?? []).toHaveLength(0);
    });
  },
);
