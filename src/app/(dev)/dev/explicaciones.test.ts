/**
 * QUE EL PANEL NO PUEDA MENTIR.
 *
 * El panel /dev le explica al operador qué hace cada control antes de que lo
 * toque. Esa explicación es texto suelto en una página: nada la obliga a
 * seguir siendo verdad cuando cambie la regla en el server.
 *
 * No es una hipótesis. La primera versión de estos bloques nació con TRES
 * afirmaciones falsas el mismo día: prometía que la purga borra boletas
 * (el server la bloquea entera si hay una sola), que hay que tipear la razón
 * social (compara contra el nombre de la cuenta), y que una suscripción activa
 * pisa el plan "en el próximo evento de la pasarela" (lo pisa en cada lectura,
 * desde ya). Un cartel que promete de más es PEOR que no tener cartel: le
 * traslada la vigilancia del operador a un texto.
 *
 * Estos tests amarran cada afirmación a la regla que la sostiene. Si alguien
 * cambia la regla, el test cae y obliga a revisar el texto. No prueban que el
 * texto esté bien redactado: prueban que la realidad que describe sigue ahí.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const leer = (ruta: string) => readFileSync(ruta, "utf8");

const DETALLE = "src/app/(dev)/dev/cuentas/[cuentaId]/page.tsx";
const LISTA = "src/app/(dev)/dev/cuentas/page.tsx";
const ACTIONS = "src/app/(dev)/dev/actions.ts";
const PURGA = "src/lib/derechos/purga-cuenta.ts";
const ACTIVACION = "src/lib/pagos/activacion.ts";
const ENTITLEMENTS = "src/lib/entitlements.ts";
const DAL = "src/lib/dal.ts";
const SOPORTE = "src/lib/dev/support-mode.ts";

describe("lo que el panel promete sobre BORRAR LA CUENTA", () => {
  it("la purga se niega entera si hay boletas emitidas — y el texto lo avisa", () => {
    // La regla: freno duro por retención tributaria de 6 años.
    const purga = leer(PURGA);
    expect(purga).toContain("PURGA_BLOQUEADA");
    expect(purga).toContain("boletas_emitidas");
    // El texto: no puede prometer que borra boletas, tiene que avisar el freno.
    const texto = leer(DETALLE);
    expect(texto).toContain("la purga se niega entera");
    expect(texto).not.toMatch(/Borra empresas, cartolas, boletas/);
  });

  it("la confirmación compara contra el NOMBRE DE LA CUENTA, no la razón social", () => {
    // Si esto cambia a razon_social, el texto de la página queda al revés.
    expect(leer(ACTIONS)).toContain("confirmacion.trim() !== cuenta.nombre.trim()");
    expect(leer(DETALLE)).toContain("el nombre de la CUENTA");
  });

  it("el server devuelve el resumen de lo borrado y la UI lo muestra", () => {
    // Es la evidencia con la que se le responde al cliente en un ARCO.
    expect(leer(ACTIONS)).toContain("return { ok: true, resumen }");
    const botones = leer("src/app/(dev)/dev/cuentas/DevCuentaActions.tsx");
    expect(botones).toContain("res.resumen");
    expect(botones).toContain("auditChunks");
  });
});

describe("lo que el panel promete sobre CAMBIAR EL PLAN", () => {
  it("la suscripción viva manda en CADA lectura, no desde el próximo cobro", () => {
    expect(leer(ENTITLEMENTS)).toContain("suscripcionActiva ? suscripcion.plan_codigo");
    const texto = leer(DETALLE);
    expect(texto).toContain("su plan manda desde ya");
    expect(texto).not.toMatch(/el próximo evento de la pasarela pisa/);
  });

  it("con suscripción activa el control se deshabilita en vez de fingir que guardó", () => {
    expect(leer(DETALLE)).toContain("suscripcionActiva={suscripcionActiva}");
    expect(leer("src/app/(dev)/dev/cuentas/DevCuentaActions.tsx")).toContain("if (suscripcionActiva) {");
  });

  it("subir a un plan multiempresa REVIVE empresas dormidas — y el texto lo declara", () => {
    const activacion = leer(ACTIVACION);
    expect(activacion).toContain("fuera_de_plan");
    expect(activacion).toContain("empresa_operativa_elegida_at");
    expect(leer(DETALLE)).toContain("REVIVEN");
  });
});

describe("lo que el panel promete sobre TRAER UNA EMPRESA", () => {
  it("el titular del destino queda con acceso a la empresa — el texto no lo esconde", () => {
    expect(leer(ACTIONS)).toContain('rol: "titular"');
    expect(leer(DETALLE)).toContain("pasa a ver toda la historia de esa empresa");
  });

  it("desconecta los chats de Telegram, y eso se avisa", () => {
    expect(leer(ACTIONS)).toContain("telegram_chats");
    expect(leer(DETALLE)).toContain("Telegram");
  });

  it("exige plan multiempresa en el destino: por eso no hay vuelta", () => {
    expect(leer(ACTIONS)).toContain("no es multiempresa");
    expect(leer(DETALLE)).toContain("No hay vuelta por el panel");
  });

  it("el id que pide el formulario está a la vista en la ficha", () => {
    // Sin esto había que salir a buscarlo por SQL para usar el propio panel.
    expect(leer(DETALLE)).toContain("<CopiarButton valor={empresa.id}");
  });
});

describe("lo que el panel promete sobre EL TRIAL", () => {
  it("apagar el trial público corta a quien esté en su prueba AHORA", () => {
    expect(leer(DAL)).toContain("trialDisponibleCuenta");
    expect(leer(LISTA)).toContain("EN EL ACTO");
  });

  it("el trial global pide confirmación antes de cambiar la oferta de todos", () => {
    expect(leer("src/app/(dev)/dev/cuentas/DevCuentaActions.tsx")).toContain("Sí, cambiarlo");
  });
});

describe("lo que el panel promete sobre VER COMO CLIENTE", () => {
  it("escribe auditoría, así que NO puede anunciarse como zona de solo lectura", () => {
    expect(leer(ACTIONS)).toContain("modo_soporte_entrado");
    const texto = leer(DETALLE);
    expect(texto).not.toMatch(/Solo lectura\. Nada de lo que sigue cambia/);
    expect(texto).toContain("con una excepción");
  });

  it("la sesión de soporte dura 4 horas y el texto dice ese número", () => {
    expect(leer(SOPORTE)).toContain("maxAge: 60 * 60 * 4");
    expect(leer(DETALLE)).toContain("dura 4 horas");
  });
});

describe("la disciplina de fases sigue en pie", () => {
  const detalle = leer(DETALLE);

  it("los controles que escriben van después de su Fase, nunca antes", () => {
    const actuar = detalle.indexOf('id="actuar"');
    const peligro = detalle.indexOf('id="peligro"');
    expect(actuar).toBeGreaterThan(0);
    expect(peligro).toBeGreaterThan(actuar);
    expect(detalle.indexOf("<PlanToggle")).toBeGreaterThan(actuar);
    expect(detalle.indexOf("<TrialCortesiaToggle")).toBeGreaterThan(actuar);
    // Los dos sin vuelta atrás, bajo la fase roja.
    expect(detalle.indexOf("<MigrarEmpresaForm")).toBeGreaterThan(peligro);
    expect(detalle.indexOf("<PurgarCuentaButton")).toBeGreaterThan(peligro);
  });

  it("el borrado es el último control de la página", () => {
    const purgar = detalle.indexOf("<PurgarCuentaButton");
    for (const control of ["<PlanToggle", "<TrialCortesiaToggle", "<MigrarEmpresaForm"]) {
      expect(detalle.indexOf(control)).toBeLessThan(purgar);
    }
  });

  it("cada control que escribe tiene su Explica", () => {
    // Cuatro bloques Explica: ver como cliente, plan, prueba, traer, borrar.
    const explicas = detalle.match(/<Explica/g) ?? [];
    expect(explicas.length).toBe(5);
  });

  it("hay atajos a las fases: ordenar en vertical sin atajo solo aleja", () => {
    expect(detalle).toContain('href="#actuar"');
    expect(detalle).toContain('href="#peligro"');
    expect(detalle).toContain('position: "sticky"');
  });
});

describe("el idioma de la casa", () => {
  it("nada de voseo rioplatense en el panel", () => {
    const archivos = [
      DETALLE,
      LISTA,
      ACTIONS,
      "src/app/(dev)/dev/cuentas/DevCuentaActions.tsx",
      "src/app/(dev)/dev/diagnostico/page.tsx",
      "src/app/(dev)/dev/ui.tsx",
    ];
    // Imperativos y presentes rioplatenses que ya se colaron alguna vez.
    //
    // Sin `\b`: la palabra termina en vocal acentuada y `\b` la trata como
    // NO-letra, así que el borde nunca ocurre y la regla pasaba de largo con
    // «verificá» delante. Comprobado rompiéndolo. Van lookarounds explícitos.
    const voseo = /(?<![a-záéíóúñ])(escribí|revisá|mirá|fijate|tipeá|verificá|entrá|poné|acordate|tenés|podés|querés|sabés)(?![a-záéíóúñ])/i;
    for (const ruta of archivos) {
      const encontrado = leer(ruta).match(voseo);
      expect(encontrado ? `${ruta}: ${encontrado[0]}` : null).toBeNull();
    }
  });
});
