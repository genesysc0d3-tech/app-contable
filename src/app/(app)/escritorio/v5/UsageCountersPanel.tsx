import { Building2, MessageCircle, ReceiptText, Users } from "lucide-react";
import type { ReactNode } from "react";
import type { ResumenCupos } from "./actions";

function fmt(value: number) {
  return Math.max(0, Math.round(value)).toLocaleString("es-CL");
}

function pct(uso: number, total: number) {
  if (total <= 0) return 0;
  return Math.min(100, Math.max(0, Math.round((uso / total) * 100)));
}

function estadoColor(disponible: number, total: number) {
  if (total <= 0) return "var(--text3)";
  const restante = disponible / total;
  if (restante <= 0.08) return "#ef4444";
  if (restante <= 0.2) return "#f59e0b";
  return "#22c55e";
}

function UsoRow({
  icon,
  label,
  uso,
  total,
  disponible,
  muted,
}: {
  icon: ReactNode;
  label: string;
  uso: number;
  total: number;
  disponible: number;
  muted?: boolean;
}) {
  const progress = pct(uso, total);
  const color = estadoColor(disponible, total);
  return (
    <div style={{ display: "grid", gap: 6 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
        <span style={{ width: 24, height: 24, borderRadius: 8, display: "grid", placeItems: "center", flexShrink: 0, color: muted ? "var(--text3)" : "#E8553E", background: muted ? "var(--bg-muted)" : "rgba(232,85,62,.1)", border: "1px solid var(--border)" }}>
          {icon}
        </span>
        <span style={{ minWidth: 0, flex: 1 }}>
          <span style={{ display: "block", color: muted ? "var(--text2)" : "var(--text)", fontSize: 10, fontWeight: 850, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</span>
          <span style={{ display: "block", marginTop: 1, color: "var(--text2)", fontSize: 8 }}>{total > 0 ? `${fmt(disponible)} disponibles` : "No incluido"}</span>
        </span>
        <span style={{ color: muted ? "var(--text3)" : "var(--text)", fontSize: 10, fontWeight: 850, whiteSpace: "nowrap" }}>
          {total > 0 ? `${fmt(uso)} / ${fmt(total)}` : "0"}
        </span>
      </div>
      <div style={{ height: 5, borderRadius: 999, background: "var(--bg-muted)", overflow: "hidden" }}>
        <div style={{ width: `${progress}%`, height: "100%", borderRadius: 999, background: muted ? "var(--text3)" : color, transition: "width .35s ease" }} />
      </div>
    </div>
  );
}

function extrasLabel(resumen: ResumenCupos) {
  const parts: string[] = [];
  if (resumen.empresas.extras > 0) parts.push(`${fmt(resumen.empresas.extras)} empresa`);
  if (resumen.personas.extras > 0) parts.push(`${fmt(resumen.personas.extras)} persona`);
  if (resumen.boletasCartolas.extras > 0) parts.push(`${fmt(resumen.boletasCartolas.extras)} boletas`);
  if (resumen.telegram.extras > 0) parts.push(`${fmt(resumen.telegram.extras)} Telegram`);
  return parts.length > 0 ? parts.join(" · ") : "Sin extras activos";
}

export default function UsageCountersPanel({ resumen }: { resumen: ResumenCupos }) {
  return (
    <section style={{ padding: "12px 13px", borderRadius: 16, border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text)", boxShadow: "inset 0 1px 0 var(--border),0 8px 32px var(--shadow)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10, marginBottom: 12 }}>
        <h2 style={{ fontSize: 11, fontWeight: 900, letterSpacing: 0, color: "var(--text)" }}>Uso del mes</h2>
        <span style={{ fontSize: 8, fontWeight: 800, color: resumen.planActivo ? "#22c55e" : "#f59e0b", whiteSpace: "nowrap" }}>
          {resumen.plan ?? "Prueba"}
        </span>
      </div>

      <div style={{ display: "grid", gap: 10 }}>
        <UsoRow
          icon={<ReceiptText size={13} strokeWidth={2.2} />}
          label="Boletas desde cartolas"
          uso={resumen.boletasCartolas.uso}
          total={resumen.boletasCartolas.total}
          disponible={resumen.boletasCartolas.disponible}
        />
        <UsoRow
          icon={<MessageCircle size={13} strokeWidth={2.2} />}
          label="Comprobantes por Telegram"
          uso={resumen.telegram.uso}
          total={resumen.telegram.total}
          disponible={resumen.telegram.disponible}
          muted={!resumen.telegram.habilitado}
        />
      </div>

      <div style={{ marginTop: 12, paddingTop: 10, borderTop: "1px solid var(--border)", display: "grid", gap: 7 }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 8, alignItems: "center" }}>
          <span style={{ display: "flex", alignItems: "center", gap: 6, color: "var(--text2)", fontSize: 9, fontWeight: 800, minWidth: 0 }}>
            <Building2 size={12} strokeWidth={2.2} />
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>Empresas</span>
          </span>
          <span style={{ fontSize: 9, fontWeight: 850, color: "var(--text)" }}>{fmt(resumen.empresas.uso)} / {fmt(resumen.empresas.total)}</span>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 8, alignItems: "center" }}>
          <span style={{ display: "flex", alignItems: "center", gap: 6, color: "var(--text2)", fontSize: 9, fontWeight: 800, minWidth: 0 }}>
            <Users size={12} strokeWidth={2.2} />
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>Personas</span>
          </span>
          <span style={{ fontSize: 9, fontWeight: 850, color: "var(--text)" }}>{fmt(resumen.personas.uso)} / {fmt(resumen.personas.total)}</span>
        </div>
        <div style={{ color: "var(--text2)", fontSize: 8, lineHeight: 1.35, overflowWrap: "anywhere" }}>{extrasLabel(resumen)}</div>
      </div>
    </section>
  );
}
