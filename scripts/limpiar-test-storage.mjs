#!/usr/bin/env node
import { createClient } from "@supabase/supabase-js";

const commit = process.argv.includes("--commit");
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  console.error("Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en el entorno.");
  console.error("Para dry-runs SQL puedes usar Supabase MCP como fallback. Para listar/borrar objetos reales de Storage, este script necesita esas env vars exportadas; el MCP no expone service role ni borra objetos del bucket.");
  process.exit(1);
}

const supabase = createClient(url, key);

const PAGE_SIZE = 1000;

function storagePathFromProveedorRespuesta(value) {
  if (!value || typeof value !== "object") return null;
  const pdf = value.pdf;
  if (!pdf || typeof pdf !== "object") return null;
  return typeof pdf.storage_path === "string" ? pdf.storage_path : null;
}

function isStorageObjectPath(path) {
  return Boolean(path)
    && typeof path === "string"
    && path !== "memoria"
    && !path.includes("://");
}

async function fetchAll(table, select) {
  const rows = [];
  for (let from = 0;; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from(table)
      .select(select)
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE_SIZE) break;
  }
  return rows;
}

async function fetchByIds(table, select, column, ids) {
  const uniqueIds = [...new Set(ids.filter(Boolean))];
  const rows = [];
  for (let index = 0; index < uniqueIds.length; index += PAGE_SIZE) {
    const chunk = uniqueIds.slice(index, index + PAGE_SIZE);
    const { data, error } = await supabase
      .from(table)
      .select(select)
      .in(column, chunk);
    if (error) throw error;
    rows.push(...(data ?? []));
  }
  return rows;
}

function boletaIdFromProgresoIa(value) {
  if (!value || typeof value !== "object") return null;
  return typeof value.boleta_id === "string" ? value.boleta_id : null;
}

async function loadCandidatePaths() {
  const docs = await fetchAll("documentos_subidos", "id, storage_path, progreso_ia");

  const { data: boletasMock, error: boletasError } = await supabase
    .from("boletas_emitidas")
    .select("id, proveedor_respuesta")
    .eq("emision_proveedor", "mock");
  if (boletasError) throw boletasError;

  const boletasNoMock = await fetchAll("boletas_emitidas", "id, propuesta_id, emision_proveedor, proveedor_respuesta");
  const preservedBoletas = boletasNoMock.filter((boleta) => boleta.emision_proveedor !== "mock");
  const preservedBoletaIds = new Set(preservedBoletas.map((boleta) => boleta.id));
  const preservedStoragePaths = new Set(
    preservedBoletas
      .map((boleta) => storagePathFromProveedorRespuesta(boleta.proveedor_respuesta))
      .filter(isStorageObjectPath),
  );
  const preservedPropuestas = await fetchByIds(
    "propuestas_ia",
    "id, movimiento_id",
    "id",
    preservedBoletas.map((boleta) => boleta.propuesta_id),
  );
  const preservedMovimientos = await fetchByIds(
    "movimientos_raw",
    "id, documento_id",
    "id",
    preservedPropuestas.map((propuesta) => propuesta.movimiento_id),
  );
  const preservedDocIds = new Set(preservedMovimientos.map((movimiento) => movimiento.documento_id).filter(Boolean));
  for (const doc of docs ?? []) {
    const boletaId = boletaIdFromProgresoIa(doc.progreso_ia);
    if (boletaId && preservedBoletaIds.has(boletaId)) preservedDocIds.add(doc.id);
  }

  const paths = [];
  for (const doc of docs ?? []) {
    if (!preservedDocIds.has(doc.id) && isStorageObjectPath(doc.storage_path) && !preservedStoragePaths.has(doc.storage_path)) {
      paths.push(doc.storage_path);
    }
  }
  for (const boleta of boletasMock ?? []) {
    const path = storagePathFromProveedorRespuesta(boleta.proveedor_respuesta);
    if (isStorageObjectPath(path) && !preservedStoragePaths.has(path)) paths.push(path);
  }

  return [...new Set(paths)].sort();
}

async function removeInChunks(paths) {
  const chunkSize = 100;
  let removed = 0;
  for (let index = 0; index < paths.length; index += chunkSize) {
    const chunk = paths.slice(index, index + chunkSize);
    const { error } = await supabase.storage.from("documentos").remove(chunk);
    if (error) throw error;
    removed += chunk.length;
  }
  return removed;
}

const paths = await loadCandidatePaths();
console.log(`Modo: ${commit ? "COMMIT" : "DRY-RUN"}`);
console.log(`Objetos candidatos en bucket documentos: ${paths.length}`);
for (const path of paths) console.log(path);

if (!commit) {
  console.log("No se borró nada. Ejecuta con --commit después de revisar la lista.");
  process.exit(0);
}

const removed = await removeInChunks(paths);
console.log(`Objetos solicitados para borrado: ${removed}`);
