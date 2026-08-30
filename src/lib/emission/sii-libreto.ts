// LIBRETO del portal de facturas (33/34) como DATOS.
//
// Extiende el precedente de `start_url` en factura-job-payload.ts: los nombres
// de formulario/campo, los regex de detección de página, los códigos y las
// esperas del portal del SII viajan EN EL JOB para poder arreglar un cambio del
// SII con un deploy de la app, sin pasar por la Chrome Web Store.
//
// Los valores acá son EXACTAMENTE los que hoy tiene hardcodeados
// `extensions/sii-portal-rpa/facturas-worker.js` (pura mudanza, verificado
// carácter por carácter contra la fuente viva). El worker los leerá con
// FALLBACK al literal actual, así que sin libreto (o con un campo faltante) su
// conducta es byte-idéntica.
//
// LÍMITE DELIBERADO — datos = nombres, código = coreografía:
// el libreto es un CATÁLOGO DE NOMBRES, no un intérprete. Toda la lógica de
// control (orden, el RUT que se pone una sola vez, los 3 reintentos, POST vs
// AJAX, la pausa por giro) se queda como código en el worker. Y NUNCA baja al
// libreto la seguridad: el match fail-closed del emisor, el candado
// anti-doble-folio, el TOTAL_MISMATCH y la evidencia del folio son código
// nativo; el libreto solo les da el NOMBRE del control que tocan.

export const LIBRETO_SCHEMA_VERSION = 1 as const;

export interface FacturaLibreto {
  libreto_version: number;
  portal: "sii_facturas_gratuito";
  /** Nombres de <form> que anclan cada página (los usa pageKind para clasificar). */
  forms: {
    preview: string;
    formulario: string;
    selector_empresa: string;
  };
  /** Detectores de página por texto (regex source, se compilan con flag "i"). */
  detectores: {
    login: string;
    firma: string;
    exito_a: string;
    exito_b: string;
  };
  /** Nombres de campo (`name=`) del portal, por rol estable del worker. */
  campos: {
    emisor_select: string; // <select> de empresa en el popup
    tipo_verif: string; // hidden con el tipo de DTE, para la verificación cruzada
    rut_recep: string;
    dv_recep: string;
    razon_soc_recep: string;
    dir_recep: string;
    comuna_recep: string;
    ciudad_recep: string;
    giro_recep: string;
    contacto: string;
    comuna_origen: string;
    ciudad_origen: string;
    razon_soc_emisor: string;
    giro_emisor: string;
    fecha_emision: string;
    forma_pago: string;
    detalle_nombre: string;
    detalle_cantidad: string;
    detalle_precio: string;
    glosa_checkbox: string;
    glosa_textarea: string;
    monto_total: string;
    boton_validar: string;
    boton_firmar: string;
  };
  /** Selectores CSS sueltos (los que no se resuelven por `name=`). */
  selectores: {
    submit_empresa: string;
    pdf_link: string;
  };
  /** Códigos de valor que espera el portal. */
  codigos: {
    forma_pago: { contado: string; credito: string };
  };
  /** Esperas/timeouts en ms (cada una es un tiempo que hoy está sembrado inline). */
  esperas: {
    submit_empresa_cinturon: number;
    razon_recep: number;
    respiro_post_recep: number;
    reintento_override: number;
    glosa_textarea: number;
    total_portal: number;
  };
}

/** El libreto de producción: espejo exacto del hardcode del worker (2026-08-30). */
export const FACTURA_LIBRETO: FacturaLibreto = {
  libreto_version: LIBRETO_SCHEMA_VERSION,
  portal: "sii_facturas_gratuito",
  forms: {
    preview: "PreViewDTE", // facturas-worker.js:150,340
    formulario: "VIEW_EFXP", // :151,237
    selector_empresa: "fPrmEmpPOP", // :152,182
  },
  detectores: {
    login: "clave\\s+tributaria|iniciar\\s+sesi|autenticaci", // :161
    firma: "certificado|firma", // :162
    exito_a: "ENVIADO\\s+EXITOSAMENTE", // :168
    exito_b: "DOCUMENTO\\s+TRIBUTARIO", // :168
  },
  campos: {
    emisor_select: "RUT_EMP", // :183
    tipo_verif: "PTDC_CODIGO", // :238,348
    rut_recep: "EFXP_RUT_RECEP", // :217,253,256
    dv_recep: "EFXP_DV_RECEP", // :254,257
    razon_soc_recep: "EFXP_RZN_SOC_RECEP", // :218,262,282
    dir_recep: "EFXP_DIR_RECEP", // :219,283
    comuna_recep: "EFXP_CMNA_RECEP", // :220,284
    ciudad_recep: "EFXP_CIUDAD_RECEP", // :221,285
    giro_recep: "EFXP_GIRO_RECEP", // :222,286,303
    contacto: "EFXP_CONTACTO", // :287
    comuna_origen: "EFXP_CMNA_ORIGEN", // :215,280
    ciudad_origen: "EFXP_CIUDAD_ORIGEN", // :216,279
    razon_soc_emisor: "EFXP_RZN_SOC", // :213 (solo preValidar)
    giro_emisor: "EFXP_GIRO_EMIS", // :214 (solo preValidar)
    fecha_emision: "EFXP_FCH_EMIS", // :226,277
    forma_pago: "EFXP_FMA_PAGO", // :227,292
    detalle_nombre: "EFXP_NMB_01", // :223,288
    detalle_cantidad: "EFXP_QTY_01", // :224,289
    detalle_precio: "EFXP_PRC_01", // :225,290
    glosa_checkbox: "DESCRIP_01", // :314
    glosa_textarea: "EFXP_DSC_ITEM_01", // :316
    monto_total: "EFXP_MNT_TOTAL", // :323,343
    boton_validar: "Button_Update", // :333
    boton_firmar: "btnSign", // :369
  },
  selectores: {
    submit_empresa: 'button[type="submit"], input[type="submit"]', // :193
    pdf_link: 'a[href*="mipeDisplayPDF.cgi"]', // :426
  },
  codigos: {
    forma_pago: { contado: "1", credito: "2" }, // :292
  },
  esperas: {
    submit_empresa_cinturon: 2500, // :200
    razon_recep: 8000, // :262
    respiro_post_recep: 700, // :267
    reintento_override: 600, // :298
    glosa_textarea: 3000, // :316
    total_portal: 6000, // :322
  },
};

// Qué significa cada ancla, en cristiano. Cuando el worker avisa "falló esta
// ancla del portal", el panel /dev traduce el rol técnico (ej.
// "campos.boton_validar") a una frase que se entiende sin mirar el código. Solo
// describe el PUNTO del portal del SII (público), nunca datos del cliente.
export const ANCLA_LABELS: Record<string, string> = {
  "forms.selector_empresa": "la pantalla donde eliges bajo qué empresa emites",
  "forms.formulario": "la página del formulario de la factura",
  "forms.preview": "la vista previa antes de firmar",
  "campos.emisor_select": "el selector de empresa (dónde eliges tu RUT emisor)",
  "campos.tipo_verif": "el campo del tipo de documento (33 o 34)",
  "campos.rut_recep": "la casilla del RUT del receptor",
  "campos.boton_validar": "el botón «Validar y visualizar» del formulario",
  "campos.boton_firmar": "el botón «Firmar» de la vista previa",
  "selectores.submit_empresa": "el botón para enviar la empresa elegida",
  "page_kind:unknown": "la página no calzó con ninguna pantalla conocida del portal",
};

// ── BOLETAS: libreto del portal e-Boleta (Vuetify) ──────────────────────────
// Mismo principio que FACTURA_LIBRETO: catálogo de nombres del portal como
// DATO, con fallback al hardcode en el worker (byte-idéntico). Los valores son
// ESPEJO EXACTO de extensions/sii-portal-rpa/sii-worker.js, verificados contra
// la fuente viva. Datos = nombres; la coreografía y la SEGURIDAD (match del
// emisor, candado, evidencia del folio) son CÓDIGO.
//
// ALCANCE deliberado de la v1: NO baja al libreto el detector de "monto alto"
// ni la confirmación/folio post-emit (alto acoplamiento — un libreto malo ahí
// cuelga el modal). Esos quedan hardcodeados, igual que facturas dejó la
// evidencia del folio. El libreto cubre lo que el SII efectivamente renombra:
// botones, slots, opciones, toggles y los selectores Vuetify.

export const BOLETA_LIBRETO_SCHEMA_VERSION = 1 as const;

export interface BoletaLibreto {
  libreto_version: number;
  portal: "eboleta_vuetify";
  /** Clases CSS de Vuetify — único vocabulario de selector permitido (whitelist). */
  selectores: {
    dialogo_activo: string;
    slot: string;
    menu: string;
    opcion: string;
    toggle_row: string;
    toggle_click: string;
    emisor_selecciones: string;
    emisor_select: string;
    input_container: string;
  };
  botones: { emitir: string; limpiar_pad: string[] };
  /** Textos de slot v-select + opciones elegibles. */
  slots: {
    sucursal: string;
    tipo: string;
    tipo_afecta: string;
    tipo_exenta: string;
    metodo_pago: string;
    metodo_pago_alt: string;
    metodo_pago_default: string;
  };
  toggles: { detalle: string; receptor: string };
  /** Regex source (flag "i") para hallar los campos del receptor en el modal. */
  receptor_campos: { rut: string; nombre: string; direccion: string; email: string; telefono: string };
  /** Timeouts en ms (cada uno hoy sembrado inline). */
  esperas: {
    modal_emision: number;
    emisor_estable: number;
    emisores_listos: number;
    emit_habilitado: number;
    glosa_aparece: number;
    glosa_escribe: number;
    pad_post: number;
  };
}

export const BOLETA_LIBRETO: BoletaLibreto = {
  libreto_version: BOLETA_LIBRETO_SCHEMA_VERSION,
  portal: "eboleta_vuetify",
  selectores: {
    dialogo_activo: ".v-dialog.v-dialog--active", // sii-worker.js:531
    slot: ".v-select__slot, .v-input__slot", // :475
    menu: ".v-menu__content", // :485
    opcion: ".v-list-item, [role='option'], .v-list__tile", // :488
    toggle_row: ".v-input--selection-controls, .v-input--switch, .v-input", // :557
    toggle_click: ".v-input--selection-controls__ripple, .v-input--selection-controls__input, label", // :565
    emisor_selecciones: ".v-select__selections", // :637
    emisor_select: ".v-select", // :682
    input_container: ".v-input", // :586
  },
  botones: {
    emitir: "EMITIR", // :1068,1102
    limpiar_pad: ["C", "CE", "AC", "BORRAR"], // :1087
  },
  slots: {
    sucursal: "elija sucursal", // :1115
    tipo: "Boleta", // :1129
    tipo_afecta: "Boleta afecta", // :1128
    tipo_exenta: "Boleta exenta", // :1128
    metodo_pago: "metodo de pago", // :1137
    metodo_pago_alt: "elija metodo", // :1138
    metodo_pago_default: "Efectivo", // :1136
  },
  toggles: {
    detalle: "Detalle", // :1153
    receptor: "Receptor", // :1181
  },
  receptor_campos: {
    rut: "RUT.*RECEPTOR|RECEPTOR.*RUT|RUT\\s*CON\\s*DV", // :1194
    nombre: "NOMBRE.*RECEPTOR|RECEPTOR.*NOMBRE", // :1198
    direccion: "DIRECCION.*RECEPTOR|RECEPTOR.*DIRECCION", // :1199
    email: "(E-?MAIL|CORREO).*RECEPTOR|RECEPTOR.*(E-?MAIL|CORREO)", // :1200
    telefono: "(TELEFONO|FONO|CELULAR).*RECEPTOR|RECEPTOR.*(TELEFONO|FONO|CELULAR)", // :1201
  },
  esperas: {
    modal_emision: 12000, // :541
    emisor_estable: 6000, // :649
    emisores_listos: 9000, // :671
    emit_habilitado: 12000, // :772
    glosa_aparece: 150, // :1159
    glosa_escribe: 120, // :1165
    pad_post: 250, // :1100
  },
};

// Qué significa cada ancla de BOLETAS, en cristiano (para el panel /dev).
export const ANCLA_LABELS_BOLETA: Record<string, string> = {
  "selectores.emisor_select": "el selector de empresa arriba (bajo qué RUT emites)",
  "selectores.dialogo_activo": "el modal «Emitir e-Boleta»",
  "botones.emitir": "el botón EMITIR",
  "slots.tipo": "el desplegable del tipo de boleta (afecta o exenta)",
  "slots.metodo_pago": "el desplegable del método de pago",
  "toggles.detalle": "el interruptor «Detalle» (la glosa de la boleta)",
  "toggles.receptor": "el interruptor «Receptor»",
  "page_kind:unknown": "la pantalla no calzó con ninguna conocida de e-Boleta",
};

/**
 * Traduce un rol de ancla a su explicación (facturas Y boletas); si no está
 * mapeado, devuelve el rol. El panel /dev lo usa para el bloque "Portal SII".
 */
export function describeAncla(rol: string | null | undefined): string {
  const k = String(rol ?? "").trim();
  return ANCLA_LABELS[k] ?? ANCLA_LABELS_BOLETA[k] ?? (k || "un punto del portal");
}
