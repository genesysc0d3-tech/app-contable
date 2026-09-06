import { describe, it, expect } from "vitest";
import { createVault } from "./tokenize";
import { sanitizarSalidaExterna, enmascararNombre, confianzaEnBalde } from "./borde-externo";
import { handleMcpRpc, type McpTools } from "../mcp/server";

const RUT = "76.086.428-5";
const NOMBRE = "Juan Pérez Soto";

describe("borde de salida — nada identificable sale hacia un modelo externo", () => {
  it("el RUT no viaja, pero la señal de que existe sí", () => {
    const out = sanitizarSalidaExterna({ receptor_rut: RUT, total: 50000 }) as Record<string, unknown>;
    expect(JSON.stringify(out)).not.toContain("76.086.428");
    // Sin esto el copiloto ve facturas bloqueadas y no entiende por qué.
    expect(out.receptor_rut_presente).toBe(true);
    expect(out.total).toBe(50000); // los números no se tocan
  });

  it("receptor sin RUT informa la ausencia (el bloqueo sigue siendo explicable)", () => {
    const out = sanitizarSalidaExterna({ receptor_rut: null }) as Record<string, unknown>;
    expect(out.receptor_rut_presente).toBe(false);
  });

  it("el nombre sale como etiqueta estable + versión reconocible", () => {
    const out = sanitizarSalidaExterna({ receptor_nombre: NOMBRE }) as Record<string, { etiqueta: string; visible: string }>;
    expect(out.receptor_nombre.visible).toBe("Juan P.");
    expect(out.receptor_nombre.etiqueta).toMatch(/^PER_\d+$/);
    expect(JSON.stringify(out)).not.toContain("Pérez");
  });

  it("la MISMA persona repetida recibe la MISMA etiqueta (señal de cliente repetido)", () => {
    const vault = createVault();
    const a = sanitizarSalidaExterna({ receptor_rut: RUT, receptor_nombre: NOMBRE }, vault) as Record<string, { etiqueta: string }>;
    const b = sanitizarSalidaExterna({ receptor_rut: RUT, receptor_nombre: NOMBRE }, vault) as Record<string, { etiqueta: string }>;
    expect(a.receptor_nombre.etiqueta).toBe(b.receptor_nombre.etiqueta);
  });

  it("la glosa cruda del banco sale tokenizada", () => {
    const out = sanitizarSalidaExterna({ descripcion: `TRANSFERENCIA DE ${NOMBRE} ${RUT}` }) as Record<string, string>;
    expect(out.descripcion).not.toContain("Pérez");
    expect(out.descripcion).not.toContain("76.086.428");
  });

  it("el contacto de terceros no viaja", () => {
    const out = sanitizarSalidaExterna({
      receptor_email: "juan@ejemplo.cl", receptor_telefono: "+56 9 1234 5678",
      receptor_direccion: "Calle Falsa 123", receptor_comuna: "Santiago",
    }) as Record<string, unknown>;
    expect(Object.keys(out)).toHaveLength(0);
  });

  it("los ids técnicos pasan intactos: el modelo los necesita para escribir", () => {
    const id = "3f5dedd1-ac48-4d1b-8f00-6084ffb8f7f2";
    const out = sanitizarSalidaExterna({ id, propuesta_id: id }) as Record<string, string>;
    expect(out.id).toBe(id);
    expect(out.propuesta_id).toBe(id);
  });

  it("un campo que NADIE clasificó igual se barre (deny-by-default)", () => {
    // Esta es la propiedad que protege lo que todavía no existe.
    const out = sanitizarSalidaExterna({ campo_inventado_manana: `ojo: ${RUT} y juan@ejemplo.cl` }) as Record<string, string>;
    expect(out.campo_inventado_manana).not.toContain("76.086.428");
    expect(out.campo_inventado_manana).not.toContain("juan@ejemplo.cl");
  });

  it("enmascararNombre deja reconocible sin identificar", () => {
    expect(enmascararNombre("Juan Pérez Soto")).toBe("Juan P.");
    expect(enmascararNombre("Comercial Andes SpA")).toBe("Comercial A.");
    expect(enmascararNombre("Madonna")).toBe("Madonna");
  });
});

describe("★ una herramienta NUEVA nace tapada aunque su autor no lo sepa", () => {
  // El corazón del arreglo: no prueba un caso, prueba la PROPIEDAD. Si alguien
  // borra el borde de server.ts, este test se pone rojo aunque las tools de hoy
  // no cambien.
  const toolRecienNacida: McpTools = {
    tool_recien_nacida: {
      def: {
        name: "tool_recien_nacida",
        description: "Una tool que un futuro yo escribió sin saber de este problema",
        inputSchema: { type: "object", properties: {} },
      },
      run: async () => ({
        items: [{ receptor_rut: RUT, receptor_nombre: NOMBRE, descripcion: `TRANSFERENCIA DE ${NOMBRE}`, mail: "juan@ejemplo.cl" }],
      }),
    },
  };

  it("el RUT, el nombre y el correo no llegan al modelo", async () => {
    const res = await handleMcpRpc(
      { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "tool_recien_nacida", arguments: {} } },
      toolRecienNacida,
    );
    const texto = JSON.stringify(res);
    expect(texto).not.toContain("76.086.428");
    expect(texto).not.toContain("Pérez");
    expect(texto).not.toContain("juan@ejemplo.cl");
  });

  it("el mensaje de ERROR de una tool también pasa por el borde", async () => {
    const rota: McpTools = {
      tool_rota: {
        def: { name: "tool_rota", description: "x", inputSchema: { type: "object", properties: {} } },
        run: async () => { throw new Error(`falló la fila de ${RUT}`); },
      },
    };
    const res = await handleMcpRpc(
      { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "tool_rota", arguments: {} } },
      rota,
    );
    expect(JSON.stringify(res)).not.toContain("76.086.428");
  });
});

/**
 * 2ª AUDITORÍA (2026-09-06) — tres hoyos verificados ejecutando el borde con un
 * item real, más la confianza en baldes. Estos casos MUERDEN: antes de la
 * corrección el nombre de archivo salía entero como "visible", un RUT escrito
 * en el campo nombre salía crudo, y el giro pasaba con la persona adentro.
 */
describe("borde — hoyos de la 2ª auditoría", () => {
  it("el nombre del archivo NO viaja: trae nombres y RUT que el tokenizador no pesca", () => {
    const out = sanitizarSalidaExterna({ documento_id: "11111111-1111-1111-1111-111111111111", documento_nombre: "cartola_juan_perez_76086428-5.xlsx", nombre_archivo: "x.xlsx" }) as Record<string, unknown>;
    expect(out).not.toHaveProperty("documento_nombre");
    expect(out).not.toHaveProperty("nombre_archivo");
    expect(out.documento_id).toBe("11111111-1111-1111-1111-111111111111"); // el id sí, para agrupar
  });

  it("un RUT pegado con guion bajo o punto también se barre (antes \\b no lo veía como borde)", () => {
    const out = sanitizarSalidaExterna({ detalle: "pago_76086428-5.final y 12.345.678-9 listo" }) as Record<string, string>;
    expect(out.detalle).not.toContain("76086428");
    expect(out.detalle).not.toContain("12.345.678");
    // El tokenizador de la bóveda pesca el RUT con puntos como PER_n; el
    // barrido pesca el pegado con guion bajo como [RUT]. Dos formas, dos RUT.
    expect(out.detalle.match(/\[RUT\]|PER_\d+/g)).toHaveLength(2);
  });

  it("un RUT escrito en el campo nombre no sale crudo en `visible`", () => {
    const out = sanitizarSalidaExterna({ receptor_rut: null, receptor_nombre: "76086428-5" }) as { receptor_nombre: { visible: string } };
    expect(out.receptor_nombre.visible).not.toContain("76086428");
    expect(out.receptor_nombre.visible).toContain("[RUT]");
  });

  it("el giro viaja solo como PRESENCIA: identifica a un proveedor único y el tokenizador no lo tapa", () => {
    const con = sanitizarSalidaExterna({ receptor_giro: "Asesorías Juan Pérez" }) as Record<string, unknown>;
    expect(con).not.toHaveProperty("receptor_giro");
    expect(con.receptor_giro_presente).toBe(true);
    const sin = sanitizarSalidaExterna({ receptor_giro: "" }) as Record<string, unknown>;
    expect(sin.receptor_giro_presente).toBe(false);
  });

  it("la confianza sale en baldes, nunca con decimales (los pesos no se despejan)", () => {
    const out = sanitizarSalidaExterna({ confianza_clasif: 0.83, otra_confianza: 0.5, baja: 0.1 }) as Record<string, unknown>;
    expect(out.confianza_clasif).toBe("alta");
    expect(out.otra_confianza).toBe("media");
    expect(out.baja).toBe(0.1); // no es una clave de confianza: número intacto
    expect(confianzaEnBalde(0.49)).toBe("baja");
    expect(confianzaEnBalde(0.8)).toBe("alta");
  });

  it("las razones del clasificador salen COMPLETAS a propósito (explicación, no receta)", () => {
    const razon = "Usuario marcó cartola como P2P cripto — activo incorporal, no IVA";
    const out = sanitizarSalidaExterna({ razones: [razon] }) as { razones: string[] };
    expect(out.razones[0]).toBe(razon);
  });
});
