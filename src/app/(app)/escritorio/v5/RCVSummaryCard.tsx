"use client";

import GlowWrap from "./GlowWrap";

type RCVSummaryCardProps = {
  mes: string;
  esRcvExento: boolean;
  docs: number;
  neto: string;
  iva: string;
  total: string;
};

export default function RCVSummaryCard({ mes, esRcvExento, docs, neto, iva, total }: RCVSummaryCardProps) {
  const [month, year] = mes.split("-");
  const monthName = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"][Number(month) - 1];
  const readableMonth = monthName && year ? `${monthName} ${year}` : mes;

  return (
    <GlowWrap glow style={{ borderRadius: 16, overflow: "visible" }}>
      <button
        type="button"
        onClick={() => window.dispatchEvent(new CustomEvent("switch-view", { detail: "rcv" }))}
        className="rcv-card"
        style={{ width: "100%", background: "var(--surface)", borderRadius: 16, padding: "10px 14px", border: "1px solid var(--border)", boxShadow: "inset 0 1px 0 var(--border),0 8px 32px var(--shadow)", overflow: "hidden", cursor: "pointer", textAlign: "left", color: "inherit" }}
      >
        <div className="rcv-h" style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 7 }}>
          <div style={{ width: 28, height: 28, borderRadius: 7, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(232,85,62,.1)", color: "#E8553E", flexShrink: 0 }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text)", letterSpacing: "-0.02em" }}>REGISTRO DE VENTAS</div>
            <div className="mes" style={{ fontSize: 9, color: "var(--text2)", marginTop: 1, fontWeight: 500 }}>Resumen de ventas del período · {readableMonth}</div>
          </div>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ flexShrink: 0, color: "var(--text2)" }}><path d="M9 18l6-6-6-6" /></svg>
        </div>
        {esRcvExento ? (
          <div className="rcv-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 5, marginTop: 3 }}>
            <div className="item" style={{ padding: "8px 7px", borderRadius: 8, background: "var(--bg-muted)", textAlign: "center" }}>
              <div className="lbl" style={{ fontSize: 8, color: "var(--text2)", marginBottom: 3, fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.04em" }}>Boletas emitidas</div>
              <div style={{ fontSize: 18, fontWeight: 700, color: "var(--text)", fontVariantNumeric: "tabular-nums" }}>{docs}</div>
            </div>
            <div className="item" style={{ padding: "8px 7px", borderRadius: 8, background: "var(--bg-muted)", textAlign: "center" }}>
              <div className="lbl" style={{ fontSize: 8, color: "var(--text2)", marginBottom: 3, fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.04em" }}>Total exento</div>
              <div style={{ fontSize: 18, fontWeight: 700, color: "#BFDBFE", fontVariantNumeric: "tabular-nums" }}>{total}</div>
            </div>
          </div>
        ) : (
          <div className="rcv-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 4, marginTop: 3 }}>
            {[{ l: "Boletas emitidas", v: String(docs), c: "var(--text)" }, { l: "Neto", v: neto, c: "var(--text)" }, { l: "IVA", v: iva, c: "var(--text)" }, { l: "Total", v: total, c: "#b4f027", tot: true }].map((x, i) => (
              <div key={i} className="item" style={{ padding: "5px 4px", borderRadius: 6, background: "var(--bg-muted)", textAlign: "center" }}>
                <div className="lbl" style={{ fontSize: 7, color: "var(--text2)", marginBottom: 2, fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.04em" }}>{x.l}</div>
                <div style={{ fontSize: 13, fontWeight: x.tot ? 700 : 600, color: x.c, fontVariantNumeric: "tabular-nums" }}>{x.v}</div>
              </div>
            ))}
          </div>
        )}
      </button>
    </GlowWrap>
  );
}
