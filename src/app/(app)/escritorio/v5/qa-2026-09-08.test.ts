import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

/**
 * Recorrido como usuario en dos cuentas (Start/Paula y Business/Genesys),
 * 2026-09-08. Lo que se cazó y lo que este censo sostiene.
 */
const V5 = "src/app/(app)/escritorio/v5/";
const leer = (p: string) => readFileSync(p, "utf8");

describe("recorrido 2026-09-08", () => {
  it("sin logo (API 204) el brand muestra el nombre, no el alt del <img>", () => {
    const src = leer(V5 + "EmpresaBrand.tsx");
    expect(src).toMatch(/fetch\(logoUrl, \{ method: "HEAD", credentials: "same-origin" \}\)/);
    expect(src).toMatch(/if \(vivo && \(r\.status === 204 \|\| r\.status === 404\)\) setLogoOk\(false\);/);
  });

  it("el pie del wizard dice 'Siguiente' hasta el último de los 9 pasos", () => {
    const src = leer(V5 + "EmpresaPopup.tsx");
    const pasos = (src.match(/\{ key: "[a-z]+", content: </g) ?? []).length;
    expect(pasos).toBe(9);
    expect(src).toMatch(/\{step < 8 \? \(/);
  });

  it("nada de 'App Contable' en la config de emisión ni en Folios", () => {
    expect(leer("src/app/(app)/empresa/EmissionProviderConfig.tsx")).not.toMatch(/App Contable/);
    expect(leer("src/app/(app)/empresa/CAFPanel.tsx")).not.toMatch(/App Contable/);
  });

  it("boleta única: el EXENTO no puede desbloquear afecta; el afecto sí (mixto)", () => {
    const src = leer(V5 + "EmitirDirectaView.tsx");
    expect(src).toMatch(/\{hasEmpresaLock && isExento && \(\s*<span title="Como contribuyente exento no puedes emitir afecta/);
    expect(src).toMatch(/\{hasEmpresaLock && !isExento && \(\s*<button\s*onClick=\{\(\) => setTipoDesbloqueado/);
  });

  it("Escape cierra el modal de emisión directa cuando no hay pre-vuelo ni autorización", () => {
    const src = leer(V5 + "EmitirDirectaView.tsx");
    expect(src).toMatch(/if \(confirmOpen \|\| legalPrompt \|\| emitBusy\) return;\s*const onKey = \(e: KeyboardEvent\) => \{ if \(e\.key === "Escape"\) onClose\?\.\(false\); \};/);
  });

  it("historial: una propuesta aprobada dice 'Aprobada', no 'Por revisar'", () => {
    const src = leer(V5 + "SearchHistoryView.tsx");
    expect(src).toMatch(/aprobado: \{ label: "Aprobada"/);
    expect(src).toMatch(/editado: \{ label: "Editada"/);
  });

  it("Facturación y uso se precarga al abrir el wizard y cachea 60 s; reintentar la salta", () => {
    const fact = leer(V5 + "FacturacionUsoPanel.tsx");
    expect(fact).toMatch(/export function precargarFacturacion\(fresco = false\)/);
    expect(fact).toMatch(/const FACT_CACHE_MS = 60_000;/);
    expect(fact).toMatch(/void cargar\(true\);/);
    expect(leer(V5 + "EmpresaPopup.tsx")).toMatch(/void precargarConectoresMcp\(\); void precargarFacturacion\(\); \}, 1500\)/);
  });
});
