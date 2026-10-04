"use client";

import { useEffect, useMemo, useState } from "react";
import { useToast } from "@/components/Toast";
import { estadoEnPalabras, type EstadoRegla } from "@/lib/ai/regla-evidencia";
import { deshacerReglaAprendida, listarLoQueAprendi } from "./lo-que-aprendi-actions";
import { SIN_CONTRAPARTE, VACIO_LO_QUE_APRENDI, textoAciertos, type ReglaAprendida } from "./lo-que-aprendi-util";

/**
 * Apartado "Lo que aprendí" (Empresa, junto a Formatos de cartola). Cada vez que la
 * clienta corrige un tipo en Check, massDTE recuerda esa contraparte. Acá ve qué
 * recuerda, cuán seguro está y puede deshacerlo. Nada de "IA": es su propia memoria.
 */
const PAGINA = 40;

const COLOR_ESTADO: Record<string, string> = {
  firme: "var(--green, #22c55e)",
  a_prueba: "var(--amber, #f59e0b)",
  en_disputa: "var(--accent, #E8553E)",
};

export default function LoQueAprendi() {
  const { toast } = useToast();
  const [reglas, setReglas] = useState<ReglaAprendida[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filtro, setFiltro] = useState("");
  const [visibles, setVisibles] = useState(PAGINA);
  const [confirmando, setConfirmando] = useState<string | null>(null);
  const [trabajando, setTrabajando] = useState<string | null>(null);

  useEffect(() => {
    let cancel = false;
    listarLoQueAprendi()
      .then((res) => {
        if (cancel) return;
        if ("error" in res) setError(res.error);
        else setReglas(res.reglas);
      })
      .catch(() => { if (!cancel) setError("No pudimos cargar lo aprendido."); });
    return () => { cancel = true; };
  }, []);

  const filtradas = useMemo(() => {
    const q = filtro.trim().toLowerCase();
    if (!reglas) return [];
    if (!q) return reglas;
    return reglas.filter((r) => (r.contraparte ?? SIN_CONTRAPARTE).toLowerCase().includes(q));
  }, [reglas, filtro]);

  async function deshacer(id: string) {
    if (trabajando) return;
    setTrabajando(id);
    try {
      const res = await deshacerReglaAprendida(id);
      if ("error" in res) {
        toast(res.error, "error");
      } else {
        setReglas((prev) => (prev ? prev.filter((r) => r.id !== id) : prev));
        toast(res.mensaje);
      }
    } catch {
      toast("No se pudo deshacer. Intenta de nuevo.", "error");
    } finally {
      setTrabajando(null);
      setConfirmando(null);
    }
  }

  const resumen = reglas
    ? reglas.length === 0
      ? null
      : `${reglas.length === 1 ? "1 contraparte" : `${reglas.length.toLocaleString("es-CL")} contrapartes`} · ${reglas.filter((r) => r.estado === "firme").length.toLocaleString("es-CL")} seguras`
    : null;

  return (
    <div style={{
      borderRadius: 22,
      border: "1px solid var(--border, rgba(255,255,255,.06))",
      background: "color-mix(in srgb, var(--text, #e8eaf0) 3%, transparent)",
      boxShadow: "inset 0 1px 0 var(--border, rgba(255,255,255,.06))",
    }}>
      <div style={{ maxWidth: 1180, margin: "0 auto", padding: "28px 36px" }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 20, marginBottom: 22 }}>
          <div style={{
            width: 48, height: 48, flexShrink: 0,
            display: "flex", alignItems: "center", justifyContent: "center",
            borderRadius: 16,
            border: "1px solid rgba(232,85,62,0.25)",
            background: "rgba(232,85,62,0.12)",
            color: "var(--accent, #E8553E)",
          }}>
            <svg viewBox="0 0 24 24" fill="none" width={20} height={20} aria-hidden="true">
              <path d="M4 5.5A1.5 1.5 0 0 1 5.5 4H11v16H5.5A1.5 1.5 0 0 1 4 18.5v-13ZM20 5.5A1.5 1.5 0 0 0 18.5 4H13v16h5.5a1.5 1.5 0 0 0 1.5-1.5v-13Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
            </svg>
          </div>
          <div style={{ minWidth: 0, paddingTop: 4, flex: 1 }}>
            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10 }}>
              <h3 style={{ fontSize: 20, fontWeight: 700, lineHeight: 1.2, letterSpacing: "-0.04em", color: "var(--text, #e8eaf0)" }}>
                Lo que aprendí
              </h3>
              {resumen && (
                <span style={{
                  display: "inline-block", borderRadius: 9999, padding: "2px 10px", fontSize: 11, fontWeight: 700,
                  border: "1px solid color-mix(in srgb, var(--text3, #697080) 35%, transparent)",
                  background: "color-mix(in srgb, var(--text3, #697080) 10%, transparent)",
                  color: "var(--text3, #697080)",
                }}>
                  {resumen}
                </span>
              )}
            </div>
            <p style={{ marginTop: 6, fontSize: 13, lineHeight: 1.4, color: "var(--text3, #697080)" }}>
              Cuando corriges un tipo en Check, recuerdo a esa contraparte para la próxima cartola.
              Primero aprendo: tus boletas lo confirman y recién ahí lo dejo listo solo.
            </p>
          </div>
        </div>

        {error && (
          <div style={{ fontSize: 13, color: "var(--accent, #E8553E)", padding: "12px 4px" }}>{error}</div>
        )}

        {!error && reglas === null && (
          <div style={{ fontSize: 13, color: "var(--text3, #697080)", padding: "12px 4px" }}>Cargando…</div>
        )}

        {!error && reglas !== null && reglas.length === 0 && (
          <div style={{
            borderRadius: 14, border: "1px dashed var(--border, rgba(255,255,255,.12))",
            padding: "26px 20px", textAlign: "center", fontSize: 13, color: "var(--text3, #697080)", lineHeight: 1.5,
          }}>
            {VACIO_LO_QUE_APRENDI}
          </div>
        )}

        {!error && reglas !== null && reglas.length > 0 && (
          <>
            {reglas.length > 12 && (
              <input
                type="search"
                value={filtro}
                onChange={(e) => { setFiltro(e.target.value); setVisibles(PAGINA); }}
                placeholder="Buscar contraparte"
                aria-label="Buscar contraparte"
                style={{
                  width: "100%", maxWidth: 320, height: 36, marginBottom: 12, padding: "0 12px",
                  borderRadius: 10, border: "1px solid var(--border, rgba(255,255,255,.1))",
                  background: "color-mix(in srgb, var(--text, #e8eaf0) 4%, transparent)",
                  color: "var(--text, #e8eaf0)", fontSize: 13, outline: "none",
                }}
              />
            )}
            <div role="list" style={{
              borderRadius: 14, border: "1px solid var(--border, rgba(255,255,255,.06))", overflow: "hidden",
            }}>
              {filtradas.slice(0, visibles).map((r, i) => (
                <FilaRegla
                  key={r.id}
                  regla={r}
                  primera={i === 0}
                  confirmando={confirmando === r.id}
                  trabajando={trabajando === r.id}
                  onPedir={() => setConfirmando(r.id)}
                  onCancelar={() => setConfirmando(null)}
                  onDeshacer={() => { void deshacer(r.id); }}
                />
              ))}
              {filtradas.length === 0 && (
                <div style={{ padding: "16px 18px", fontSize: 13, color: "var(--text3, #697080)" }}>Ninguna contraparte calza con “{filtro}”.</div>
              )}
            </div>
            {filtradas.length > visibles && (
              <button type="button" onClick={() => setVisibles((v) => v + PAGINA)} style={{
                marginTop: 12, height: 34, borderRadius: 10, padding: "0 14px", fontSize: 12, fontWeight: 600, cursor: "pointer",
                border: "1px solid var(--border, rgba(255,255,255,.1))", background: "transparent", color: "var(--text2, #8b92a3)",
              }}>
                Ver {Math.min(PAGINA, filtradas.length - visibles)} más
              </button>
            )}
            <div style={{ marginTop: 12, fontSize: 11, color: "var(--text3, #697080)", lineHeight: 1.5 }}>
              Deshacer no toca lo que ya está en Emitir ni lo emitido: solo deja de aplicarse y vuelve a revisar lo que estaba en Check.
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function FilaRegla(p: {
  regla: ReglaAprendida;
  primera: boolean;
  confirmando: boolean;
  trabajando: boolean;
  onPedir: () => void;
  onCancelar: () => void;
  onDeshacer: () => void;
}) {
  const { regla } = p;
  const color = COLOR_ESTADO[regla.estado] ?? "var(--text3, #697080)";
  return (
    <div role="listitem" style={{
      display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap",
      padding: "12px 18px",
      borderTop: p.primera ? "none" : "1px solid var(--border, rgba(255,255,255,.06))",
      background: "color-mix(in srgb, var(--text, #e8eaf0) 2%, transparent)",
    }}>
      <div style={{ minWidth: 0, flex: "1 1 220px" }}>
        <div style={{
          fontSize: 13, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          color: regla.contraparte ? "var(--text, #e8eaf0)" : "var(--text3, #697080)",
          fontStyle: regla.contraparte ? "normal" : "italic",
        }}>
          {regla.contraparte ?? SIN_CONTRAPARTE}
        </div>
        <div style={{ marginTop: 2, fontSize: 11, color: "var(--text3, #697080)" }}>
          {regla.tipo ? `Boleta ${regla.tipo.toLowerCase()}` : "Sin tipo"} · {textoAciertos(regla.aciertos)}
        </div>
      </div>

      <span style={{
        display: "inline-flex", alignItems: "center", gap: 6, borderRadius: 9999, padding: "2px 10px",
        fontSize: 11, fontWeight: 700, color,
        border: `1px solid color-mix(in srgb, ${color} 30%, transparent)`,
        background: `color-mix(in srgb, ${color} 10%, transparent)`,
      }}>
        <span aria-hidden="true" style={{ width: 6, height: 6, borderRadius: "50%", background: color }} />
        {estadoEnPalabras(regla.estado as EstadoRegla)}
      </span>

      {p.confirmando ? (
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 12, color: "var(--text2, #8b92a3)" }}>¿La olvido?</span>
          <button type="button" onClick={p.onDeshacer} disabled={p.trabajando} style={btn(true, p.trabajando)}>
            {p.trabajando ? "Deshaciendo…" : "Sí, deshacer"}
          </button>
          <button type="button" onClick={p.onCancelar} disabled={p.trabajando} style={btn(false, p.trabajando)}>
            No
          </button>
        </div>
      ) : (
        <button type="button" onClick={p.onPedir} style={btn(false, false)} aria-label={`Deshacer ${regla.contraparte ?? SIN_CONTRAPARTE}`}>
          Deshacer
        </button>
      )}
    </div>
  );
}

function btn(peligro: boolean, deshabilitado: boolean): React.CSSProperties {
  return {
    height: 30, borderRadius: 9, padding: "0 12px", fontSize: 12, fontWeight: 600, whiteSpace: "nowrap",
    cursor: deshabilitado ? "default" : "pointer", opacity: deshabilitado ? 0.5 : 1,
    border: peligro ? "1px solid rgba(232,85,62,.38)" : "1px solid var(--border, rgba(255,255,255,.1))",
    background: peligro ? "rgba(232,85,62,.14)" : "transparent",
    color: peligro ? "var(--accent, #E8553E)" : "var(--text2, #8b92a3)",
  };
}
