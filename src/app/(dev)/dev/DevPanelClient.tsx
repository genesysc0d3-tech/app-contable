"use client";

/**
 * Panel /dev — control de mando del operador. Una pantalla, 3 zonas:
 * stat-cards arriba, planes editables al medio, empresas (buscador + top uso)
 * abajo. Sin link en ningún nav: acceso directo por URL, gate server-side.
 * Paleta dark v5 autocontenida — este panel no pasa por V5Root, así que no
 * dependemos de sus CSS variables.
 */

import { useState, type CSSProperties, type FormEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import type { Tables } from "@/lib/database.types";
import {
  actualizarPlan,
  buscarEmpresa,
  entrarModoClienteDev,
  otorgarRefillCortesia,
  togglePlanActivo,
  type EmpresaHit,
  type PlanCamposInput,
} from "./actions";

export type PlanConfigRow = Tables<"planes_config">;

export type TopEmpresaUso = {
  id: string;
  nombre: string;
  rut: string;
  uso: number;
  cuota: number;
};

export type DevStats = {
  periodo: string;
  ufClp: number;
  mrrUf: number;
  mrrClp: number;
  totalEmpresas: number;
  susActivasTotal: number;
  susPorPlan: { codigo: string; nombre: string; activas: number }[];
  boletasMesTotal: number;
  boletasMesMasivas: number;
  trialsEnCurso: number;
  cortesiasMesBoletas: number;
  cortesiasMesRegalos: number;
  topEmpresas: TopEmpresaUso[];
};

/* ── Paleta dark v5 (mismos valores que V5Root) ─────────────────────────── */

const C = {
  bg: "#0f1014",
  surface: "#16181d",
  border: "rgba(255,255,255,.06)",
  text: "#e8eaf0",
  text2: "#636878",
  text3: "#4a4d55",
  accent: "#E8553E",
  accentSoft: "rgba(232,85,62,.12)",
  green: "#22c55e",
  amber: "#f59e0b",
  muted: "rgba(255,255,255,.04)",
} as const;

const cardStyle: CSSProperties = {
  background: C.surface,
  border: `1px solid ${C.border}`,
  borderRadius: 12,
  padding: "12px 13px",
  minWidth: 0,
};

const tituloZonaStyle: CSSProperties = {
  fontSize: 9,
  color: C.text2,
  textTransform: "uppercase",
  letterSpacing: "0.08em",
  fontWeight: 600,
  margin: 0,
};

const thStyle: CSSProperties = {
  fontSize: 8,
  color: C.text2,
  textTransform: "uppercase",
  letterSpacing: "0.06em",
  fontWeight: 600,
  textAlign: "right",
  padding: "0 4px 6px",
  whiteSpace: "nowrap",
};

const inputNumStyle: CSSProperties = {
  background: C.muted,
  border: `1px solid ${C.border}`,
  borderRadius: 6,
  color: C.text,
  fontSize: 11,
  padding: "4px 6px",
  textAlign: "right",
  fontVariantNumeric: "tabular-nums",
  outline: "none",
  width: "100%",
  minWidth: 0,
  boxSizing: "border-box",
};

const inputTextoStyle: CSSProperties = {
  ...inputNumStyle,
  textAlign: "left",
  fontVariantNumeric: "normal",
};

const fmtNum = (n: number) => n.toLocaleString("es-CL");
const fmtClp = (n: number) => `$${Math.round(n).toLocaleString("es-CL")}`;
const fmtUf = (n: number) =>
  n.toLocaleString("es-CL", { minimumFractionDigits: 0, maximumFractionDigits: 2 });

const MESES = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];

function mesLegible(periodo: string): string {
  const [anio, mes] = periodo.split("-").map(Number);
  return MESES[mes - 1] ? `${MESES[mes - 1]} ${anio}` : periodo;
}

/* ── Piezas chicas ──────────────────────────────────────────────────────── */

function Toggle({
  on,
  onChange,
  etiqueta,
  deshabilitado,
}: {
  on: boolean;
  onChange: (v: boolean) => void;
  etiqueta: string;
  deshabilitado?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={etiqueta}
      disabled={deshabilitado}
      onClick={() => onChange(!on)}
      style={{
        width: 28,
        height: 16,
        borderRadius: 999,
        position: "relative",
        padding: 0,
        flexShrink: 0,
        border: `1px solid ${on ? "rgba(232,85,62,.45)" : C.border}`,
        background: on ? C.accentSoft : C.muted,
        cursor: deshabilitado ? "default" : "pointer",
        opacity: deshabilitado ? 0.45 : 1,
        verticalAlign: "middle",
      }}
    >
      <span
        style={{
          position: "absolute",
          top: 2,
          left: on ? 14 : 2,
          width: 10,
          height: 10,
          borderRadius: 999,
          background: on ? C.accent : C.text2,
          transition: "left .15s ease",
        }}
      />
    </button>
  );
}

function BotonChico({
  children,
  onClick,
  deshabilitado,
  destacado,
}: {
  children: ReactNode;
  onClick?: () => void;
  deshabilitado?: boolean;
  destacado?: boolean;
}) {
  const activo = destacado && !deshabilitado;
  return (
    <button
      type={onClick ? "button" : "submit"}
      onClick={onClick}
      disabled={deshabilitado}
      style={{
        fontSize: 10,
        fontWeight: 600,
        padding: "4px 10px",
        borderRadius: 6,
        border: `1px solid ${activo ? "rgba(232,85,62,.5)" : C.border}`,
        background: activo ? C.accentSoft : C.muted,
        color: activo ? C.accent : C.text2,
        cursor: deshabilitado ? "default" : "pointer",
        whiteSpace: "nowrap",
        flexShrink: 0,
      }}
    >
      {children}
    </button>
  );
}

/* ── Zona 1: stat-cards ─────────────────────────────────────────────────── */

function StatCard({
  label,
  valor,
  sub,
  sub2,
}: {
  label: string;
  valor: string;
  sub?: string;
  sub2?: string;
}) {
  return (
    <div style={{ ...cardStyle, padding: "11px 13px" }}>
      <div
        style={{
          fontSize: 8,
          color: C.text2,
          textTransform: "uppercase",
          letterSpacing: "0.07em",
          fontWeight: 600,
          marginBottom: 5,
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: 20,
          fontWeight: 700,
          letterSpacing: "-0.02em",
          fontVariantNumeric: "tabular-nums",
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}
      >
        {valor}
      </div>
      {sub && (
        <div
          style={{
            fontSize: 9,
            color: C.text2,
            marginTop: 3,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {sub}
        </div>
      )}
      {sub2 && (
        <div
          style={{
            fontSize: 9,
            color: C.text3,
            marginTop: 1,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {sub2}
        </div>
      )}
    </div>
  );
}

function FilaStats({ stats }: { stats: DevStats }) {
  const desglose = stats.susPorPlan.map((p) => `${p.nombre} ${p.activas}`).join(" · ");
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 10 }}>
      <StatCard
        label="MRR"
        valor={fmtClp(stats.mrrClp)}
        sub={`Σ ${fmtUf(stats.mrrUf)} UF × ${fmtClp(stats.ufClp)} (UF del día)`}
      />
      <StatCard
        label="Empresas activas"
        valor={fmtNum(stats.susActivasTotal)}
        sub={`de ${fmtNum(stats.totalEmpresas)} empresas registradas`}
        sub2={desglose || "sin planes configurados"}
      />
      <StatCard
        label="Boletas del mes"
        valor={`${fmtNum(stats.boletasMesMasivas)} / ${fmtNum(stats.boletasMesTotal)}`}
        sub={`masivas / total · ${mesLegible(stats.periodo)}`}
      />
      <StatCard
        label="Trials en curso"
        valor={fmtNum(stats.trialsEnCurso)}
        sub="con trial vigente, sin suscripción"
      />
    </div>
  );
}

/* ── Zona 2: planes editables ───────────────────────────────────────────── */

const CAMPOS_PLAN = [
  { key: "uf_mensual", label: "UF/mes", entero: false },
  { key: "cuota_masivas", label: "Cuota masivas", entero: true },
  { key: "ruts_incluidos", label: "RUTs incl.", entero: true },
  { key: "uf_rut_adicional", label: "UF RUT adic.", entero: false },
  { key: "refill_boletas", label: "Refill boletas", entero: true },
  { key: "refill_clp_neto", label: "Refill $ neto", entero: true },
  { key: "trial_dias", label: "Trial días", entero: true },
  { key: "trial_boletas", label: "Trial boletas", entero: true },
] as const;

type CampoPlanKey = (typeof CAMPOS_PLAN)[number]["key"];

function FilaPlan({ plan }: { plan: PlanConfigRow }) {
  const router = useRouter();
  const [valores, setValores] = useState<Record<CampoPlanKey, string>>(() => {
    const init = {} as Record<CampoPlanKey, string>;
    for (const c of CAMPOS_PLAN) init[c.key] = String(plan[c.key]);
    return init;
  });
  const [activo, setActivo] = useState(plan.activo);
  const [guardando, setGuardando] = useState(false);
  const [resultado, setResultado] = useState<{ ok: boolean; msg: string } | null>(null);

  const dirty =
    activo !== plan.activo || CAMPOS_PLAN.some((c) => Number(valores[c.key]) !== plan[c.key]);

  function editar(key: CampoPlanKey, valor: string) {
    setValores((v) => ({ ...v, [key]: valor }));
    setResultado(null);
  }

  async function guardar() {
    const campos: PlanCamposInput = { activo };
    for (const c of CAMPOS_PLAN) {
      const crudo = valores[c.key].trim().replace(",", ".");
      const n = Number(crudo);
      if (crudo === "" || !Number.isFinite(n) || n < 0 || (c.entero && !Number.isInteger(n))) {
        setResultado({ ok: false, msg: `${c.label}: valor inválido` });
        return;
      }
      campos[c.key] = n;
    }
    setGuardando(true);
    setResultado(null);
    const res = await actualizarPlan(plan.codigo, campos);
    setGuardando(false);
    if ("error" in res) {
      setResultado({ ok: false, msg: res.error });
      return;
    }
    setResultado({ ok: true, msg: "guardado" });
    router.refresh();
  }

  return (
    <tr style={{ borderTop: `1px solid ${C.border}` }}>
      <td style={{ padding: "7px 8px 7px 0", whiteSpace: "nowrap" }}>
        <div style={{ fontSize: 11, fontWeight: 600 }}>{plan.nombre}</div>
        <div
          style={{
            fontSize: 8,
            color: C.text3,
            textTransform: "uppercase",
            letterSpacing: "0.05em",
          }}
        >
          {plan.codigo}
        </div>
      </td>
      {CAMPOS_PLAN.map((c) => (
        <td key={c.key} style={{ padding: "7px 3px" }}>
          <input
            value={valores[c.key]}
            onChange={(e) => editar(c.key, e.target.value)}
            inputMode="decimal"
            aria-label={`${plan.nombre}: ${c.label}`}
            style={{ ...inputNumStyle, minWidth: 44, maxWidth: 78 }}
          />
        </td>
      ))}
      <td style={{ padding: "7px 6px", textAlign: "center" }}>
        <Toggle
          on={activo}
          onChange={(v) => {
            setActivo(v);
            setResultado(null);
          }}
          etiqueta={`Plan ${plan.nombre} activo`}
        />
      </td>
      <td style={{ padding: "7px 0 7px 6px", textAlign: "right", whiteSpace: "nowrap" }}>
        {resultado && (
          <span
            title={resultado.msg}
            style={{
              fontSize: 9,
              color: resultado.ok ? C.green : C.accent,
              marginRight: 8,
              display: "inline-block",
              maxWidth: 160,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              verticalAlign: "middle",
            }}
          >
            {resultado.ok ? "✓ guardado" : resultado.msg}
          </span>
        )}
        <BotonChico onClick={guardar} deshabilitado={!dirty || guardando} destacado={dirty}>
          {guardando ? "Guardando…" : "Guardar"}
        </BotonChico>
      </td>
    </tr>
  );
}

function ZonaPlanes({ planes }: { planes: PlanConfigRow[] }) {
  return (
    <section style={cardStyle}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          marginBottom: 8,
          gap: 8,
        }}
      >
        <h2 style={tituloZonaStyle}>Planes</h2>
        <span style={{ fontSize: 9, color: C.text3, whiteSpace: "nowrap" }}>
          los cambios rigen al guardar · sin deploy
        </span>
      </div>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={{ ...thStyle, textAlign: "left", paddingLeft: 0 }}>Plan</th>
              {CAMPOS_PLAN.map((c) => (
                <th key={c.key} style={thStyle}>
                  {c.label}
                </th>
              ))}
              <th style={{ ...thStyle, textAlign: "center" }}>Activo</th>
              <th style={thStyle} aria-label="Acciones" />
            </tr>
          </thead>
          <tbody>
            {planes.map((p) => (
              <FilaPlan key={p.codigo} plan={p} />
            ))}
          </tbody>
        </table>
      </div>
      {planes.length === 0 && (
        <div style={{ fontSize: 10, color: C.text2, padding: "6px 0" }}>
          Sin planes configurados
        </div>
      )}
    </section>
  );
}

/* ── Zona 3: empresas (buscador + top uso) ──────────────────────────────── */

function FilaEmpresa({
  hit,
  ocupada,
  aviso,
  cantidad,
  onCantidad,
  onTogglePlan,
  onRegalar,
  onModoCliente,
}: {
  hit: EmpresaHit;
  ocupada: boolean;
  aviso?: { ok: boolean; msg: string };
  cantidad: string;
  onCantidad: (v: string) => void;
  onTogglePlan: () => void;
  onRegalar: () => void;
  onModoCliente: () => void;
}) {
  const sobreCuota = hit.cuota > 0 && hit.uso > hit.cuota;
  return (
    <div
      style={{
        borderTop: `1px solid ${C.border}`,
        padding: "7px 0",
        display: "flex",
        flexDirection: "column",
        gap: 5,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <span
            style={{
              fontSize: 11,
              fontWeight: 600,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              display: "block",
            }}
          >
            {hit.nombre}
          </span>
          <span style={{ fontSize: 9, color: C.text2, fontVariantNumeric: "tabular-nums" }}>
            {hit.rut}
            {hit.planCodigo ? ` · ${hit.planCodigo}` : " · sin plan"}
          </span>
        </div>
        <span
          title="Boletas masivas del mes / cuota"
          style={{
            fontSize: 10,
            color: sobreCuota ? C.amber : C.text2,
            fontVariantNumeric: "tabular-nums",
            whiteSpace: "nowrap",
            flexShrink: 0,
          }}
        >
          {fmtNum(hit.uso)}/{hit.cuota > 0 ? fmtNum(hit.cuota) : "—"}
        </span>
        <div style={{ display: "flex", alignItems: "center", gap: 5, flexShrink: 0 }}>
          <span
            style={{
              fontSize: 8,
              color: C.text3,
              textTransform: "uppercase",
              letterSpacing: "0.05em",
            }}
          >
            plan
          </span>
          <Toggle
            on={hit.planActivo}
            onChange={onTogglePlan}
            etiqueta={`Plan activo de ${hit.nombre}`}
            deshabilitado={ocupada}
          />
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <input
          value={cantidad}
          onChange={(e) => onCantidad(e.target.value)}
          inputMode="numeric"
          aria-label={`Boletas de regalo para ${hit.nombre}`}
          style={{ ...inputNumStyle, width: 64, flexShrink: 0 }}
        />
        <BotonChico onClick={onRegalar} deshabilitado={ocupada}>
          Regalar refill
        </BotonChico>
        <BotonChico onClick={onModoCliente} deshabilitado={ocupada} destacado>
          Ver como cliente
        </BotonChico>
        {aviso && (
          <span
            title={aviso.msg}
            style={{
              fontSize: 9,
              color: aviso.ok ? C.green : C.accent,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              minWidth: 0,
            }}
          >
            {aviso.msg}
          </span>
        )}
      </div>
    </div>
  );
}

function BuscadorEmpresas() {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [buscando, setBuscando] = useState(false);
  const [errorBusqueda, setErrorBusqueda] = useState<string | null>(null);
  const [hits, setHits] = useState<EmpresaHit[] | null>(null);
  const [refillCantidades, setRefillCantidades] = useState<Record<string, string>>({});
  const [ocupadas, setOcupadas] = useState<Record<string, boolean>>({});
  const [avisos, setAvisos] = useState<Record<string, { ok: boolean; msg: string }>>({});

  async function buscar(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (buscando) return;
    setBuscando(true);
    setErrorBusqueda(null);
    const res = await buscarEmpresa(q);
    setBuscando(false);
    if ("error" in res) {
      setErrorBusqueda(res.error);
      setHits(null);
      return;
    }
    setHits(res.resultados);
    setAvisos({});
    setRefillCantidades(
      Object.fromEntries(res.resultados.map((r) => [r.id, String(r.refillSugerido)])),
    );
  }

  function marcarOcupada(id: string, valor: boolean) {
    setOcupadas((o) => ({ ...o, [id]: valor }));
  }

  async function cambiarPlanActivo(hit: EmpresaHit) {
    const nuevo = !hit.planActivo;
    marcarOcupada(hit.id, true);
    setHits((hs) => hs?.map((h) => (h.id === hit.id ? { ...h, planActivo: nuevo } : h)) ?? null);
    const res = await togglePlanActivo(hit.id, nuevo);
    marcarOcupada(hit.id, false);
    if ("error" in res) {
      setHits(
        (hs) =>
          hs?.map((h) => (h.id === hit.id ? { ...h, planActivo: hit.planActivo } : h)) ?? null,
      );
      setAvisos((a) => ({ ...a, [hit.id]: { ok: false, msg: res.error } }));
      return;
    }
    setAvisos((a) => ({
      ...a,
      [hit.id]: { ok: true, msg: nuevo ? "✓ plan activado" : "✓ plan desactivado" },
    }));
    router.refresh();
  }

  async function regalarRefill(hit: EmpresaHit) {
    const cantidad = Number((refillCantidades[hit.id] ?? "").trim());
    if (!Number.isInteger(cantidad) || cantidad < 1 || cantidad > 100_000) {
      setAvisos((a) => ({ ...a, [hit.id]: { ok: false, msg: "cantidad entre 1 y 100.000" } }));
      return;
    }
    marcarOcupada(hit.id, true);
    const res = await otorgarRefillCortesia(hit.id, cantidad);
    marcarOcupada(hit.id, false);
    if ("error" in res) {
      setAvisos((a) => ({ ...a, [hit.id]: { ok: false, msg: res.error } }));
      return;
    }
    setHits(
      (hs) => hs?.map((h) => (h.id === hit.id ? { ...h, cuota: h.cuota + res.boletas } : h)) ?? null,
    );
    setAvisos((a) => ({
      ...a,
      [hit.id]: { ok: true, msg: `✓ +${fmtNum(res.boletas)} boletas de regalo` },
    }));
    router.refresh();
  }

  async function entrarComoCliente(hit: EmpresaHit) {
    marcarOcupada(hit.id, true);
    setAvisos((a) => ({ ...a, [hit.id]: { ok: true, msg: "preparando modo cliente..." } }));
    const res = await entrarModoClienteDev(hit.id);
    marcarOcupada(hit.id, false);
    if ("error" in res) {
      setAvisos((a) => ({ ...a, [hit.id]: { ok: false, msg: res.error } }));
      return;
    }
    router.push("/massdte");
  }

  return (
    <section style={cardStyle}>
      <h2 style={{ ...tituloZonaStyle, marginBottom: 8 }}>Empresas</h2>
      <form onSubmit={buscar} style={{ display: "flex", gap: 6, marginBottom: 8 }}>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="RUT o razón social…"
          aria-label="Buscar empresa por RUT o razón social"
          style={{ ...inputTextoStyle, flex: 1 }}
        />
        <BotonChico deshabilitado={buscando || q.trim().length < 2} destacado>
          {buscando ? "Buscando…" : "Buscar"}
        </BotonChico>
      </form>
      {errorBusqueda && (
        <div style={{ fontSize: 9, color: C.accent, marginBottom: 6 }}>{errorBusqueda}</div>
      )}
      {hits === null && !errorBusqueda && (
        <div style={{ fontSize: 10, color: C.text3 }}>
          Busca una empresa para gestionar su plan o regalar un refill.
        </div>
      )}
      {hits !== null && hits.length === 0 && (
        <div style={{ fontSize: 10, color: C.text2 }}>Sin resultados</div>
      )}
      <div style={{ display: "flex", flexDirection: "column" }}>
        {hits?.map((h) => (
          <FilaEmpresa
            key={h.id}
            hit={h}
            ocupada={!!ocupadas[h.id]}
            aviso={avisos[h.id]}
            cantidad={refillCantidades[h.id] ?? ""}
            onCantidad={(v) => setRefillCantidades((r) => ({ ...r, [h.id]: v }))}
            onTogglePlan={() => cambiarPlanActivo(h)}
            onRegalar={() => regalarRefill(h)}
            onModoCliente={() => entrarComoCliente(h)}
          />
        ))}
      </div>
    </section>
  );
}

function TopUsoMasivas({
  top,
  periodo,
  cortesiasBoletas,
  cortesiasRegalos,
}: {
  top: TopEmpresaUso[];
  periodo: string;
  cortesiasBoletas: number;
  cortesiasRegalos: number;
}) {
  const router = useRouter();
  const [abriendo, setAbriendo] = useState<string | null>(null);

  async function entrarComoCliente(empresaId: string) {
    setAbriendo(empresaId);
    const res = await entrarModoClienteDev(empresaId);
    setAbriendo(null);
    if ("error" in res) return;
    router.push("/massdte");
  }

  return (
    <section style={cardStyle}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          marginBottom: 8,
          gap: 8,
        }}
      >
        <h2 style={tituloZonaStyle}>Top uso masivas · {mesLegible(periodo)}</h2>
        <span style={{ fontSize: 9, color: C.text3, whiteSpace: "nowrap" }}>
          cortesías: {fmtNum(cortesiasBoletas)} boletas · {fmtNum(cortesiasRegalos)}{" "}
          {cortesiasRegalos === 1 ? "regalo" : "regalos"}
        </span>
      </div>
      {top.length === 0 && (
        <div style={{ fontSize: 10, color: C.text2 }}>Sin boletas masivas este mes</div>
      )}
      {top.map((e, i) => {
        const pct = e.cuota > 0 ? Math.min(100, (e.uso / e.cuota) * 100) : e.uso > 0 ? 100 : 0;
        const sobreCuota = e.cuota > 0 && e.uso > e.cuota;
        return (
          <div key={e.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 0" }}>
            <span
              style={{
                width: 16,
                fontSize: 9,
                color: C.text3,
                fontVariantNumeric: "tabular-nums",
                textAlign: "right",
                flexShrink: 0,
              }}
            >
              {i + 1}
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  gap: 8,
                  alignItems: "baseline",
                }}
              >
                <span
                  title={e.rut}
                  style={{
                    fontSize: 11,
                    fontWeight: 500,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {e.nombre}
                </span>
                <span
                  title="Boletas masivas del mes / cuota"
                  style={{
                    fontSize: 10,
                    color: sobreCuota ? C.amber : C.text2,
                    fontVariantNumeric: "tabular-nums",
                    whiteSpace: "nowrap",
                    flexShrink: 0,
                  }}
                >
                  {fmtNum(e.uso)}/{e.cuota > 0 ? fmtNum(e.cuota) : "—"}
                </span>
              </div>
              <div
                style={{
                  height: 3,
                  borderRadius: 2,
                  background: C.muted,
                  marginTop: 3,
                  overflow: "hidden",
                }}
              >
                <div
                  style={{ height: "100%", width: `${pct}%`, background: C.accent, borderRadius: 2 }}
                />
              </div>
            </div>
            <BotonChico onClick={() => entrarComoCliente(e.id)} deshabilitado={abriendo === e.id}>
              {abriendo === e.id ? "Abriendo..." : "Ver"}
            </BotonChico>
          </div>
        );
      })}
    </section>
  );
}

/* ── Raíz ───────────────────────────────────────────────────────────────── */

export default function DevPanelClient({
  planes,
  stats,
}: {
  planes: PlanConfigRow[];
  stats: DevStats;
}) {
  return (
    <div
      style={{
        minHeight: "100dvh",
        background: C.bg,
        color: C.text,
        fontFamily: "'DM Sans','Inter',sans-serif",
        letterSpacing: "-0.01em",
        padding: "16px 18px 96px",
      }}
    >
      <div
        style={{
          maxWidth: 1280,
          margin: "0 auto",
          display: "flex",
          flexDirection: "column",
          gap: 12,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "baseline",
            justifyContent: "space-between",
            gap: 12,
          }}
        >
          <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
            <span style={{ fontSize: 14, fontWeight: 700, letterSpacing: "-0.02em" }}>
              Panel operador
            </span>
            <span
              style={{
                fontSize: 9,
                color: C.text2,
                fontWeight: 600,
                textTransform: "uppercase",
                letterSpacing: "0.08em",
              }}
            >
              massDTE
            </span>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <a
              href="/dev/cuentas"
              style={{
                fontSize: 10,
                fontWeight: 700,
                padding: "5px 10px",
                borderRadius: 7,
                border: `1px solid ${C.border}`,
                color: C.text2,
                background: C.muted,
                textDecoration: "none",
                whiteSpace: "nowrap",
              }}
            >
              Cuentas
            </a>
            <span style={{ fontSize: 10, color: C.text2, fontVariantNumeric: "tabular-nums" }}>
              {mesLegible(stats.periodo)} · UF {fmtClp(stats.ufClp)}
            </span>
          </div>
        </div>

        <FilaStats stats={stats} />
        <ZonaPlanes planes={planes} />
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)",
            gap: 10,
            alignItems: "start",
          }}
        >
          <BuscadorEmpresas />
          <TopUsoMasivas
            top={stats.topEmpresas}
            periodo={stats.periodo}
            cortesiasBoletas={stats.cortesiasMesBoletas}
            cortesiasRegalos={stats.cortesiasMesRegalos}
          />
        </div>
      </div>
    </div>
  );
}
