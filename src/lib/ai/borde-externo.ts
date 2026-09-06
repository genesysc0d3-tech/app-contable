/**
 * EL BORDE: lo único que se ve hacia afuera.
 *
 * Todo lo que sale de massDTE hacia un modelo que no controlamos (hoy: el
 * conector MCP hacia el Claude/ChatGPT del cliente) pasa por acá y sale con la
 * identidad de terceros tapada. La política publicada lo promete en esas
 * palabras: "antes de que el texto de tus movimientos salga de nuestro
 * servidor, el nombre y el RUT de tus contrapartes se reemplazan por una
 * etiqueta sin identidad".
 *
 * POR QUÉ ACÁ Y NO EN CADA RUTA (2026-09-04): la seudonimización existía desde
 * antes, pero cableada dentro del processor. Cuando nació el segundo camino
 * hacia una IA —el conector— nadie se acordó de llamarla, y el RUT de las
 * contrapartes viajó crudo a un tercero durante semanas. Un control que depende
 * de que cada programador se acuerde ya falló, solo que todavía no te enteras.
 * Por eso este módulo se aplica en el ÚNICO punto donde la salida se serializa
 * (lib/mcp/server.ts), es deny-by-default, y un campo que nadie clasificó se
 * trata como sospechoso en vez de dejarlo pasar. Un canal futuro nace tapado
 * aunque su autor no sepa que este problema existe.
 *
 * Lo que NO hace: no toca la base, no toca lo que ve el dueño en su propia app
 * (la mesa necesita los nombres reales), y no toca lo que se emite al SII (una
 * boleta a nombre de "PERSONA_1" sería un documento tributario inválido).
 */
import { createVault, tokenizeForAI, tokenizarIdentidad, type Vault } from "./tokenize";

/** Identificadores del titular: jamás salen. Se reemplazan por un booleano. */
const CLAVE_RUT = /(^|_)(rut|cedula|dni)(_|$)/i;
/** Nombres de persona/empresa: salen como etiqueta estable + versión enmascarada. */
const CLAVE_NOMBRE = /(^|_)(nombre|razon_social|contraparte)(_|$)/i;
/** Contacto de terceros: no le sirve al copiloto para nada. */
const CLAVE_CONTACTO = /(^|_)(email|correo|telefono|fono|direccion|comuna|ciudad)(_|$)/i;
/** Texto libre que puede traer identidad adentro (glosa del banco, notas). */
const CLAVE_TEXTO = /(^|_)(descripcion|glosa|detalle|notas|motivo|observacion|summary|mensaje)(_|$)/i;
/**
 * NO VIAJAN, punto (2ª auditoría, 2026-09-06). El nombre del archivo lo
 * escribe el cliente y trae nombres y RUT ("cartola_juan_perez_76086428-5"),
 * y el tokenizador de texto libre no pesca nombres en minúscula ni pegados
 * con guion bajo. El asistente no lo necesita: tiene `documento_id`.
 */
const CLAVE_NO_VIAJA = /(^|_)(nombre_archivo|documento_nombre)(_|$)/i;
/**
 * Solo la PRESENCIA, como el RUT: "Asesorías Juan Pérez" identifica a un
 * proveedor único de un rubro chico, y el tokenizador no lo tapa (no hay
 * preposición). La señal "falta el giro" sí le sirve al copiloto.
 */
const CLAVE_GIRO = /(^|_)giro(_|$)/i;
/** Confianza del clasificador: sale en BALDES, no con decimales (ver abajo). */
const CLAVE_CONFIANZA = /(^|_)confianza(_|$)/i;
/** Identificadores técnicos: pasan intactos (el modelo los necesita para escribir). */
const CLAVE_ID = /(^|_)id(s)?(_|$)/i;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Barrido de último recurso para strings que nadie clasificó. */
// Sin `\b`: para la regex `_` es letra, así que "_76086428-5." no tenía borde y
// el RUT pegado en un nombre de archivo se escapaba (2ª auditoría). Los
// lookarounds cuentan cualquier cosa que no sea dígito/letra como borde.
const RUT_SUELTO = /(?<![0-9A-Za-z])\d{1,3}(?:\.\d{3})*-[\dkK](?![0-9A-Za-z])|(?<![0-9A-Za-z])\d{7,8}-[\dkK](?![0-9A-Za-z])/g;
const EMAIL_SUELTO = /\b[\w.%+-]+@[\w.-]+\.[a-z]{2,}\b/gi;
const TELEFONO_SUELTO = /\b(?:\+?56)?\s?9\s?\d{4}\s?\d{4}\b/g;

/**
 * Nombre reconocible pero no identificante: "Juan Pérez Soto" → "Juan P.".
 * El dueño reconoce de quién le hablan; el tercero no queda expuesto.
 */
export function enmascararNombre(nombre: string): string {
  const partes = nombre.trim().split(/\s+/).filter(Boolean);
  if (partes.length === 0) return "";
  const primera = partes[0];
  if (partes.length === 1) return primera;
  return `${primera} ${partes[1][0].toUpperCase()}.`;
}

function barrerIdentificadores(valor: string): string {
  return valor
    .replace(RUT_SUELTO, "[RUT]")
    .replace(EMAIL_SUELTO, "[correo]")
    .replace(TELEFONO_SUELTO, "[teléfono]");
}

function limpiarTextoLibre(valor: string, vault: Vault): string {
  return barrerIdentificadores(tokenizeForAI(valor, vault));
}

/**
 * La confianza del clasificador sale en tres baldes, no en 0.83 (2026-09-06,
 * decisión del fundador tras la 2ª auditoría). Con decimales es aritmética
 * invertible — confianza = votos/total con pesos constantes — y en 3.000 filas
 * se despejan los pesos de cada ángulo: eso son los "pesos del modelo". Al
 * cliente no le sirve 0.83 vs 0.85; sí le sirve alta/media/baja. Las RAZONES,
 * en cambio, salen completas a propósito: son la explicación, no la receta
 * (lo que haría Anthropic: publicar el razonamiento, guardar los pesos).
 */
export function confianzaEnBalde(v: number): "alta" | "media" | "baja" {
  if (v >= 0.8) return "alta";
  if (v >= 0.5) return "media";
  return "baja";
}

/**
 * Sanea recursivamente el valor que va a salir. `vault` se comparte en toda la
 * respuesta para que la misma persona repetida reciba la MISMA etiqueta: el
 * copiloto sigue viendo "este cliente aparece cinco veces" sin saber quién es.
 */
export function sanitizarSalidaExterna(valor: unknown, vault: Vault = createVault()): unknown {
  if (valor === null || valor === undefined) return valor;
  if (typeof valor === "number" || typeof valor === "boolean") return valor;
  if (typeof valor === "string") return limpiarTextoLibre(valor, vault);
  if (Array.isArray(valor)) return valor.map((v) => sanitizarSalidaExterna(v, vault));
  if (typeof valor !== "object") return null; // función, symbol: no sale nada raro

  const entrada = valor as Record<string, unknown>;
  const salida: Record<string, unknown> = {};
  // El RUT se lee ANTES de recorrer, para que la etiqueta del nombre agrupe por
  // RUT (dos "Juan Pérez" con RUT distinto son dos personas distintas).
  const rutDelObjeto = (() => {
    for (const [k, v] of Object.entries(entrada)) {
      if (CLAVE_RUT.test(k) && typeof v === "string" && v.trim()) return v.trim();
    }
    return null;
  })();

  for (const [clave, v] of Object.entries(entrada)) {
    if (CLAVE_ID.test(clave) || (typeof v === "string" && UUID_RE.test(v))) {
      salida[clave] = v; // ids técnicos: el modelo los necesita para escribir
      continue;
    }
    if (CLAVE_RUT.test(clave)) {
      // El dato no sale, pero la SEÑAL sí: sin esto el copiloto ve facturas
      // "bloqueadas por falta de RUT" y no entiende por qué.
      salida[`${clave}_presente`] = typeof v === "string" ? v.trim().length > 0 : v != null;
      continue;
    }
    if (CLAVE_CONTACTO.test(clave)) continue; // no le sirve a la IA: no viaja
    if (CLAVE_NO_VIAJA.test(clave)) continue;  // nombre de archivo: nombres y RUT adentro
    if (CLAVE_GIRO.test(clave)) {
      salida[`${clave}_presente`] = typeof v === "string" ? v.trim().length > 0 : v != null;
      continue;
    }
    if (CLAVE_CONFIANZA.test(clave) && typeof v === "number") {
      salida[clave] = confianzaEnBalde(v);
      continue;
    }
    // TEXTO va ANTES que NOMBRE a propósito: un campo de texto cuyo nombre
    // termine en "nombre" caería en la regla de persona (2ª auditoría).
    if (CLAVE_TEXTO.test(clave)) {
      salida[clave] = typeof v === "string" ? limpiarTextoLibre(v, vault) : sanitizarSalidaExterna(v, vault);
      continue;
    }
    if (CLAVE_NOMBRE.test(clave)) {
      if (typeof v !== "string" || !v.trim()) { salida[clave] = null; continue; }
      salida[clave] = {
        etiqueta: tokenizarIdentidad(vault, rutDelObjeto, v),
        // `visible` también se barre: alguien escribe el RUT en el campo nombre
        // ("76086428-5") y antes salía crudo como "nombre visible".
        visible: barrerIdentificadores(enmascararNombre(v)),
      };
      continue;
    }
    salida[clave] = sanitizarSalidaExterna(v, vault);
  }
  return salida;
}
