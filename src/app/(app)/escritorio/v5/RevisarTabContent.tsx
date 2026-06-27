"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  type Propuesta,
  type ClienteResumen,
  type DocTab,
  classifyConfianza,
  RevisarEmpty,
  AprobarTodoBtn,
  ConfianzaGroupSection,
} from "./revisar-shared";

export default function RevisarTabContent({
  propuestas, clientes, empresaId, empresaGiro, empresaTipoContribuyente,
}: {
  propuestas: Propuesta[]; clientes: ClienteResumen[]; empresaId: string;
  empresaGiro?: string | null; empresaRazonSocial?: string; empresaTipoContribuyente?: string | null;
}) {
  const router = useRouter();

  // Build document tabs from propuestas data
  const docMap = useMemo(() => {
    const m = new Map<string, DocTab & { props: Propuesta[] }>();
    for (const p of propuestas) {
      const doc = p.movimientos_raw?.documentos_subidos;
      if (!doc) continue;
      let ent = m.get(doc.id);
      if (!ent) ent = { docId: doc.id, nombre: doc.nombre_archivo, total: 0, props: [] };
      ent.props.push(p);
      ent.total++;
      m.set(doc.id, ent);
    }
    return Array.from(m.values()).sort((a,b) => b.props.length - a.props.length);
  }, [propuestas]);

  const [selDocId, setSelDocId] = useState<string | null>(null);
  const activeDoc = docMap.find(d => d.docId === (selDocId ?? docMap[0]?.docId));

  // Always call hooks — never after conditional returns
  const emptyProps: Propuesta[] = [];
  const fallbackDoc = { docId: "", nombre: "", total: 0, props: emptyProps } as DocTab & { props: Propuesta[] };
  const doc = activeDoc ?? fallbackDoc;
  const currentProps = useMemo(() => doc.props.filter(p => p.estado === "pendiente" || p.estado === "aprobado" || p.estado === "editado"), [doc]);

  const alta = useMemo(() => currentProps.filter(p => classifyConfianza(p) === "alta"), [currentProps]);
  const media = useMemo(() => currentProps.filter(p => classifyConfianza(p) === "media"), [currentProps]);
  const baja = useMemo(() => currentProps.filter(p => classifyConfianza(p) === "baja"), [currentProps]);

  const totalPendientes = doc.props.filter(p => p.estado === "pendiente").length;

  if (!activeDoc) {
    return <RevisarEmpty />;
  }

  if (totalPendientes === 0) {
    return <RevisarEmpty />;
  }

  return (
    <>
      {/* Referencia al documento de origen — siempre visible para que las
          propuestas de distintas cartolas no se mezclen */}
      <div className="dtabs">
        {docMap.map(dt => (
          <div key={dt.docId}
            className={`dtab ${dt.docId === activeDoc.docId ? "act" : ""}`}
            onClick={() => setSelDocId(dt.docId)}
            style={{cursor:"pointer"}}
          >
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
            {dt.nombre}
            <span className="cnt">{dt.total}</span>
          </div>
        ))}
        <div style={{marginLeft:"auto"}}>
          {alta.length > 0 && <AprobarTodoBtn ids={alta.map(p => p.id)} />}
        </div>
      </div>

      {/* Scrollable content */}
      <div className="r-scroll" style={{padding:"0"}}>
        <ConfianzaGroupSection tipo="alta" label="Alta confianza" propuestas={alta} color="#22c55e" clientes={clientes} empresaId={empresaId} onAction={() => router.refresh()} empresaTipoContribuyente={empresaTipoContribuyente} empresaGiro={empresaGiro} />
        <ConfianzaGroupSection tipo="media" label="Requiere revisión" propuestas={media} color="#f59e0b" clientes={clientes} empresaId={empresaId} onAction={() => router.refresh()} empresaTipoContribuyente={empresaTipoContribuyente} empresaGiro={empresaGiro} />
        <ConfianzaGroupSection tipo="baja" label="Falta información" propuestas={baja} color="#E8553E" clientes={clientes} empresaId={empresaId} onAction={() => router.refresh()} empresaTipoContribuyente={empresaTipoContribuyente} empresaGiro={empresaGiro} />
      </div>
    </>
  );
}
