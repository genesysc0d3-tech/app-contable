"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { cambiarEmpresaActiva, crearEmpresaAdicional } from "./actions";

export type EmpresaSelectorItem = {
  id: string;
  nombre: string;
  rut: string | null;
  activaActual: boolean;
  esPrincipal: boolean;
  logoUrl: string;
};

export default function EmpresaBrand({
  nombre,
  logoUrl,
  empresas = [],
  multiempresa = false,
  puedeAgregar = false,
  size = 34,
  textSize = 18,
  maxWidth = 260,
  mesa = "boleta",
  empresaRut = null,
}: {
  nombre: string;
  logoUrl: string;
  empresas?: EmpresaSelectorItem[];
  multiempresa?: boolean;
  puedeAgregar?: boolean;
  size?: number;
  textSize?: number;
  maxWidth?: number;
  /** Mesa activa del escritorio; el conmutador BO|FA vive en este popup. */
  mesa?: "boleta" | "factura";
  /** RUT de la empresa activa — la variante Start/Pro no lista empresas, muestra esto. */
  empresaRut?: string | null;
}) {
  const router = useRouter();
  const [logoOk, setLogoOk] = useState(Boolean(logoUrl));
  const [open, setOpen] = useState(false);
  const [agregando, setAgregando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const rootRef = useRef<HTMLSpanElement>(null);
  // Antes el menú abría solo con multiempresa. Ahora abre SIEMPRE: el
  // conmutador de mesa (boletas|facturas) vive acá, también para Start/Pro
  // (que en vez de lista de empresas muestra la suya con su RUT).
  const puedeListarEmpresas = multiempresa && (empresas.length > 1 || puedeAgregar);
  const canSwitch = true;

  // Cambiar de mesa navega DE VERDAD (no replaceState): la mesa re-siembra
  // todo su estado client-held desde el server, que es la única forma segura
  // de cambiar de mundo (misma razón del remount por empresa). La garantía la
  // da el `key={empresaId}:{mesaParam}` de MesaController en page.tsx — al
  // cambiar la query, React destruye y reconstruye SOLO la mesa con los datos
  // frescos. Por eso basta router.push (navegación de cliente): antes había un
  // window.location.assign que recargaba el documento completo (re-render de
  // todo el server + re-hidratar todo el JS) y hacía sentir el cambio como
  // abrir la app de cero.
  function cambiarMesa(destino: "boleta" | "factura") {
    setOpen(false);
    if (destino === mesa) return;
    router.push(`/massdte?mesa=${destino}`);
  }

  // "Shader cache" del conmutador: al ABRIR el popup (la señal de intención —
  // los botones BO|FA viven ahí) un <Link prefetch={true}> invisible baja la
  // OTRA mesa COMPLETA (con datos; router.prefetch() solo trae el layout en
  // rutas dinámicas — medido: el click igual iba al servidor). El router.push
  // del click consume ese mismo cache (staleTimes.dynamic lo mantiene 30s) →
  // cambio instantáneo. En dev el prefetch es no-op; se siente en build prod.
  const otraMesa = mesa === "boleta" ? "factura" : "boleta";

  useEffect(() => {
    setLogoOk(Boolean(logoUrl));
  }, [logoUrl]);

  // Modo búsqueda/historial (fullscreen): la búsqueda cruza AMBAS mesas, así
  // que el título sobre el logo pasa a "Mesa boleta + factura"; y clickear la
  // marca VUELVE a la mesa (en vez de abrir el popup) — pedido del fundador
  // 2026-08-26: la marca vive una sola vez y es el camino de vuelta.
  const [searchMode, setSearchMode] = useState(false);
  useEffect(() => {
    function onFullscreen(e: Event) {
      setSearchMode(Boolean((e as CustomEvent<{ open?: boolean }>).detail?.open));
    }
    window.addEventListener("toggle-dashboard-fullscreen", onFullscreen);
    return () => window.removeEventListener("toggle-dashboard-fullscreen", onFullscreen);
  }, []);
  function salirDeBusqueda() {
    document.documentElement.classList.remove("v5-dashboard-fullscreen");
    // Mismo evento/forma que toggleDashboardFullscreen: lo escuchan
    // RightColumnView (cierra el overlay) y HeaderActionsRow (resetea la query).
    window.dispatchEvent(new CustomEvent("toggle-dashboard-fullscreen", { detail: { open: false } }));
  }

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    window.addEventListener("pointerdown", onPointerDown);
    return () => window.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  function switchEmpresa(empresaId: string) {
    const selected = empresas.find((empresa) => empresa.id === empresaId);
    if (!selected || selected.activaActual || pending) {
      setOpen(false);
      return;
    }

    setError(null);
    startTransition(async () => {
      const result = await cambiarEmpresaActiva(empresaId);
      if (!result.ok) {
        setError(result.detalle ?? "No se pudo cambiar de empresa.");
        return;
      }
      setOpen(false);
      router.refresh();
    });
  }

  // Con selector, el chevron (13px + gap) vive DENTRO del ancho del brand: si
  // el logo ocupa el slot completo, la flecha se salía de la caja y chocaba con
  // el calendario. Se le descuenta su espacio al logo, no al revés.
  const logoWidth = canSwitch ? maxWidth - 21 : maxWidth;
  const brandContent = (
    <>
      {logoOk ? (
        /* width fijo dejaba aire muerto entre el logo y el chevron (logo AlphaCode
           a h38 mide ~114px, la caja medía 129): la caja ahora ABRAZA la imagen y
           solo CAPEA en maxWidth. El chevron queda pegado al logo real. */
        <span style={{ maxWidth: logoWidth, height: size, display: "flex", alignItems: "center", justifyContent: "flex-start", overflow: "hidden", flexShrink: 1, minWidth: 0 }}>
          <LogoImage src={logoUrl} alt={`Logo de ${nombre}`} maxHeight={size} onError={() => setLogoOk(false)} />
        </span>
      ) : (
        <span style={{ fontSize: textSize, fontWeight: 700, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", minWidth: 0 }}>{nombre}</span>
      )}
      {canSwitch && (
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ color: "var(--text2)", flexShrink: 0 }}>
          <path d="m6 9 6 6 6-6" />
        </svg>
      )}
    </>
  );

  return (
    <span ref={rootRef} style={{ position: "relative", display: "flex", alignItems: "center", gap: logoOk ? 0 : 9, minWidth: 0, width: "fit-content", maxWidth, whiteSpace: "nowrap", flexShrink: 0, overflow: "visible" }}>
      {/* Título de la mesa activa, sobre el logo — el usuario siempre sabe en
          qué mundo está parado sin abrir nada. En modo búsqueda (que cruza
          ambas mesas) dice "Mesa boleta + factura". */}
      <span aria-hidden style={{ position: "absolute", left: 1, top: -13, fontSize: 8, fontWeight: 850, letterSpacing: ".09em", textTransform: "uppercase", color: searchMode ? "var(--text2)" : mesa === "factura" ? "var(--lime)" : "var(--text3)", pointerEvents: "none", whiteSpace: "nowrap" }}>
        {searchMode ? "Mesa boleta + factura" : mesa === "factura" ? "Mesa facturas" : "Mesa boletas"}
      </span>
      {canSwitch ? (
        <button
          type="button"
          onClick={() => (searchMode ? salirDeBusqueda() : setOpen((value) => !value))}
          aria-expanded={searchMode ? undefined : open}
          aria-label={searchMode ? "Volver a la mesa" : "Cambiar empresa"}
          title={searchMode ? "Volver a la mesa" : undefined}
          style={{ display: "flex", alignItems: "center", gap: logoOk ? 6 : 9, minWidth: 0, maxWidth, border: 0, padding: 0, margin: 0, background: "transparent", color: "inherit", cursor: pending ? "wait" : "pointer", textAlign: "left" }}
        >
          {brandContent}
        </button>
      ) : (
        brandContent
      )}

      {open && canSwitch && (
        <div className="eb-pop" style={{ position: "absolute", left: 0, top: size + 10, zIndex: 90, width: `min(${agregando ? 340 : 320}px, calc(100vw - 28px))`, padding: 8, borderRadius: 14, border: "1px solid var(--border)", background: "var(--surface)", boxShadow: "0 24px 70px rgba(0,0,0,.34), inset 0 1px 0 var(--border)", color: "var(--text)", whiteSpace: "normal", transformOrigin: "top left" }}>
          {/* Prefetch COMPLETO de la otra mesa mientras el popup está abierto
              (invisible, 1×1px: los botones visibles quedan intactos). */}
          <Link href={`/massdte?mesa=${otraMesa}`} prefetch={true} aria-hidden tabIndex={-1}
            style={{ position: "absolute", width: 1, height: 1, opacity: 0, pointerEvents: "none", overflow: "hidden" }} />
          {/* Entrada con resorte sutil; el nowrap del brand NO se hereda (los
              textos del panel deben envolver, no escaparse del borde). */}
          <style>{`
            @keyframes ebPopIn{from{opacity:0;transform:translateY(-6px) scale(.97)}to{opacity:1;transform:translateY(0) scale(1)}}
            .eb-pop{animation:ebPopIn .18s cubic-bezier(.22,1,.36,1) both;}
            /* Par BO|FA: al pasar el mouse, el tocado CRECE y aplasta al
               hermano; al salir, ambos vuelven. Misma curva que el resto del
               v5. Sin JS: es pura geometría del contenedor. */
            .eb-bofa{display:flex;gap:5px;flex-shrink:0}
            .eb-bofa button{width:34px;height:26px;border-radius:8px;font-size:10px;font-weight:900;cursor:pointer;font-family:inherit;padding:0;overflow:hidden;white-space:nowrap;transition:width .28s cubic-bezier(.22,1,.36,1),background .2s,border-color .2s,color .2s,font-size .28s cubic-bezier(.22,1,.36,1)}
            .eb-bofa:hover button{width:22px;font-size:9px}
            .eb-bofa:hover button:hover{width:64px;font-size:10px}
            /* Al crecer, la sigla cede el lugar a la palabra completa. */
            .eb-bofa .full{display:none}
            .eb-bofa:hover button:hover .full{display:inline}
            .eb-bofa:hover button:hover .sigla{display:none}
            @media (prefers-reduced-motion: reduce){.eb-pop{animation:none;}.eb-bofa button{transition:background .2s,border-color .2s,color .2s}.eb-bofa:hover button{width:34px;font-size:10px}.eb-bofa:hover button:hover{width:34px}.eb-bofa:hover button:hover .full{display:none}.eb-bofa:hover button:hover .sigla{display:inline}}
          `}</style>
          {agregando ? (
            <AgregarEmpresaForm
              onListo={(empresaId) => {
                setAgregando(false);
                setOpen(false);
                startTransition(async () => {
                  await cambiarEmpresaActiva(empresaId);
                  router.refresh();
                });
              }}
              onCancelar={() => setAgregando(false)}
            />
          ) : (<>
          {puedeListarEmpresas ? (<>
          <div style={{ padding: "7px 8px 9px", fontSize: 9, fontWeight: 850, color: "var(--text3)", textTransform: "uppercase", letterSpacing: ".06em" }}>Cambiar empresa · y mesa</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {empresas.map((empresa) => (
              <div
                key={empresa.id}
                style={{ display: "grid", gridTemplateColumns: "30px 1fr auto", alignItems: "center", gap: 9, width: "100%", minHeight: 42, padding: "7px 8px", borderRadius: 9, border: empresa.activaActual ? "1px solid rgba(232,85,62,.22)" : "1px solid transparent", background: empresa.activaActual ? "rgba(232,85,62,.09)" : "transparent", color: "var(--text)" }}
              >
                <button type="button" onClick={() => switchEmpresa(empresa.id)} disabled={pending} style={{ display: "contents", border: 0, padding: 0, background: "transparent", color: "inherit", cursor: pending ? "wait" : empresa.activaActual ? "default" : "pointer", textAlign: "left", font: "inherit" }}>
                  <span style={{ width: 30, height: 30, borderRadius: 9, display: "grid", placeItems: "center", background: empresa.activaActual ? "rgba(232,85,62,.14)" : "var(--bg-muted)", color: empresa.activaActual ? "var(--accent)" : "var(--text2)", fontSize: 10, fontWeight: 900, flexShrink: 0 }}>
                    {empresa.nombre.slice(0, 2).toUpperCase()}
                  </span>
                  <span style={{ minWidth: 0 }}>
                    <span style={{ display: "block", fontSize: 11, fontWeight: 800, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{empresa.nombre}</span>
                    <span style={{ display: "block", marginTop: 1, fontSize: 9, color: "var(--text2)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{empresa.rut ?? "Empresa"}</span>
                  </span>
                </button>
                {/* El conmutador de mesa solo en la empresa ACTUAL: cambiar de
                    empresa Y de mesa en un click sería adivinar la intención. */}
                {empresa.activaActual ? (
                  <span className="eb-bofa">
                    <button type="button" onClick={() => cambiarMesa("boleta")} title="Mesa boletas"
                      style={{
                        border: mesa === "boleta" ? "1px solid rgba(232,85,62,.5)" : "1px solid var(--border)",
                        background: mesa === "boleta" ? "rgba(232,85,62,.1)" : "transparent",
                        color: mesa === "boleta" ? "var(--accent)" : "var(--text3)" }}><span className="sigla">BO</span><span className="full">Boleta</span></button>
                    <button type="button" onClick={() => cambiarMesa("factura")} title="Mesa facturas"
                      style={{
                        border: mesa === "factura" ? "1px solid rgba(201,242,75,.5)" : "1px solid var(--border)",
                        background: mesa === "factura" ? "rgba(201,242,75,.06)" : "transparent",
                        color: mesa === "factura" ? "var(--lime)" : "var(--text3)" }}><span className="sigla">FA</span><span className="full">Factura</span></button>
                  </span>
                ) : (
                  <span />
                )}
              </div>
            ))}
          </div>
          </>) : (<>
          {/* Start/Pro: MISMA fila y MISMOS pills BO|FA que Business (decisión
              fundador 2026-08-26: los botones de mesa se ven iguales en todos
              los planes — antes acá había botones grandes distintos). */}
          <div style={{ padding: "7px 8px 9px", fontSize: 9, fontWeight: 850, color: "var(--text3)", textTransform: "uppercase", letterSpacing: ".06em" }}>Tu empresa · y mesa</div>
          <div
            style={{ display: "grid", gridTemplateColumns: "30px 1fr auto", alignItems: "center", gap: 9, width: "100%", minHeight: 42, padding: "7px 8px", borderRadius: 9, border: "1px solid rgba(232,85,62,.22)", background: "rgba(232,85,62,.09)", color: "var(--text)" }}
          >
            <span style={{ width: 30, height: 30, borderRadius: 9, display: "grid", placeItems: "center", background: "rgba(232,85,62,.14)", color: "var(--accent)", fontSize: 10, fontWeight: 900, flexShrink: 0 }}>{nombre.slice(0, 2).toUpperCase()}</span>
            <span style={{ minWidth: 0 }}>
              <span style={{ display: "block", fontSize: 11, fontWeight: 800, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{nombre}</span>
              <span style={{ display: "block", marginTop: 1, fontSize: 9, color: "var(--text2)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{empresaRut ?? "Empresa"}</span>
            </span>
            <span className="eb-bofa">
              <button type="button" onClick={() => cambiarMesa("boleta")} title="Mesa boletas"
                style={{
                  border: mesa === "boleta" ? "1px solid rgba(232,85,62,.5)" : "1px solid var(--border)",
                  background: mesa === "boleta" ? "rgba(232,85,62,.1)" : "transparent",
                  color: mesa === "boleta" ? "var(--accent)" : "var(--text3)" }}><span className="sigla">BO</span><span className="full">Boleta</span></button>
              <button type="button" onClick={() => cambiarMesa("factura")} title="Mesa facturas"
                style={{
                  border: mesa === "factura" ? "1px solid rgba(201,242,75,.5)" : "1px solid var(--border)",
                  background: mesa === "factura" ? "rgba(201,242,75,.06)" : "transparent",
                  color: mesa === "factura" ? "var(--lime)" : "var(--text3)" }}><span className="sigla">FA</span><span className="full">Factura</span></button>
            </span>
          </div>
          </>)}
          {puedeListarEmpresas && puedeAgregar && (
            <button
              type="button"
              onClick={() => setAgregando(true)}
              style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", marginTop: 6, padding: "9px 8px", borderRadius: 9, border: "1px dashed var(--border)", background: "transparent", color: "var(--text2)", fontSize: 11, fontWeight: 800, cursor: "pointer", textAlign: "left" }}
            >
              <span style={{ width: 30, height: 30, borderRadius: 9, display: "grid", placeItems: "center", background: "var(--bg-muted)", fontSize: 15, fontWeight: 700 }}>+</span>
              Agregar empresa
            </button>
          )}
          {error && <div style={{ margin: "8px 8px 2px", color: "var(--red)", fontSize: 9, lineHeight: 1.35 }}>{error}</div>}
          </>)}
        </div>
      )}
    </span>
  );
}

/**
 * Alta de empresa adicional (Business): RUT verificado EN VIVO contra la nómina
 * pública de personas jurídicas del SII — al encontrarla, la razón social se
 * autocompleta y el usuario CONFIRMA viendo el nombre (un typo con DV válido
 * muestra otra empresa y se delata solo). El RUT queda inmutable tras la
 * primera emisión, así que este es EL momento de escribirlo bien.
 */
function AgregarEmpresaForm({ onListo, onCancelar }: { onListo: (empresaId: string) => void; onCancelar: () => void }) {
  const [rut, setRut] = useState("");
  const [razon, setRazon] = useState("");
  const [verif, setVerif] = useState<
    | { estado: "idle" | "buscando" }
    | { estado: "encontrada"; razon: string; terminoGiro: string | null }
    | { estado: "no_encontrada" }
    | { estado: "dv_malo" }
  >({ estado: "idle" });
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function verificar() {
    const limpio = rut.replace(/[^0-9kK]/g, "");
    // Bajo ~50M es RUT de persona natural: no está en la nómina de jurídicas
    // y no se busca en fuentes públicas (solo validación de dígito).
    const cuerpo = Number(limpio.slice(0, -1));
    if (limpio.length < 7 || !Number.isFinite(cuerpo) || cuerpo < 50_000_000) { setVerif({ estado: "idle" }); return; }
    setVerif({ estado: "buscando" });
    try {
      const res = await fetch(`/api/empresa/verificar-rut?rut=${encodeURIComponent(rut)}`);
      const data = await res.json();
      if (!data?.ok || data.dv_valido === false || data.dv_coincide === false) { setVerif({ estado: "dv_malo" }); return; }
      if (data.encontrado) {
        setVerif({ estado: "encontrada", razon: data.razon_social, terminoGiro: data.termino_giro ?? null });
        setRazon((prev) => prev || data.razon_social);
      } else {
        setVerif({ estado: "no_encontrada" });
      }
    } catch { setVerif({ estado: "no_encontrada" }); }
  }

  async function enviar() {
    if (enviando) return;
    setError(null);
    setEnviando(true);
    const r = await crearEmpresaAdicional({ rut, razon_social: razon });
    setEnviando(false);
    if (!r.ok) { setError(r.detalle ?? "No se pudo crear la empresa."); return; }
    onListo(r.empresa_id);
  }

  const inputStyle = { width: "100%", boxSizing: "border-box" as const, padding: "10px 12px", borderRadius: 10, border: "1px solid var(--border)", background: "var(--bg-muted)", color: "var(--text)", fontSize: 12, outline: "none", lineHeight: 1.3 };
  return (
    <div style={{ padding: 8 }}>
      <div style={{ padding: "2px 2px 12px", fontSize: 9, fontWeight: 850, color: "var(--text3)", textTransform: "uppercase", letterSpacing: ".08em" }}>Agregar empresa</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <div>
          <input value={rut} onChange={(e) => setRut(e.target.value)} onBlur={verificar}
            placeholder="RUT de la empresa (76.123.456-7)" style={inputStyle} autoFocus />
          {verif.estado === "buscando" && <div style={{ marginTop: 4, fontSize: 9, color: "var(--text3)" }}>Buscando en el registro del SII…</div>}
          {verif.estado === "encontrada" && (
            <div style={{ marginTop: 4, fontSize: 9.5, color: "var(--green)", lineHeight: 1.4 }}>
              ✓ {verif.razon}
              {verif.terminoGiro && <span style={{ display: "block", color: "var(--amber)" }}>⚠ Esta empresa registra término de giro ({verif.terminoGiro}) ante el SII.</span>}
            </div>
          )}
          {verif.estado === "no_encontrada" && (
            <div style={{ marginTop: 4, fontSize: 9, color: "var(--text2)", lineHeight: 1.4 }}>
              No aparece en el registro público del SII. Si la empresa es nueva es normal (el registro se actualiza con rezago) — revisa que el RUT esté bien y continúa.
            </div>
          )}
          {verif.estado === "dv_malo" && (
            <div style={{ marginTop: 4, fontSize: 9, color: "var(--red)" }}>Ese RUT no cuadra — revisa los números y el dígito verificador.</div>
          )}
        </div>
        {/* Razón social: la autocompleta el registro del SII; solo se pide a
            mano si el RUT no aparece (empresa nueva / persona natural). */}
        {verif.estado !== "encontrada" && (
          <input value={razon} onChange={(e) => setRazon(e.target.value)} placeholder="Razón social" style={inputStyle} />
        )}
        <div style={{ fontSize: 9.5, color: "var(--text3)", lineHeight: 1.55, padding: "0 2px" }}>
          Al crearla verás su mesa vacía; el logo y sus datos se configuran después
          en «Empresa». El RUT queda fijo tras la primera boleta emitida.
        </div>
        {error && <div style={{ color: "var(--red)", fontSize: 9.5, lineHeight: 1.4 }}>{error}</div>}
        <div style={{ display: "flex", gap: 6 }}>
          <button type="button" onClick={onCancelar} disabled={enviando}
            style={{ flex: 1, padding: "10px 0", borderRadius: 10, border: "1px solid var(--border)", background: "transparent", color: "var(--text2)", fontSize: 11, fontWeight: 700, cursor: "pointer" }}>
            Cancelar
          </button>
          <button type="button" onClick={enviar} disabled={enviando || !rut || !razon || verif.estado === "dv_malo"}
            style={{ flex: 2, padding: "10px 0", borderRadius: 10, border: 0, background: "var(--accent)", color: "#fff", fontSize: 11, fontWeight: 800, cursor: enviando ? "wait" : "pointer", opacity: enviando || !rut || !razon ? 0.55 : 1, transition: "opacity .15s" }}>
            {enviando ? "Creando…" : "Crear empresa"}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * La silueta blanca (brightness(0) invert(1)) existe para que un logo oscuro
 * monocromo no desaparezca sobre el dashboard oscuro. Pero aplicarla siempre
 * mata los logos con color. Acá se analiza el logo (same-origin → canvas
 * legible) y la silueta se activa SOLO si es oscuro y sin color; además solo
 * rige en tema oscuro (vía CSS .dark).
 */
function LogoImage({ src, alt, maxHeight, onError }: { src: string; alt: string; maxHeight: number; onError: () => void }) {
  const [silhouette, setSilhouette] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const img = new Image();
    img.src = src;
    img.onload = () => {
      try {
        const S = 24;
        const canvas = document.createElement("canvas");
        canvas.width = S;
        canvas.height = S;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        ctx.drawImage(img, 0, 0, S, S);
        const { data } = ctx.getImageData(0, 0, S, S);
        let n = 0, lumSum = 0, colorful = 0;
        for (let i = 0; i < data.length; i += 4) {
          if (data[i + 3] < 40) continue; // transparente: fuera
          const r = data[i], g = data[i + 1], b = data[i + 2];
          n++;
          lumSum += (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
          if ((Math.max(r, g, b) - Math.min(r, g, b)) / 255 > 0.22) colorful++;
        }
        if (!cancelled && n > 0) {
          setSilhouette(lumSum / n < 0.45 && colorful / n < 0.08);
        }
      } catch {
        /* canvas tainted u otro fallo: se queda el logo original */
      }
    };
    return () => { cancelled = true; };
  }, [src]);

  return (
    <span style={{ position: "relative", display: "inline-flex", alignItems: "center", height: maxHeight, maxWidth: "100%", overflow: "visible" }}>
      <style>{`.eb-sil{display:none}.dark .eb-sil{display:block}`}</style>
      {/* eslint-disable-next-line @next/next/no-img-element -- API same-origin con cookies (el optimizer de next/image no autentica) + tamaño natural */}
      <img
        src={src}
        alt={alt}
        onError={onError}
        style={{ maxHeight, maxWidth: "100%", width: "auto", height: "auto", objectFit: "contain", display: "block" }}
      />
      {silhouette && (
        // eslint-disable-next-line @next/next/no-img-element -- overlay silueta del mismo recurso
        <img
          src={src}
          alt=""
          aria-hidden="true"
          className="eb-sil"
          style={{ position: "absolute", inset: 0, maxHeight, maxWidth: "100%", width: "auto", height: "auto", objectFit: "contain", filter: "brightness(0) invert(1)", mixBlendMode: "lighten", pointerEvents: "none" }}
        />
      )}
    </span>
  );
}
