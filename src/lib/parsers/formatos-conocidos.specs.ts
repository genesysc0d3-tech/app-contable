// GENERADO por scripts/corpus-cartolas/derivar-conocidos.ts desde las specs reales (solo estructura). No editar a mano.
import type { FormatoDeSpec } from "./formatos-conocidos";

export const FORMATOS_DE_SPECS: FormatoDeSpec[] = [
  {
    "id": "bancochile-cartola-historica",
    "banco": "Banco de Chile",
    "familia": "Banco de Chile 'CartolaHistorica' (Resumen del Periodo arriba, celdas combinadas, cargos y saldo en texto)",
    "titulos": [
      "fecha",
      "",
      "sucursal",
      "",
      "",
      "descripcion",
      "",
      "n° documento",
      "",
      "cheques y otros cargos",
      "depositos y abono",
      "saldo diario"
    ],
    "roles": [
      "fecha",
      "ignorar",
      "ignorar",
      "ignorar",
      "ignorar",
      "descripcion",
      "ignorar",
      "n_documento",
      "ignorar",
      "cargo",
      "abono",
      "saldo"
    ],
    "marcas": [
      "cartola de cuenta corriente",
      "empresa",
      "ejecutivo",
      "n° de cuenta",
      "periodo",
      "oficina",
      "resumen del periodo",
      "saldo anterior",
      "total cargos y cheques",
      "total abonos y depositos",
      "saldo contable final del periodo",
      "retenciones",
      "saldo disponible",
      "movimientos cuenta corriente"
    ],
    "fecha_sin_anio": false,
    "flag": null,
    "resumen_en_hoja": null
  },
  {
    "id": "bancoestado-chequera-completa",
    "banco": "BancoEstado",
    "familia": "BancoEstado Chequera Electrónica completa (Cheques / Cargos | Depósitos / Abonos | Saldo)",
    "titulos": [
      "fecha",
      "sucursal",
      "n° cuenta",
      "alias",
      "n° cartola",
      "n° operacion",
      "descripcion",
      "cheques / cargos",
      "depositos / abonos",
      "saldo"
    ],
    "roles": [
      "fecha",
      "ignorar",
      "ignorar",
      "ignorar",
      "ignorar",
      "n_documento",
      "descripcion",
      "cargo",
      "abono",
      "saldo"
    ],
    "marcas": [],
    "fecha_sin_anio": true,
    "flag": null,
    "resumen_en_hoja": "Resumen"
  },
  {
    "id": "bancoestado-chequera-solo-abonos",
    "banco": "BancoEstado",
    "familia": "BancoEstado Chequera Electrónica (hoja Resumen + hoja Movimientos, solo 'Depósitos / Abonos')",
    "titulos": [
      "fecha",
      "sucursal",
      "n° cuenta",
      "alias",
      "n° cartola",
      "n° operacion",
      "descripcion",
      "depositos / abonos"
    ],
    "roles": [
      "fecha",
      "ignorar",
      "ignorar",
      "ignorar",
      "ignorar",
      "n_documento",
      "descripcion",
      "monto"
    ],
    "marcas": [],
    "fecha_sin_anio": true,
    "flag": null,
    "resumen_en_hoja": "Resumen"
  },
  {
    "id": "bancoestado-fechas-compactas",
    "banco": "BancoEstado",
    "familia": "BancoEstado CuentaRUT con fechas '20260923' y '02/09' sin año",
    "titulos": [
      "fecha",
      "n° operacion",
      "descripcion",
      "cargos",
      "abonos",
      "saldo"
    ],
    "roles": [
      "fecha",
      "n_documento",
      "descripcion",
      "cargo",
      "abono",
      "saldo"
    ],
    "marcas": [
      "cuentarut"
    ],
    "fecha_sin_anio": false,
    "flag": null,
    "resumen_en_hoja": null
  },
  {
    "id": "bci-detallado-invertido",
    "banco": "BCI",
    "familia": "BCI Detallado con columnas en orden de Banco de Chile (cargo a la izquierda) y hash como primera columna de texto",
    "titulos": [
      "fecha de transaccion",
      "codigo de transaccion",
      "glosa detalle",
      "ingreso (+)",
      "egreso (-)",
      "saldo contable"
    ],
    "roles": [
      "fecha",
      "ignorar",
      "descripcion",
      "abono",
      "cargo",
      "saldo"
    ],
    "marcas": [],
    "fecha_sin_anio": false,
    "flag": null,
    "resumen_en_hoja": null
  },
  {
    "id": "bci-movimientos-detallado",
    "banco": "BCI",
    "familia": "BCI 'Movimientos Detallado' (Ingreso antes que Egreso, hash de glosa)",
    "titulos": [
      "fecha de transaccion",
      "hora transaccion",
      "fecha contable",
      "codigo de transaccion",
      "codigo transferencia",
      "tipo de transaccion",
      "numero serie",
      "glosa detalle",
      "ingreso (+)",
      "egreso (-)",
      "saldo contable",
      "nombre",
      "rut",
      "n° de cuenta",
      "tipo de cuenta",
      "banco",
      "correo electronico",
      "comentario transferencia",
      "servicio",
      "n° cliente",
      "empresa",
      "tipo de compra",
      "rubro",
      "comuna",
      "tipo de movimiento",
      "nº de tarjeta"
    ],
    "roles": [
      "fecha",
      "ignorar",
      "ignorar",
      "ignorar",
      "n_documento",
      "ignorar",
      "ignorar",
      "descripcion",
      "abono",
      "cargo",
      "saldo",
      "ignorar",
      "ignorar",
      "ignorar",
      "ignorar",
      "ignorar",
      "ignorar",
      "ignorar",
      "ignorar",
      "ignorar",
      "ignorar",
      "ignorar",
      "ignorar",
      "ignorar",
      "ignorar",
      "ignorar"
    ],
    "marcas": [],
    "fecha_sin_anio": false,
    "flag": null,
    "resumen_en_hoja": null
  },
  {
    "id": "bci-transferencias-recibidas",
    "banco": "BCI",
    "familia": "BCI transferencias recibidas (Ingreso (+) + TOTAL)",
    "titulos": [
      "fecha de transaccion",
      "codigo transferencia",
      "ingreso (+)",
      "nombre",
      "rut",
      "servicio",
      "n° cliente",
      "empresa",
      "tipo de compra",
      "rubro",
      "comuna",
      "tipo de movimiento",
      "nº de tarjeta"
    ],
    "roles": [
      "fecha",
      "n_documento",
      "monto",
      "descripcion",
      "ignorar",
      "ignorar",
      "ignorar",
      "ignorar",
      "ignorar",
      "ignorar",
      "ignorar",
      "ignorar",
      "ignorar"
    ],
    "marcas": [],
    "fecha_sin_anio": false,
    "flag": null,
    "resumen_en_hoja": null
  },
  {
    "id": "bice-estado-de-cuenta-solo-abonos",
    "banco": "BICE",
    "familia": "BICE 'ESTADO DE CUENTA' editada: solo ABONOS y SALDO FINAL",
    "titulos": [
      "fecha",
      "documento",
      "codigo",
      "descripcion",
      "abonos"
    ],
    "roles": [
      "fecha",
      "n_documento",
      "ignorar",
      "descripcion",
      "monto"
    ],
    "marcas": [
      "estado de cuenta",
      "nombre del cliente",
      "cuenta",
      "fecha desde",
      "fecha hasta",
      "movimientos de la cuenta"
    ],
    "fecha_sin_anio": false,
    "flag": null,
    "resumen_en_hoja": null
  },
  {
    "id": "bice-estado-de-cuenta",
    "banco": "BICE",
    "familia": "BICE 'ESTADO DE CUENTA' (FECHA DESDE/HASTA, FECHA yyyymmdd en texto, SALDO INICIAL/FINAL abajo)",
    "titulos": [
      "fecha",
      "documento",
      "codigo",
      "descripcion",
      "cargos",
      "abonos"
    ],
    "roles": [
      "fecha",
      "n_documento",
      "ignorar",
      "descripcion",
      "cargo",
      "abono"
    ],
    "marcas": [
      "estado de cuenta",
      "nombre del cliente",
      "cuenta",
      "fecha desde",
      "fecha hasta",
      "movimientos de la cuenta"
    ],
    "fecha_sin_anio": false,
    "flag": null,
    "resumen_en_hoja": null
  },
  {
    "id": "mis-movimientos-completa",
    "banco": "BCI (Mis Movimientos)",
    "familia": "'Mis Movimientos' completa (egresos+ingresos+saldo)",
    "titulos": [
      "fecha transaccion",
      "fecha contable",
      "descripcion",
      "egreso (-)",
      "ingreso (+)",
      "saldo"
    ],
    "roles": [
      "fecha",
      "ignorar",
      "descripcion",
      "cargo",
      "abono",
      "saldo"
    ],
    "marcas": [
      "mis movimientos"
    ],
    "fecha_sin_anio": false,
    "flag": null,
    "resumen_en_hoja": null
  },
  {
    "id": "mis-movimientos-solo-ingresos",
    "banco": "BCI (Mis Movimientos)",
    "familia": "'Mis Movimientos' (BIT/BCI) filtrada a ingresos, sin saldo",
    "titulos": [
      "fecha transaccion",
      "fecha contable",
      "descripcion",
      "egreso (-)",
      "ingreso (+)"
    ],
    "roles": [
      "fecha",
      "ignorar",
      "descripcion",
      "cargo",
      "abono"
    ],
    "marcas": [
      "mis movimientos"
    ],
    "fecha_sin_anio": false,
    "flag": null,
    "resumen_en_hoja": null
  },
  {
    "id": "santander-movimientos-ctacte",
    "banco": "Santander",
    "familia": "Santander 'Movimientos CtaCte' (MONTO + CARGO/ABONO + SALDO, 11 filas de metadatos)",
    "titulos": [
      "monto",
      "descripcion movimiento",
      "fecha",
      "saldo",
      "n° documento",
      "sucursal",
      "cargo/abono",
      "n° movimiento"
    ],
    "roles": [
      "monto",
      "descripcion",
      "fecha",
      "saldo",
      "n_documento",
      "ignorar",
      "flag",
      "n_documento"
    ],
    "marcas": [
      "detalle de movimientos de cuenta corriente",
      "sr. (a):",
      "fecha:",
      "empresa:",
      "hora:",
      "rut empresa:",
      "datos cuenta",
      "moneda: pesos de chile",
      "datos ejecutivo",
      "detalle movimientos"
    ],
    "fecha_sin_anio": false,
    "flag": {
      "entrada": "A",
      "salida": "C"
    },
    "resumen_en_hoja": null
  }
];

/** Specs que NO quedaron como formato conocido, y por qué. */
export const SPECS_EXCLUIDAS: Record<string, string> = {
  "cartola-cuenta-corriente-simple": "títulos genéricos (Fecha|Descripción|Cargos|Abonos|Saldo) y rótulo genérico: los comparten varios bancos",
  "cartola-simple-fecha-tipo-saldo": "títulos genéricos (Fecha|Descripcion|Monto|Tipo|Saldo) sin rótulos del banco",
  "clp-bs-montos-como-fecha": "planilla casera sin títulos",
  "clp-bs-planilla-casera": "planilla casera sin títulos",
  "me-planilla-fecha-monto-comision": "planilla casera (Fecha|Monto|Comisión), sin banco",
  "plantilla-massdte-boletas": "plantilla massDTE: ya tiene su propia capa (firma exacta)",
  "santander-3-columnas-editada": "export editado por la clienta: MONTO sin columna de dirección",
  "bci-mes-actual-xls": "export editado por la clienta (solo 'Abono EXENTAS'): sin evidencia del export original del banco",
  "mis-movimientos-solo-ingresos-con-saldo": "mismo formato que mis-movimientos-completa",
  "santander-movimientos-ctacte-completa": "mismo formato que santander-movimientos-ctacte"
};
