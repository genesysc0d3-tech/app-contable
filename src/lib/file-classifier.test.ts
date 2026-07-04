import { describe, expect, it } from "vitest";
import {
  BADGE_COLORS,
  classifyFile,
  getCategoryColor,
  getCategoryLabel,
} from "./file-classifier";

// Construye File en memoria (sin tocar disco). Node 20+ trae File/Blob globales.
function makeFile(parts: BlobPart[], name: string, type: string): File {
  return new File(parts, name, { type });
}

function csvWithRows(n: number): File {
  const lines = Array.from(
    { length: n },
    (_, i) => `2026-06-14,desc ${i},${1000 * (i + 1)}`,
  );
  return makeFile([lines.join("\n")], "cartola.csv", "text/csv");
}

async function xlsxWithDataRows(n: number): Promise<File> {
  const { utils, write } = await import("xlsx");
  const aoa: string[][] = [["Fecha", "Glosa", "Monto"]];
  for (let i = 0; i < n; i++) {
    aoa.push(["14/06/2026", `desc ${i}`, String(1000 * (i + 1))]);
  }
  const ws = utils.aoa_to_sheet(aoa);
  const wb = utils.book_new();
  utils.book_append_sheet(wb, ws, "Hoja1");
  const buf = write(wb, { type: "array", bookType: "xlsx" }) as BlobPart;
  return makeFile(
    [buf],
    "cartola.xlsx",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  );
}

// xlsx con la PRIMERA hoja vacía (0 filas que contar). Con `withFiller` agrega
// una segunda hoja de relleno determinista que empuja el archivo > 500KB, para
// ejercitar el fallback por tamaño cuando no hay filas en la primera hoja.
async function emptyFirstSheetXlsx(withFiller: boolean): Promise<File> {
  const { utils, write } = await import("xlsx");
  const wb = utils.book_new();
  utils.book_append_sheet(wb, utils.aoa_to_sheet([]), "Primera");
  if (withFiller) {
    const filler: string[][] = [];
    for (let i = 0; i < 9000; i++) {
      filler.push([
        `${(i * 7919).toString(36)}x`,
        `${(i * 104729 + 13).toString(36)}y`,
        `${(i * 1299709).toString(36)}z`,
        String(i * 131 + 7),
      ]);
    }
    utils.book_append_sheet(wb, utils.aoa_to_sheet(filler), "Relleno");
  }
  const buf = write(wb, { type: "array", bookType: "xlsx" }) as BlobPart;
  return makeFile([buf], "cartola.xls", "application/vnd.ms-excel");
}

describe("classifyFile — imágenes (siempre 'imagen', sin leer contenido)", () => {
  it("jpeg / png / webp / heic → imagen", async () => {
    for (const type of ["image/jpeg", "image/png", "image/webp", "image/heic"]) {
      expect(await classifyFile(makeFile([""], "x", type))).toBe("imagen");
    }
  });
});

describe("classifyFile — PDF por tamaño (umbral 300KB)", () => {
  it("PDF chico (< 300KB) → chico", async () => {
    const f = makeFile([new Uint8Array(100 * 1024)], "doc.pdf", "application/pdf");
    expect(await classifyFile(f)).toBe("chico");
  });

  it("PDF grande (> 300KB) → grande", async () => {
    const f = makeFile([new Uint8Array(400 * 1024)], "doc.pdf", "application/pdf");
    expect(await classifyFile(f)).toBe("grande");
  });
});

describe("classifyFile — CSV por cantidad de filas (umbral 50)", () => {
  it("CSV con pocas filas → chico", async () => {
    expect(await classifyFile(csvWithRows(10))).toBe("chico");
  });

  it("CSV con > 50 filas → grande", async () => {
    expect(await classifyFile(csvWithRows(60))).toBe("grande");
  });

  it("ignora líneas en blanco al contar filas", async () => {
    // 3 filas reales rodeadas de líneas vacías → chico
    const f = makeFile(["a\n\n\nb\n\nc\n"], "x.csv", "text/csv");
    expect(await classifyFile(f)).toBe("chico");
  });
});

describe("classifyFile — Excel por filas parseadas (xlsx en memoria)", () => {
  it("Excel con > 50 filas → grande", async () => {
    expect(await classifyFile(await xlsxWithDataRows(60))).toBe("grande");
  });

  it("Excel con pocas filas → chico", async () => {
    expect(await classifyFile(await xlsxWithDataRows(5))).toBe("chico");
  });

  it("primera hoja vacía y archivo chico → chico (0 filas, bajo el umbral)", async () => {
    expect(await classifyFile(await emptyFirstSheetXlsx(false))).toBe("chico");
  });

  it("primera hoja vacía pero archivo > 500KB → grande (fallback por tamaño)", async () => {
    expect(await classifyFile(await emptyFirstSheetXlsx(true))).toBe("grande");
  });
});

describe("classifyFile — tipos desconocidos (fallback por tamaño, 500KB)", () => {
  it("chico", async () => {
    const f = makeFile([new Uint8Array(1024)], "x.bin", "application/octet-stream");
    expect(await classifyFile(f)).toBe("chico");
  });

  it("grande", async () => {
    const f = makeFile(
      [new Uint8Array(600 * 1024)],
      "x.bin",
      "application/octet-stream",
    );
    expect(await classifyFile(f)).toBe("grande");
  });
});

describe("etiquetas, colores y badges (mapeos puros)", () => {
  it("getCategoryLabel", () => {
    expect(getCategoryLabel("grande")).toBe("Documento grande");
    expect(getCategoryLabel("chico")).toBe("Documento");
    expect(getCategoryLabel("imagen")).toBe("Imagen");
  });

  it("getCategoryColor devuelve una clase distinta por categoría", () => {
    expect(getCategoryColor("grande")).toBe("text-[#E8553E]");
    expect(getCategoryColor("chico")).toBe("text-[#F59E0B]");
    expect(getCategoryColor("imagen")).toBe("text-[#22C55E]");
  });

  it("BADGE_COLORS cubre los índices 1..5", () => {
    expect(Object.keys(BADGE_COLORS)).toEqual(["1", "2", "3", "4", "5"]);
    expect(BADGE_COLORS[1]).toBe("bg-[#E8553E]");
  });
});
