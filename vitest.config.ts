import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Solo el alias "@/" de tsconfig (paths). Todo lo demás queda en los defaults de
// vitest: sin esto, un test que importa src/lib/ai/processor.ts no resuelve
// "@/lib/sii/…" (primer caso: truncamiento-particion.test.ts, 2026-09-26).
export default defineConfig({
  resolve: {
    alias: { "@/": fileURLToPath(new URL("./src/", import.meta.url)) },
  },
});
