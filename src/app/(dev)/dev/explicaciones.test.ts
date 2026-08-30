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
    // Se afirma la INTENCIÓN, no la redacción: el texto tiene que decir que la
    // suscripción manda YA. Atarlo a una frase exacta hacía caer el test con
    // cualquier mejora de estilo, y un test frágil termina relajado.
    expect(texto).toMatch(/desde ya/);
    expect(texto).not.toMatch(/el próximo evento de la pasarela pisa/);
    expect(texto).not.toMatch(/aparece deshabilitado/);
  });

  /**
   * Este test nació al revés y por eso se deja explicado.
   *
   * La primera versión ESCONDÍA el control cuando había suscripción activa, y
   * este test defendía ese escondite. Estaba mal: `setCuentaPlan` no solo fija
   * el código de plan —que sí lo pisa la pasarela—, también sincroniza
   * `empresas.plan_activo` y revive las empresas dormidas, que no las recalcula
   * nadie. Esconderlo reconstruía el incidente del 2026-08-28: una cuenta
   * Business ACTIVA con una empresa marcada "bloqueada", el problema a la vista
   * y la solución fuera de alcance.
   *
   * Ahora se afirma lo contrario: el control se queda, y avisa.
   */
  it("con suscripción activa el control NO se esconde: avisa y sigue disponible", () => {
    const botones = leer("src/app/(dev)/dev/cuentas/DevCuentaActions.tsx");
    expect(leer(DETALLE)).toContain("suscripcionActiva={suscripcionActiva}");
    // El escondite de la primera versión: un return temprano que se comía el form.
    expect(botones).not.toMatch(/if \(suscripcionActiva\) \{\s*\n\s*return \(/);
    // Y el botón sigue existiendo pase lo que pase.
    expect(botones).toContain("Guardar el plan de");
    expect(botones).toContain("revive las que");
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

  it("la regla del destino es CUPO con plan activo, no multiempresa (divorcio 2026-08-31)", () => {
    // El server dejó de exigir plan multiempresa: una empresa puede mudarse a
    // un Start/Pro vacío (el socio que se separa). Al Pro lleno lo sigue
    // defendiendo el conteo de cupo, dormidas incluidas.
    const actions = leer(ACTIONS);
    expect(actions).not.toContain("no es multiempresa");
    expect(actions).toContain("Sin cupo en el destino");
    expect(actions).toContain("no tiene un plan activo");
    // Y el texto promete exactamente eso, sin la regla vieja.
    const texto = leer(DETALLE);
    expect(texto).toContain("cupo libre en el destino");
    expect(texto).not.toContain("exige plan multiempresa");
  });

  it("los logins del origen se re-apuntan solo si le queda otra empresa — y el texto no promete más", () => {
    const actions = leer(ACTIONS);
    expect(actions).toContain("loginsReapuntados");
    expect(actions).toContain("runbook-login-huerfano");
    expect(leer(DETALLE)).toContain("se re-apuntan solos");
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
    // Cinco bloques Explica: ver como cliente, plan, prueba, traer, borrar.
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
      // Acá viven los textos del "siguiente paso", que es lo más visible del
      // panel. Faltaba en esta lista: se podía escribir voseo ahí y salir a
      // producción con el test en verde.
      "src/lib/dev/account-360.ts",
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

/**
 * LA SEÑAL QUE FALTABA.
 *
 * El 2026-08-30 un login quedó apuntando a una empresa que se había migrado a
 * otra cuenta. La app lo mandaba a /bloqueado, pero la RLS cuelga de
 * `usuarios.empresa_id` con policies FOR ALL: con su propio token leía, escribía
 * y borraba 375 movimientos y 42 cartolas de un tenant ajeno.
 *
 * El panel no lo mostraba, y no por descuido: arma la lista de personas desde
 * `cuenta_usuarios`, así que un huérfano es invisible POR CONSTRUCCIÓN. Se
 * descubrió por una auditoría. Estos tests existen para que la próxima vez lo
 * diga la pantalla.
 */
describe("el panel ve los logins colgados", () => {
  const fuente = leer("src/lib/dev/account-360.ts");

  it("busca usuarios por empresa, no solo por membresía de cuenta", () => {
    // La consulta que ve al huérfano: parte de las empresas, no del equipo.
    expect(fuente).toContain('.in("empresa_id", empresaIds)');
    expect(fuente).toContain("!usuarios.has(u.id)");
  });

  it("lo reporta como ERROR, no como advertencia", () => {
    // Es acceso a datos de otro tenant: no es un "conviene revisar".
    expect(fuente).toMatch(/huerfanos\.length === 0[\s\S]{0,200}codigo: "error"/);
  });

  it("enmascara el correo del huérfano, como todo lo demás del panel", () => {
    expect(fuente).toContain("huerfanos.map((u) => maskEmail(u.email))");
  });

  it("la señal explica que el bloqueo de la app NO alcanza", () => {
    // El veto corta la app, no la base. Si el texto dijera que basta con
    // vetarlo, mentiría — y es exactamente el error que se cometió ese día.
    expect(fuente).toContain("aunque la app lo");
  });
});
