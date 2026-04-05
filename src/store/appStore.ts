import { create } from "zustand";
import type { DocumentoSubido } from "@/lib/upload";

const STALE_MS = 30_000; // 30 seconds

// --- Slice types ---

interface CacheSlice<T> {
  data: T | null;
  lastFetched: number;
  isFresh: () => boolean;
}

interface SubirSlice {
  documentos: CacheSlice<DocumentoSubido[]>;
  setDocumentos: (docs: DocumentoSubido[]) => void;
  updateDocumento: (doc: DocumentoSubido) => void;
  addDocumento: (doc: DocumentoSubido) => void;
}

interface RevisarSlice {
  propuestas: CacheSlice<unknown[]>;
  clientes: CacheSlice<unknown[]>;
  setPropuestas: (data: unknown[]) => void;
  setRevisarClientes: (data: unknown[]) => void;
}

interface ClientesSlice {
  clientesList: CacheSlice<unknown[]>;
  setClientesList: (data: unknown[]) => void;
}

interface ResumenSlice {
  resumen: CacheSlice<unknown>;
  historico: CacheSlice<unknown[]>;
  setResumen: (data: unknown) => void;
  setHistorico: (data: unknown[]) => void;
}

interface InvalidateSlice {
  invalidateSubir: () => void;
  invalidateRevisar: () => void;
  invalidateClientes: () => void;
  invalidateResumen: () => void;
  invalidateAll: () => void;
}

type AppStore = SubirSlice & RevisarSlice & ClientesSlice & ResumenSlice & InvalidateSlice;

function freshSlice<T>(data: T): CacheSlice<T> {
  return { data, lastFetched: Date.now(), isFresh: () => false };
}

function emptySlice<T>(): CacheSlice<T> {
  return { data: null, lastFetched: 0, isFresh: () => false };
}

export const useAppStore = create<AppStore>((set, get) => ({
  // --- Subir ---
  documentos: emptySlice(),
  setDocumentos: (docs) => set({ documentos: { ...freshSlice(docs), isFresh: () => Date.now() - get().documentos.lastFetched < STALE_MS } }),
  updateDocumento: (doc) => {
    const current = get().documentos.data;
    if (!current) return;
    set({ documentos: { ...get().documentos, data: current.map((d) => d.id === doc.id ? doc : d) } });
  },
  addDocumento: (doc) => {
    const current = get().documentos.data ?? [];
    if (current.some((d) => d.id === doc.id)) return;
    set({ documentos: { ...get().documentos, data: [doc, ...current] } });
  },

  // --- Revisar ---
  propuestas: emptySlice(),
  clientes: emptySlice(),
  setPropuestas: (data) => set({ propuestas: { ...freshSlice(data), isFresh: () => Date.now() - get().propuestas.lastFetched < STALE_MS } }),
  setRevisarClientes: (data) => set({ clientes: { ...freshSlice(data), isFresh: () => Date.now() - get().clientes.lastFetched < STALE_MS } }),

  // --- Clientes ---
  clientesList: emptySlice(),
  setClientesList: (data) => set({ clientesList: { ...freshSlice(data), isFresh: () => Date.now() - get().clientesList.lastFetched < STALE_MS } }),

  // --- Resumen ---
  resumen: emptySlice(),
  historico: emptySlice(),
  setResumen: (data) => set({ resumen: { ...freshSlice(data), isFresh: () => Date.now() - get().resumen.lastFetched < STALE_MS } }),
  setHistorico: (data) => set({ historico: { ...freshSlice(data), isFresh: () => Date.now() - get().historico.lastFetched < STALE_MS } }),

  // --- Invalidation ---
  invalidateSubir: () => set({ documentos: emptySlice() }),
  invalidateRevisar: () => set({ propuestas: emptySlice(), clientes: emptySlice() }),
  invalidateClientes: () => set({ clientesList: emptySlice() }),
  invalidateResumen: () => set({ resumen: emptySlice(), historico: emptySlice() }),
  invalidateAll: () => set({
    documentos: emptySlice(),
    propuestas: emptySlice(),
    clientes: emptySlice(),
    clientesList: emptySlice(),
    resumen: emptySlice(),
    historico: emptySlice(),
  }),
}));
