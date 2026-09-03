"use client";

import { useEffect, useRef, useState } from "react";

/**
 * La animación de la escalera (iterada con el fundador sobre mocks,
 * 2026-09-01): cuenta la historia completa con las MISMAS piezas del landing
 * — chip de la Chrome Web Store cuyo botón se aprieta solo, el ícono massDTE
 * acoplándose a su ranura en la pantallita, el chip de la clave cifrándose
 * (candado que se posa), el viaje-y-hundirse en el monitor, la tira de
 * barritas encendiéndose y los vouchers «✓ Emitida» como clímax. El texto
 * grande de abajo va sincronizado con cada fase.
 *
 * Disciplina de recursos (mismas reglas del saneamiento perf del v5):
 *  - Se PAUSA fuera del viewport (IntersectionObserver — el ciclo espera).
 *  - Con prefers-reduced-motion no hay ciclo: composición estática final.
 */

const CAPS = [
  <>Tu único paso: <b style={{ color: "var(--text)" }}>instala la extensión</b> — 30 segundos.</>,
  <>Guarda tu clave <b style={{ color: "var(--text)" }}>una sola vez</b> — cifrada en tu computador.</>,
  <>La extensión entra al <b style={{ color: "var(--text)" }}>SII con tu sesión</b>, igual que tú.</>,
  <>Y tus boletas <b style={{ color: "var(--text)" }}>salen de verdad</b>, una por una.</>,
];

const RESORTE = "cubic-bezier(.2,1.5,.35,1)";
const VIAJE = "cubic-bezier(.45,0,.2,1)";

export default function AnimacionConectaSII() {
  const stageRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const storeRef = useRef<HTMLDivElement>(null);
  const agcRef = useRef<HTMLSpanElement>(null);
  const mdockRef = useRef<HTMLDivElement>(null);
  const slotRef = useRef<HTMLSpanElement>(null);
  const chipRef = useRef<HTMLDivElement>(null);
  const kbarRef = useRef<HTMLDivElement>(null);
  const padRef = useRef<HTMLDivElement>(null);
  const fhRef = useRef<HTMLDivElement>(null);
  const monRef = useRef<HTMLDivElement>(null);
  const v1Ref = useRef<HTMLDivElement>(null);
  const v2Ref = useRef<HTMLDivElement>(null);
  const ledsRef = useRef<HTMLDivElement>(null);
  // El padre (la escalera) devuelve null hasta resolver el PONG, así que este
  // componente solo monta en cliente: el initializer puede mirar matchMedia.
  const [estatico] = useState(() => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  const [cap, setCap] = useState(() => (estatico ? 3 : 0));
  const [capVisible, setCapVisible] = useState(true);

  useEffect(() => {
    if (estatico) return;

    let vivo = true;
    let visible = true;
    const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting; }, { threshold: 0.15 });
    if (stageRef.current) io.observe(stageRef.current);

    const wait = (ms: number) =>
      new Promise<void>((resolve) => {
        const fin = Date.now() + ms;
        const tick = () => {
          if (!vivo) return; // desmontado: no resolvemos, el ciclo muere acá
          if (!visible) { setTimeout(tick, 300); return; } // pausado fuera de viewport
          if (Date.now() >= fin) resolve();
          else setTimeout(tick, 50);
        };
        tick();
      });

    const ponerCap = (i: number) => {
      setCapVisible(false);
      setTimeout(() => { if (vivo) { setCap(i); setCapVisible(true); } }, 180);
    };

    // flote ±6px del chip de la clave (mismo del landing)
    let flotando = false; let fb = 0; let rafId = 0;
    const floatLoop = () => {
      if (!vivo) return;
      fb += 0.025;
      if (flotando && chipRef.current) chipRef.current.style.translate = `0 ${Math.sin(fb) * 6}px`;
      rafId = requestAnimationFrame(floatLoop);
    };
    rafId = requestAnimationFrame(floatLoop);

    async function ciclo() {
      const store = storeRef.current, agc = agcRef.current, mdock = mdockRef.current,
        slot = slotRef.current, chip = chipRef.current, kbar = kbarRef.current,
        pad = padRef.current, fh = fhRef.current, mon = monRef.current,
        inner = innerRef.current, stage = stageRef.current, leds = ledsRef.current;
      if (!store || !agc || !mdock || !slot || !chip || !kbar || !pad || !fh || !mon || !inner || !stage || !leds) return;
      const ls = Array.from(leds.children) as HTMLElement[];

      while (vivo) {
        /* reset (bajo el fade — nadie ve el salto) */
        flotando = false;
        store.style.transition = "none"; store.style.opacity = "1"; store.style.scale = "1";
        agc.textContent = "Agregar a Chrome"; agc.style.transform = ""; agc.style.background = "linear-gradient(160deg,#3b8bf0,#1a73e8)";
        mdock.style.transition = "none"; mdock.style.opacity = "0"; mdock.style.transform = "";
        slot.style.borderColor = "";
        chip.style.transition = "none"; chip.style.left = "26px"; chip.style.top = "84px";
        chip.style.opacity = "0"; chip.style.scale = ".94"; chip.style.rotate = "0deg"; chip.style.translate = "0 0";
        kbar.style.transition = "none"; kbar.style.width = "0%";
        pad.style.opacity = "0"; pad.style.transform = "scale(.3)"; pad.style.transition = "none";
        fh.style.opacity = "0";
        [v1Ref.current, v2Ref.current].forEach((v) => { if (v) { v.style.opacity = "0"; v.style.transform = "translateY(10px) scale(.92)"; v.style.transition = "none"; } });
        ls.forEach((l) => { l.style.background = "rgba(255,255,255,.07)"; l.style.boxShadow = "none"; });
        mon.style.transition = "none"; mon.style.boxShadow = ""; mon.style.borderColor = "";
        mon.style.transform = "";
        // candado y hint pegados al chip
        pad.style.left = `${chip.offsetLeft + chip.offsetWidth - 16}px`;
        pad.style.top = `${chip.offsetTop - 11}px`;
        fh.style.left = `${chip.offsetLeft + 8}px`;
        fh.style.top = `${chip.offsetTop + chip.offsetHeight + 10}px`;
        inner.style.opacity = "1";
        ponerCap(0);
        await wait(1000); if (!vivo) return;

        /* 1 · el botón azul se aprieta solo → ✓ Instalada */
        agc.style.transition = "all .25s"; agc.style.transform = "scale(.88)";
        await wait(200); if (!vivo) return;
        agc.style.transform = ""; agc.textContent = "✓ Instalada";
        agc.style.background = "linear-gradient(160deg,#22a04c,#188038)";
        await wait(850); if (!vivo) return;

        /* 2 · el ícono massDTE viaja a SU RANURA en la barra */
        const stR = stage.getBoundingClientRect();
        const sR = slot.getBoundingClientRect();
        mdock.style.left = `${store.offsetLeft + 14}px`;
        mdock.style.top = `${store.offsetTop + 19}px`;
        mdock.style.opacity = "1";
        store.style.transition = "all .55s cubic-bezier(.5,0,.6,1)";
        store.style.opacity = "0"; store.style.scale = ".92";
        await wait(70); if (!vivo) return;
        mdock.style.transition = `all .95s ${VIAJE}`;
        mdock.style.left = `${sR.left - stR.left}px`;
        mdock.style.top = `${sR.top - stR.top}px`;
        await wait(1000); if (!vivo) return;
        slot.style.borderColor = "transparent";

        /* 3 · chip de la clave: aparece, la barrita se llena, el candado se posa */
        chip.style.transition = `all .55s ${RESORTE}`;
        chip.style.opacity = "1"; chip.style.scale = "1";
        flotando = true; fh.style.transition = "opacity .4s"; fh.style.opacity = "1";
        ponerCap(1);
        await wait(700); if (!vivo) return;
        kbar.style.transition = "width 900ms ease"; kbar.style.width = "100%";
        await wait(1150); if (!vivo) return;
        pad.style.transition = "all .45s cubic-bezier(.2,1.6,.4,1)";
        pad.style.opacity = "1"; pad.style.transform = "scale(1)";
        await wait(950); if (!vivo) return;

        /* 4 · el chip viaja y se hunde en la pantallita */
        flotando = false; fh.style.opacity = "0";
        pad.style.opacity = "0";
        chip.style.transition = `all 1.05s ${VIAJE}`;
        chip.style.left = "calc(100% - 214px)"; chip.style.top = "56px";
        chip.style.scale = ".36"; chip.style.opacity = "0"; chip.style.rotate = "4deg";
        ponerCap(2);
        await wait(1250); if (!vivo) return;

        /* 5 · el monitor se enciende, la tira corre y las boletas salen.
           Con la izquierda ya vacía (el chip se hundió), la pantallita migra
           al CENTRO del escenario — pedido fundador 2026-09-02: que no quede
           colgada a la derecha con un hoyo al lado. */
        const dx = (stage.clientWidth - mon.offsetWidth) / 2 - mon.offsetLeft;
        mon.style.transition = `transform .9s ${VIAJE}, box-shadow .8s, border-color .8s`;
        mon.style.transform = `translateX(${dx}px)`;
        // el ícono acoplado en la ranura vive en coordenadas del escenario: viaja con el monitor
        mdock.style.transition = `transform .9s ${VIAJE}`;
        mdock.style.transform = `translateX(${dx}px)`;
        mon.style.boxShadow = "0 18px 44px #00000090, 0 0 44px #22c55e1f";
        mon.style.borderColor = "rgba(34,197,94,.18)";
        for (const l of ls) {
          l.style.background = "#a3e635"; l.style.boxShadow = "0 0 6px rgba(163,230,53,.53)";
          await wait(55); if (!vivo) return;
        }
        await wait(280); if (!vivo) return;
        ponerCap(3);
        for (const v of [v1Ref.current, v2Ref.current]) {
          if (v) { v.style.transition = `all .55s ${RESORTE}`; v.style.opacity = "1"; v.style.transform = "none"; }
          await wait(650); if (!vivo) return;
        }
        await wait(2600); if (!vivo) return;

        /* fade suave y de nuevo */
        inner.style.transition = "opacity .6s ease";
        inner.style.opacity = "0"; setCapVisible(false);
        await wait(700); if (!vivo) return;
      }
    }
    void ciclo();

    return () => { vivo = false; cancelAnimationFrame(rafId); io.disconnect(); };
  }, [estatico]);

  const tile = { display: "grid", placeItems: "center", flexShrink: 0 } as const;

  return (
    <div>
      <div ref={stageRef} style={{ marginTop: 13, position: "relative", height: 210, borderRadius: 14, border: "1px solid rgba(255,255,255,.06)", background: "#0b0b0c", overflow: "hidden" }}>
        <div ref={innerRef} style={{ position: "absolute", inset: 0 }}>

          {/* acto 1: la Chrome Web Store */}
          <div ref={storeRef} style={{ position: "absolute", left: 26, top: 26, width: 296, borderRadius: 15, border: "1px solid rgba(232,85,62,.19)", background: "linear-gradient(160deg,#171110,#0d0d0d)", padding: "14px 15px", boxShadow: "0 16px 38px rgba(0,0,0,.52), 0 0 38px rgba(232,85,62,.13), inset 0 1px 0 rgba(255,255,255,.05)", display: "flex", alignItems: "center", gap: 12, opacity: estatico ? 0 : 1 }}>
            <span style={{ ...tile, width: 46, height: 46, borderRadius: 12, boxShadow: "0 6px 16px rgba(232,85,62,.27)", overflow: "hidden" }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/icon-192.png" alt="" style={{ width: "100%", height: "100%", borderRadius: 12, display: "block" }} />
            </span>
            <span style={{ fontSize: 13, fontWeight: 700, color: "#fff", whiteSpace: "nowrap", letterSpacing: "-.01em" }}>
              MassDTE — Motor Local
              <small style={{ display: "block", fontWeight: 500, color: "var(--text3)", fontSize: 10, marginTop: 2 }}>Chrome Web Store</small>
            </span>
            <span ref={agcRef} style={{ marginLeft: "auto", background: "linear-gradient(160deg,#3b8bf0,#1a73e8)", color: "#fff", fontSize: 10.5, fontWeight: 750, padding: "8px 13px", borderRadius: 8, whiteSpace: "nowrap", flexShrink: 0, boxShadow: "0 4px 12px rgba(26,115,232,.27)" }}>
              Agregar a Chrome
            </span>
          </div>
          <div ref={mdockRef} style={{ position: "absolute", width: 18, height: 18, borderRadius: 5, opacity: 0, zIndex: 6, boxShadow: "0 3px 9px rgba(232,85,62,.33)", overflow: "hidden" }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/icon-192.png" alt="" style={{ width: "100%", height: "100%", borderRadius: 5, display: "block" }} />
          </div>

          {/* acto 2: chip de la clave */}
          <div ref={chipRef} style={{ position: "absolute", left: 26, top: 84, opacity: estatico ? 1 : 0, display: "flex", width: 224, alignItems: "center", gap: 13, borderRadius: 15, border: "1px solid rgba(245,192,78,.18)", background: "linear-gradient(160deg,#17150f,#0d0d0d)", padding: "14px 15px", boxShadow: "0 16px 38px rgba(0,0,0,.52), 0 0 34px rgba(245,192,78,.11), inset 0 1px 0 rgba(255,255,255,.05)" }}>
            <span style={{ ...tile, width: 46, height: 46, borderRadius: 12, border: "1px solid rgba(245,192,78,.33)", background: "linear-gradient(160deg,rgba(245,192,78,.14),rgba(245,192,78,.04))", boxShadow: "0 0 18px rgba(245,192,78,.12)" }}>
              <svg viewBox="0 0 24 24" style={{ width: 21, height: 21 }} stroke="#f5c04e" fill="none" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="8" cy="15" r="4" /><path d="M11 12 L20 3 M17 6 l3 3 M14 9 l2.4 2.4" /></svg>
            </span>
            <span style={{ minWidth: 0 }}>
              <span style={{ display: "block", fontSize: 13.5, fontWeight: 700, color: "#fff", whiteSpace: "nowrap", letterSpacing: "-.01em" }}>Clave del SII</span>
              <span style={{ display: "block", marginTop: 7, height: 6, width: 96, borderRadius: 99, background: "rgba(255,255,255,.07)", position: "relative", overflow: "hidden" }}>
                <span ref={kbarRef as React.RefObject<HTMLDivElement>} style={{ position: "absolute", inset: 0, width: estatico ? "100%" : "0%", background: "linear-gradient(90deg,rgba(245,192,78,.47),#f5c04e)", borderRadius: 99 }} />
              </span>
            </span>
          </div>
          <div ref={padRef} style={{ position: "absolute", width: 27, height: 27, borderRadius: 99, background: "#161616", border: "1.5px solid rgba(245,192,78,.4)", display: "grid", placeItems: "center", opacity: 0, transform: "scale(.3)", zIndex: 4 }}>
            <svg viewBox="0 0 24 24" style={{ width: 13, height: 13 }} stroke="#f5c04e" fill="none" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></svg>
          </div>
          <div ref={fhRef} style={{ position: "absolute", fontSize: 11.5, color: "rgba(255,255,255,.27)", whiteSpace: "nowrap", opacity: 0 }}>queda cifrada en tu equipo →</div>

          {/* la pantallita sii.cl */}
          <div ref={monRef} style={{ position: "absolute", right: 26, top: 24, width: 300, height: 164, borderRadius: 13, border: "1px solid rgba(255,255,255,.1)", background: "linear-gradient(180deg,#141414,#0e0e0e)", boxShadow: "0 18px 44px rgba(0,0,0,.56)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 7, height: 27, padding: "0 11px", borderBottom: "1px solid rgba(255,255,255,.06)" }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/massdte-logo.png" alt="massDTE" style={{ height: 10, width: "auto", display: "block", flexShrink: 0, filter: "invert(1)" }} />
              <div ref={ledsRef} style={{ display: "flex", gap: 2.5, overflow: "hidden" }}>
                {Array.from({ length: 14 }).map((_, i) => (
                  <span key={i} style={{ width: 5, height: 11, borderRadius: 2, background: estatico ? "#a3e635" : "rgba(255,255,255,.07)", flexShrink: 0 }} />
                ))}
              </div>
              <span ref={slotRef} style={{ width: 18, height: 18, borderRadius: 5, border: estatico ? "none" : "1px dashed rgba(255,255,255,.12)", flexShrink: 0 }}>
                {estatico && (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img src="/icon-192.png" alt="" style={{ width: "100%", height: "100%", borderRadius: 5, display: "block" }} />
                )}
              </span>
              <span style={{ marginLeft: "auto", fontSize: 8.5, color: "var(--text3)", whiteSpace: "nowrap", flexShrink: 0 }}>sii.cl · tu sesión</span>
            </div>
            <div style={{ padding: "9px 11px", display: "flex", flexDirection: "column", gap: 6 }}>
              {[{ r: v1Ref, n: 47, m: "$450.000" }, { r: v2Ref, n: 48, m: "$250.000" }].map((v) => (
                <div key={v.n} ref={v.r} style={{ display: "flex", alignItems: "center", gap: 9, border: "1px solid rgba(34,197,94,.2)", background: "rgba(34,197,94,.05)", borderRadius: 9, padding: "7px 10px", opacity: estatico ? 1 : 0, transform: estatico ? "none" : "translateY(10px) scale(.92)" }}>
                  <span style={{ fontSize: 9.5, fontWeight: 700, color: "rgba(255,255,255,.85)", letterSpacing: ".02em" }}>
                    BOLETA ELECTRÓNICA
                    <small style={{ display: "block", fontWeight: 400, color: "var(--text3)", fontSize: 8.5, letterSpacing: 0, marginTop: 1 }}>N° {v.n}</small>
                  </span>
                  <span style={{ marginLeft: "auto", fontSize: 11, fontWeight: 800, fontVariantNumeric: "tabular-nums", color: "var(--text)" }}>{v.m}</span>
                  <span style={{ fontSize: 8.5, color: "var(--green, #22c55e)", fontWeight: 700, whiteSpace: "nowrap" }}>✓ Emitida</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* el texto grande sincronizado */}
      <div style={{ marginTop: 14, textAlign: "center", fontSize: 18, fontWeight: 550, color: "var(--text2)", minHeight: 28, transition: "opacity .35s", letterSpacing: "-.015em", opacity: capVisible ? 1 : 0 }}>
        {CAPS[cap]}
      </div>
    </div>
  );
}
