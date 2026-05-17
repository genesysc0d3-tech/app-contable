import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import DocCardList from "./DocCardList";
import DropzoneUpload from "./DropzoneUpload";

export default async function EmitirPanel({ empresaId }: { empresaId: string }) {
  const supabase = await createClient();
  const { data: docs } = await supabase.from("documentos_subidos")
    .select("id,nombre_archivo,tipo,estado,movimientos_detectados,created_at,progreso_ia")
    .eq("empresa_id", empresaId).order("created_at",{ascending:false}).limit(10);

  return (
    <>
      <div className="sec">
        <DropzoneUpload />
        <div className="dz-fmts">
          <span className="f"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg> XLS</span>
          <span className="f"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg> PDF</span>
          <span className="f"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg> IMG</span>
          <span className="f"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg> CSV</span>
          <span className="f"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg> WP</span>
        </div>
      </div>

      {(docs ?? []).length > 0 && <DocCardList docs={docs ?? []} empresaId={empresaId} />}

      {/* History */}
      <div className="sec">
        <Link href="/subir" className="hist-btn" style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"6px 0",border:"none",background:"none",cursor:"pointer",fontSize:10,fontWeight:600,color:"var(--text)",borderTop:"1px solid var(--bg-muted)",textDecoration:"none"}}>
          <span>Historial <span className="cnt" style={{fontSize:9,fontWeight:400,color:"var(--text2)"}}>({docs?.length ?? 0} docs)</span></span>
          <span className="arr" style={{fontSize:8,color:"var(--text2)"}}>→</span>
        </Link>
      </div>
    </>
  );
}
