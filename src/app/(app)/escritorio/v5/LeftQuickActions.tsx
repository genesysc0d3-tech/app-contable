"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import EmitirDirectaView from "./EmitirDirectaView";
import DropzoneUpload from "./DropzoneUpload";
import GlowWrap from "./GlowWrap";
import { useEmissionLockStatus } from "./useEmissionLockStatus";
import { useToast } from "@/components/Toast";
import { chileDateString } from "@/lib/chile-date";
import { signOut } from "@/app/(auth)/auth/actions";

function todayStr() {
  return chileDateString();
}

type EmisionProveedorUi = "mock" | "sii_local" | "simpleapi";

export function EmisionDirectaAction({ empresaTipo, empresaId, emisionProveedor = "mock", facturasProveedor = "mock", devMode = false, empresaRut, empresaRazonSocial, empresaGiro, empresaDireccion, empresaComuna, readOnlyReason }: { empresaTipo?: string | null; empresaId?: string; emisionProveedor?: EmisionProveedorUi; facturasProveedor?: "mock" | "simpleapi"; devMode?: boolean; empresaRut?: string | null; empresaRazonSocial?: string | null; empresaGiro?: string | null; empresaDireccion?: string | null; empresaComuna?: string | null; readOnlyReason?: string }) {
  const [open, setOpen] = useState(false);
  const usesRealProvider = emisionProveedor === "sii_local" || facturasProveedor === "simpleapi";
  const { lockedByOtherUser, businessMode, lockMessage } = useEmissionLockStatus({ enabled: usesRealProvider });
  const { toast } = useToast();
  // openRef: el listener siempre-montado lee el estado actual del modal sin re-suscribirse.
  const openRef = useRef(open);
  useEffect(() => { openRef.current = open; }, [open]);

  // Aviso "✓ emitida" SIEMPRE montado (el botón vive fijo en la barra; el modal es
  // condicional). El window.postMessage del bridge llega a la PÁGINA aunque el modal
  // esté cerrado, así el aviso ya no se pierde al cerrarlo. El REFRESCO de la mesa lo
  // hace el sensor central Realtime de MesaController (el INSERT en boletas_emitidas),
  // no este listener; acá solo mostramos la confirmación cuando el modal no está para
  // hacerlo. Dedup por job para no repetir el toast ante reentrega/mensaje duplicado.
  const handledJobsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    function onEmissionResult(event: MessageEvent) {
      if (event.origin !== window.location.origin) return;
      const data = event.data as { source?: string; type?: string; job_id?: string | null; result?: { folio?: number; folio_confidence?: string; persisted?: { ok?: boolean } } } | undefined;
      if (data?.source !== "app-contable-extension" || data.type !== "APP_CONTABLE_SII_JOB_RESULT") return;
      const emitted = Boolean(data.result?.folio && data.result.folio_confidence === "high" && data.result.persisted?.ok === true);
      if (!emitted) return;
      const jobKey = String(data.job_id ?? data.result?.folio ?? "");
      if (handledJobsRef.current.has(jobKey)) return;
      handledJobsRef.current.add(jobKey);
      if (!openRef.current) toast(`Boleta #${data.result?.folio} emitida y guardada.`, "success");
    }
    window.addEventListener("message", onEmissionResult);
    return () => window.removeEventListener("message", onEmissionResult);
  }, [toast]);

  function closeWithSavedPulse(saved = false) {
    setOpen(false);
    if (saved) {
      window.dispatchEvent(new CustomEvent("v5-popup-saved", { detail: { label: "Borrador guardado" } }));
    }
  }

  function openIfAvailable() {
    if (readOnlyReason) return;
    if (lockedByOtherUser) return;
    setOpen(true);
  }

  return (
    <>
      <style>{`
        .ed-overlay{position:fixed;inset:0;z-index:80;display:flex;align-items:center;justify-content:center;padding:18px;background:rgba(0,0,0,.58);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);animation:edFadeIn .2s ease both}
        .ed-panel{width:min(880px,96vw);max-height:92vh;border-radius:20px;overflow:visible;background:var(--surface);border:1px solid var(--border);box-shadow:0 30px 90px rgba(0,0,0,.45),inset 0 1px 0 var(--border);display:flex;flex-direction:column}
        @keyframes edFadeIn{from{opacity:0}to{opacity:1}}
        .sp{position:relative;z-index:0;width:100%;overflow:hidden}
        .sparkle-button{--active:0;--transition:.3s;--spark:1.8s;--cut:0px;--accent-h:77;--accent-s:88%;--accent-l:55%;--bg:radial-gradient(40% 50% at center 100%,hsl(var(--accent-h) calc(var(--active) * 88%) 70% / var(--active)),transparent),radial-gradient(80% 100% at center 120%,hsl(var(--accent-h) calc(var(--active) * 88%) 56% / var(--active)),transparent),hsl(var(--accent-h) calc(var(--active) * 88%) calc((var(--active) * 28%) + 16%));position:relative;display:flex;align-items:center;gap:10px;width:100%;padding:10px 14px;border:0;border-bottom:1px solid var(--border);border-radius:0;background:linear-gradient(135deg, rgba(180,240,39,.13), rgba(180,240,39,.04));color:var(--lime);cursor:pointer;text-align:left;white-space:normal;box-shadow:0 0 calc(var(--active) * 2em) calc(var(--active) * .35em) hsl(var(--accent-h) var(--accent-s) var(--accent-l) / .25),0 0 0 0 hsl(var(--accent-h) calc(var(--active) * 88%) calc((var(--active) * 42%) + 32%)) inset,0 -.05em 0 0 hsl(var(--accent-h) calc(var(--active) * 88%) calc(var(--active) * 55%)) inset;transition:box-shadow var(--transition),background var(--transition),color var(--transition);overflow:hidden}
        .sparkle-button:is(:hover,:focus-visible){--active:1;background:var(--bg);color:#2f5a0d;outline:none}
        .sparkle-button:disabled,.sparkle-button:disabled:is(:hover,:focus-visible){--active:0;background:linear-gradient(135deg, rgba(245,158,11,.12), rgba(245,158,11,.04));color:var(--amber);cursor:not-allowed;box-shadow:none;filter:saturate(.78);opacity:.86}
        .sparkle-button:active{filter:brightness(.96);transition:.3s}
        .sparkle-button:before{content:"";position:absolute;inset:0;z-index:0;border:1px solid hsl(var(--accent-h) var(--accent-s) 50% / .22);opacity:var(--active,0);transition:opacity var(--transition);pointer-events:none}
        .spark{position:absolute;inset:0;border-radius:inherit;rotate:0deg;overflow:hidden;mask:linear-gradient(white,transparent 50%);animation:flip calc(var(--spark) * 2) infinite steps(2,end);pointer-events:none}
        .spark:before{content:"";position:absolute;width:200%;aspect-ratio:1;top:0;left:50%;z-index:-1;translate:-50% -15%;transform:rotate(-90deg);opacity:calc(var(--active) + .4);background:conic-gradient(from 0deg,transparent 0 340deg,white 360deg);transition:opacity var(--transition);animation:rotate var(--spark) linear infinite both}
        .spark:after{content:"";position:absolute;inset:var(--cut);border-radius:inherit}
        .backdrop{position:absolute;inset:var(--cut);background:var(--bg);border-radius:inherit;transition:background var(--transition);pointer-events:none}
        .sparkle-label{position:relative;z-index:1;display:flex;align-items:center;gap:10px;width:100%}
        .sparkle-icon{width:28px;height:28px;border-radius:7px;display:flex;align-items:center;justify-content:center;background:rgba(180,240,39,.12);color:currentColor;flex-shrink:0;transition:background var(--transition),color var(--transition)}
        .sparkle-button:is(:hover,:focus-visible) .sparkle-icon{background:hsl(var(--accent-h) var(--accent-s) var(--accent-l) / .22);color:#2f5a0d}
        .sparkle-title{font-size:12px;font-weight:700;color:currentColor;transition:color var(--transition)}
        .sparkle-subtitle{font-size:9px;color:var(--text2);margin-top:1px;transition:color var(--transition)}
        .sparkle-button:is(:hover,:focus-visible) .sparkle-subtitle{color:rgba(47,90,13,.72)}
        .sparkle-button:disabled .sparkle-subtitle,.sparkle-button:disabled:is(:hover,:focus-visible) .sparkle-subtitle{color:var(--amber)}
        .receipt-sparkle{inline-size:1.38em;translate:-8% -3%;flex-shrink:0;position:relative;z-index:1;color:currentColor;overflow:visible}
        .receipt-sparkle .receipt-paper{fill:none;stroke:currentColor;stroke-width:1.8;stroke-linejoin:round;filter:drop-shadow(0 0 calc(var(--active) * 8px) hsl(var(--accent-h) var(--accent-s) var(--accent-l) / .7));transform-box:fill-box;transform-origin:center;transition:stroke var(--transition),filter var(--transition)}
        .receipt-sparkle .receipt-line{stroke:currentColor;stroke-width:1.6;stroke-linecap:round;opacity:.7;transform-origin:left;transition:opacity var(--transition)}
        .receipt-sparkle .receipt-dot{fill:currentColor;opacity:.65;transition:opacity var(--transition)}
        .sparkle-button:is(:hover,:focus-visible) .receipt-paper{animation:receipt-float .9s ease both}
        .sparkle-button:is(:hover,:focus-visible) .receipt-line{animation:receipt-scan .75s ease both;opacity:.95}
        .sparkle-button:is(:hover,:focus-visible) .receipt-line:nth-of-type(3){animation-delay:.08s}
        .sparkle-button:is(:hover,:focus-visible) .receipt-line:nth-of-type(4){animation-delay:.16s}
        .sparkle-button:is(:hover,:focus-visible) .receipt-dot{animation:receipt-pop .55s ease both;opacity:1}
        .particle-pen{position:absolute;width:200%;aspect-ratio:1;top:50%;left:50%;translate:-50% -50%;-webkit-mask:radial-gradient(white,transparent 65%);z-index:-1;opacity:var(--active,0);transition:opacity var(--transition);pointer-events:none}
        .particle{fill:white;width:calc(var(--size,.25) * 1rem);aspect-ratio:1;position:absolute;top:calc(var(--y) * 1%);left:calc(var(--x) * 1%);opacity:var(--alpha,1);animation:float-out calc(var(--duration,1) * 1s) calc(var(--delay) * -1s) infinite linear;transform-origin:var(--origin-x,1000%) var(--origin-y,1000%);z-index:-1;animation-play-state:var(--play-state,paused)}
        .particle path{fill:hsl(0 0% 90%);stroke:none}
        .particle:nth-of-type(even){animation-direction:reverse}
        .sparkle-button:is(:hover,:focus-visible)~.particle-pen{--active:1;--play-state:running}
        @keyframes bounce{35%,65%{scale:var(--scale)}}
        @keyframes receipt-float{0%,100%{translate:0 0;rotate:0deg}45%{translate:0 -2px;rotate:-4deg}72%{translate:0 1px;rotate:2deg}}
        @keyframes receipt-scan{0%{scale:0 1;opacity:.2}70%,100%{scale:1 1;opacity:.95}}
        @keyframes receipt-pop{0%{scale:.4;opacity:.2}60%{scale:1.35;opacity:1}100%{scale:1;opacity:1}}
        @keyframes flip{to{rotate:360deg}}
        @keyframes rotate{to{transform:rotate(90deg)}}
        @keyframes float-out{to{rotate:360deg}}
      `}</style>

      <div className="sp">
        <button className="sparkle-button" onClick={openIfAvailable} disabled={lockedByOtherUser || Boolean(readOnlyReason)}>
          <span className="spark" />
          <span className="backdrop" />
          <span className="sparkle-label">
            <span className="sparkle-icon">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg>
            </span>
            <span style={{ flex: 1, minWidth: 0 }}>
              <span className="sparkle-title">EMITIR BOLETA ÚNICA</span>
              <span className="sparkle-subtitle" style={{ display: "block" }}>{readOnlyReason ?? (lockedByOtherUser ? "Emisión bloqueada" : "Boleta manual, una a la vez")}</span>
            </span>
            <svg className="receipt-sparkle" viewBox="0 0 24 24" aria-hidden="true">
              <path className="receipt-paper" d="M7 3.5h10a1.5 1.5 0 0 1 1.5 1.5v15.2l-2-1.1-2 1.1-2-1.1-2 1.1-2-1.1-2 1.1V5A1.5 1.5 0 0 1 7 3.5Z" />
              <path className="receipt-line" d="M9 8h6" />
              <path className="receipt-line" d="M9 11.5h5" />
              <path className="receipt-line" d="M9 15h3.5" />
              <circle className="receipt-dot" cx="15.7" cy="15" r="1" />
            </svg>
          </span>
        </button>
        <span className="particle-pen" aria-hidden="true">
          {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
            <svg
              key={i}
              className="particle"
              viewBox="0 0 15 15"
              style={{
                ["--x" as string]: [18, 34, 52, 70, 82, 24, 62, 42][i],
                ["--y" as string]: [28, 70, 18, 64, 36, 48, 82, 10][i],
                ["--size" as string]: [0.28, 0.18, 0.32, 0.2, 0.24, 0.16, 0.26, 0.22][i],
                ["--duration" as string]: [1.7, 2.3, 1.9, 2.6, 2.1, 1.6, 2.4, 1.8][i],
                ["--delay" as string]: [0.1, 0.35, 0.2, 0.55, 0.75, 0.42, 0.62, 0.28][i],
                ["--origin-x" as string]: `${[900, 700, 1200, 800, 1000, 600, 1100, 750][i]}%`,
                ["--origin-y" as string]: `${[800, 1100, 700, 900, 650, 1000, 850, 1200][i]}%`,
              } as React.CSSProperties}
            >
              <path d="M7.5 0l2 5.5L15 7.5l-5.5 2L7.5 15l-2-5.5L0 7.5l5.5-2L7.5 0z" />
            </svg>
          ))}
        </span>
      </div>

      {(lockedByOtherUser || readOnlyReason) && (
        <div style={{ marginTop: 8, padding: "8px 10px", borderRadius: 10, border: "1px solid rgba(245,158,11,.18)", background: "rgba(245,158,11,.08)", color: "var(--amber)", fontSize: 9, lineHeight: 1.35 }}>
          <strong style={{ display: "block", marginBottom: 2, fontSize: 9, textTransform: "uppercase", letterSpacing: ".05em" }}>{readOnlyReason ? "Solo lectura" : businessMode ? "Equipo" : "Emisión en curso"}</strong>
          {readOnlyReason ?? lockMessage}
        </div>
      )}

      {open && (
        <div className="ed-overlay">
          <div className="ed-panel">
            <EmitirDirectaView empresaTipo={empresaTipo ?? undefined} empresaId={empresaId} emisionProveedor={emisionProveedor} facturasProveedor={facturasProveedor} devMode={devMode} empresaRut={empresaRut} empresaRazonSocial={empresaRazonSocial} empresaGiro={empresaGiro} empresaDireccion={empresaDireccion} empresaComuna={empresaComuna} onClose={closeWithSavedPulse} />
          </div>
        </div>
      )}
    </>
  );
}

export function MassDTEAction({ readOnlyReason, mesa = "boleta" }: { empresaId: string; readOnlyReason?: string; mesa?: "boleta" | "factura" }) {
  const esFacturas = mesa === "factura";
  const router = useRouter();
  const [open, setOpen] = useState(false);

  function closeWithSavedPulse(label = "Archivo subido a Agregados") {
    setOpen(false);
    window.dispatchEvent(new CustomEvent("v5-popup-saved", { detail: { label } }));
  }

  function handleUploaded() {
    closeWithSavedPulse("Archivo subido a Agregados");
    // Asegura estar en massdte (por si se subió desde otra vista). El refresco REAL de
    // la mesa lo hace MesaController al recibir "massdte:uploaded": router.refresh() no
    // re-sembraba el estado de la mesa, así que el doc no aparecía hasta un F5.
    router.push(`/massdte?date=${todayStr()}&view=day`);
    window.setTimeout(() => {
      window.dispatchEvent(new CustomEvent("massdte:uploaded", { detail: { date: todayStr() } }));
      window.dispatchEvent(new CustomEvent("switch-tab", { detail: "subidos" }));
    }, 80);
  }

  return (
    <>
      <style>{`
        .md-overlay{position:fixed;inset:0;z-index:80;display:flex;align-items:center;justify-content:center;padding:24px;background:rgba(0,0,0,.58);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);animation:edFadeIn .2s ease both}
        .md-panel{width:min(720px,94vw);border-radius:20px;overflow:hidden;background:var(--surface);border:1px solid var(--border);box-shadow:0 30px 90px rgba(0,0,0,.45),inset 0 1px 0 var(--border);display:flex;flex-direction:column}
        .mass-sp{position:relative;z-index:0;width:100%;overflow:hidden}
        .mass-sparkle-button{--active:0;--transition:.3s;--spark:1.8s;--cut:0px;--accent-h:9;--accent-s:79%;--accent-l:58%;--bg:radial-gradient(40% 50% at center 100%,hsl(var(--accent-h) calc(var(--active) * 79%) 68% / var(--active)),transparent),radial-gradient(80% 100% at center 120%,hsl(var(--accent-h) calc(var(--active) * 79%) 58% / var(--active)),transparent),hsl(var(--accent-h) calc(var(--active) * 79%) calc((var(--active) * 34%) + 18%));position:relative;display:flex;align-items:center;gap:10px;width:100%;padding:10px 14px;border:0;border-bottom:1px solid rgba(232,85,62,.10);border-radius:0;background:rgba(232,85,62,.06);color:var(--accent);cursor:pointer;text-align:left;white-space:normal;box-shadow:0 0 calc(var(--active) * 2em) calc(var(--active) * .35em) hsl(var(--accent-h) var(--accent-s) var(--accent-l) / .24),inset 0 0 0 1px rgba(232,85,62,.04),0 -.05em 0 0 hsl(var(--accent-h) calc(var(--active) * 79%) calc(var(--active) * 58%));transition:box-shadow var(--transition),background var(--transition),color var(--transition);overflow:hidden}
        .mass-sparkle-button:is(:hover,:focus-visible){--active:1;background:var(--bg);color:white;outline:none}
        .mass-sparkle-button:active{filter:brightness(.96);transition:.3s}
        .mass-sparkle-button:before{content:"";position:absolute;inset:0;z-index:0;border:1px solid hsl(var(--accent-h) var(--accent-s) 50% / .2);opacity:var(--active,0);transition:opacity var(--transition);pointer-events:none}
        .mass-spark{position:absolute;inset:0;border-radius:inherit;rotate:0deg;overflow:hidden;mask:linear-gradient(white,transparent 50%);animation:massFlip calc(var(--spark) * 2) infinite steps(2,end);pointer-events:none}
        .mass-spark:before{content:"";position:absolute;width:200%;aspect-ratio:1;top:0;left:50%;z-index:-1;translate:-50% -15%;transform:rotate(-90deg);opacity:calc(var(--active) + .35);background:conic-gradient(from 0deg,transparent 0 340deg,white 360deg);transition:opacity var(--transition);animation:massRotate var(--spark) linear infinite both}
        .mass-spark:after{content:"";position:absolute;inset:var(--cut);border-radius:inherit}
        .mass-backdrop{position:absolute;inset:var(--cut);background:var(--bg);border-radius:inherit;transition:background var(--transition);pointer-events:none}
        .mass-label{position:relative;z-index:1;display:flex;align-items:center;gap:10px;width:100%}
        .mass-icon{width:28px;height:28px;border-radius:7px;border:1px solid rgba(232,85,62,.14);display:flex;align-items:center;justify-content:center;background:rgba(232,85,62,.08);color:currentColor;flex-shrink:0;box-shadow:0 0 18px rgba(232,85,62,.06);transition:background var(--transition),color var(--transition),border-color var(--transition)}
        .mass-sparkle-button:is(:hover,:focus-visible) .mass-icon{background:hsl(var(--accent-h) var(--accent-s) var(--accent-l) / .34);border-color:hsl(var(--accent-h) var(--accent-s) var(--accent-l) / .5);color:white}
        .mass-title{font-size:12px;font-weight:800;color:currentColor;letter-spacing:-.02em;transition:color var(--transition)}
        .mass-subtitle{font-size:9px;color:var(--text2);margin-top:1px;transition:color var(--transition)}
        .mass-sparkle-button:is(:hover,:focus-visible) .mass-subtitle{color:hsl(0 0% 86%)}
        .mass-receipts{inline-size:3.25em;translate:-1% -3%;flex-shrink:0;position:relative;z-index:1;color:currentColor;overflow:visible}
        .mass-receipts .mass-doc{transform-box:fill-box;transform-origin:center;transition:opacity var(--transition),transform var(--transition)}
        .mass-receipts .mass-paper{fill:rgb(232 85 62 / .03);stroke:currentColor;stroke-width:1.45;stroke-linejoin:round;filter:drop-shadow(0 0 calc(var(--active) * 8px) hsl(var(--accent-h) var(--accent-s) var(--accent-l) / .58));transition:stroke var(--transition),filter var(--transition),fill var(--transition)}
        .mass-receipts .mass-line{stroke:currentColor;stroke-width:1.25;stroke-linecap:round;opacity:.75;transition:opacity var(--transition)}
        .mass-doc-left{opacity:.62;transform:translate(1px,0) scale(.78)}
        .mass-doc-center{opacity:.82;transform:translate(16px,0) scale(.88)}
        .mass-doc-active{opacity:1;transform:translate(32px,0) scale(.98)}
        .mass-doc-new{opacity:0;transform:translate(-14px,0) scale(.7)}
        .mass-sparkle-button:is(:hover,:focus-visible) .mass-doc-active{animation:mass-print-and-exit 1.8s cubic-bezier(.22,1,.36,1) infinite both}
        .mass-sparkle-button:is(:hover,:focus-visible) .mass-doc-center{animation:mass-move-to-active 1.8s cubic-bezier(.22,1,.36,1) infinite both}
        .mass-sparkle-button:is(:hover,:focus-visible) .mass-doc-left{animation:mass-move-to-center 1.8s cubic-bezier(.22,1,.36,1) infinite both}
        .mass-sparkle-button:is(:hover,:focus-visible) .mass-doc-new{animation:mass-enter-from-left 1.8s cubic-bezier(.22,1,.36,1) infinite both}
        .mass-sparkle-button:is(:hover,:focus-visible) .mass-line{opacity:.95}
        .mass-particle-pen{position:absolute;width:200%;aspect-ratio:1;top:50%;left:50%;translate:-50% -50%;-webkit-mask:radial-gradient(white,transparent 65%);z-index:-1;opacity:var(--active,0);transition:opacity var(--transition);pointer-events:none}
        .mass-particle{fill:white;width:calc(var(--size,.25) * 1rem);aspect-ratio:1;position:absolute;top:calc(var(--y) * 1%);left:calc(var(--x) * 1%);opacity:var(--alpha,1);animation:massFloatOut calc(var(--duration,1) * 1s) calc(var(--delay) * -1s) infinite linear;transform-origin:var(--origin-x,1000%) var(--origin-y,1000%);z-index:-1;animation-play-state:var(--play-state,paused)}
        .mass-particle path{fill:hsl(0 0% 92%);stroke:none}
        .mass-particle:nth-of-type(even){animation-direction:reverse}
        .mass-sparkle-button:is(:hover,:focus-visible)~.mass-particle-pen{--active:1;--play-state:running}
        @keyframes massFlip{to{rotate:360deg}}
        @keyframes massRotate{to{transform:rotate(90deg)}}
        @keyframes massFloatOut{to{rotate:360deg}}
        @keyframes mass-print-and-exit{0%,27%{opacity:1;transform:translate(32px,0) scale(.98)}38%,44%{opacity:1;transform:translate(38px,-3px) scale(1.12)}54%{opacity:1;transform:translate(32px,0) scale(.98)}70%{opacity:.72;transform:translate(48px,0) scale(.98)}82%,100%{opacity:0;transform:translate(60px,0) scale(.94)}}
        @keyframes mass-move-to-active{0%,54%{opacity:.82;transform:translate(16px,0) scale(.88)}70%,100%{opacity:1;transform:translate(32px,0) scale(.98)}}
        @keyframes mass-move-to-center{0%,54%{opacity:.62;transform:translate(1px,0) scale(.78)}70%,100%{opacity:.82;transform:translate(16px,0) scale(.88)}}
        @keyframes mass-enter-from-left{0%,54%{opacity:0;transform:translate(-14px,0) scale(.7)}70%,100%{opacity:.62;transform:translate(1px,0) scale(.78)}}
      `}</style>

      <div className="mass-sp">
        <button className="mass-sparkle-button" onClick={() => { if (!readOnlyReason) setOpen(true); }} disabled={Boolean(readOnlyReason)}>
          <span className="mass-spark" />
          <span className="mass-backdrop" />
          <span className="mass-label">
            <span className="mass-icon">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3"/></svg>
            </span>
            <span style={{ flex: 1, minWidth: 0 }}>
              <span className="mass-title">{esFacturas ? "SUBIR PLANTILLAS" : "SUBIR CARTOLAS"}</span>
              <span className="mass-subtitle" style={{ display: "block" }}>{readOnlyReason ?? (esFacturas ? "Excel estructurado → facturas 33/34" : "Subida masiva de cartolas")}</span>
            </span>
            <svg className="mass-receipts" viewBox="0 0 52 28" aria-hidden="true">
              <g className="mass-doc mass-doc-new">
                <path className="mass-paper" d="M6 2.5h10a1.25 1.25 0 0 1 1.25 1.25v20.6l-1.9-1.05-1.9 1.05-1.9-1.05-1.9 1.05-1.9-1.05-1.9 1.05V3.75A1.25 1.25 0 0 1 6 2.5Z" />
                <path className="mass-line" d="M8.5 7h6" />
                <path className="mass-line" d="M8.5 10.5h5.2" />
                <path className="mass-line" d="M8.5 14h6" />
                <path className="mass-line" d="M8.5 17.5h4.4" />
              </g>
              <g className="mass-doc mass-doc-left">
                <path className="mass-paper" d="M6 2.5h10a1.25 1.25 0 0 1 1.25 1.25v20.6l-1.9-1.05-1.9 1.05-1.9-1.05-1.9 1.05-1.9-1.05-1.9 1.05V3.75A1.25 1.25 0 0 1 6 2.5Z" />
                <path className="mass-line" d="M8.5 7h6" />
                <path className="mass-line" d="M8.5 10.5h5.2" />
                <path className="mass-line" d="M8.5 14h6" />
                <path className="mass-line" d="M8.5 17.5h4.4" />
              </g>
              <g className="mass-doc mass-doc-center">
                <path className="mass-paper" d="M6 2.5h10a1.25 1.25 0 0 1 1.25 1.25v20.6l-1.9-1.05-1.9 1.05-1.9-1.05-1.9 1.05-1.9-1.05-1.9 1.05V3.75A1.25 1.25 0 0 1 6 2.5Z" />
                <path className="mass-line" d="M8.5 7h6" />
                <path className="mass-line" d="M8.5 10.5h5.2" />
                <path className="mass-line" d="M8.5 14h6" />
                <path className="mass-line" d="M8.5 17.5h4.4" />
              </g>
              <g className="mass-doc mass-doc-active">
                <path className="mass-paper" d="M6 2.5h10a1.25 1.25 0 0 1 1.25 1.25v20.6l-1.9-1.05-1.9 1.05-1.9-1.05-1.9 1.05-1.9-1.05-1.9 1.05V3.75A1.25 1.25 0 0 1 6 2.5Z" />
                <path className="mass-line" d="M8.5 7h6" />
                <path className="mass-line" d="M8.5 10.5h5.2" />
                <path className="mass-line" d="M8.5 14h6" />
                <path className="mass-line" d="M8.5 17.5h4.4" />
              </g>
            </svg>
          </span>
        </button>
        <span className="mass-particle-pen" aria-hidden="true">
          {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
            <svg
              key={i}
              className="mass-particle"
              viewBox="0 0 15 15"
              style={{
                ["--x" as string]: [16, 32, 50, 68, 84, 22, 60, 44][i],
                ["--y" as string]: [30, 72, 16, 66, 38, 50, 84, 12][i],
                ["--size" as string]: [0.24, 0.18, 0.3, 0.2, 0.22, 0.16, 0.26, 0.2][i],
                ["--duration" as string]: [1.8, 2.4, 2, 2.7, 2.2, 1.7, 2.5, 1.9][i],
                ["--delay" as string]: [0.12, 0.32, 0.22, 0.58, 0.72, 0.46, 0.64, 0.3][i],
                ["--origin-x" as string]: `${[900, 700, 1200, 800, 1000, 600, 1100, 750][i]}%`,
                ["--origin-y" as string]: `${[800, 1100, 700, 900, 650, 1000, 850, 1200][i]}%`,
              } as React.CSSProperties}
            >
              <path d="M7.5 0l2 5.5L15 7.5l-5.5 2L7.5 15l-2-5.5L0 7.5l5.5-2L7.5 0z" />
            </svg>
          ))}
        </span>
      </div>
      {readOnlyReason && (
        <div style={{ marginTop: 8, padding: "8px 10px", borderRadius: 10, border: "1px solid rgba(245,158,11,.18)", background: "rgba(245,158,11,.08)", color: "var(--amber)", fontSize: 9, lineHeight: 1.35 }}>
          <strong style={{ display: "block", marginBottom: 2, fontSize: 9, textTransform: "uppercase", letterSpacing: ".05em" }}>Solo lectura</strong>
          {readOnlyReason}
        </div>
      )}

      {open && (
        <div className="md-overlay">
          <div className="md-panel" style={{ maxHeight: "90vh" }}>
            <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", gap: 12, flexShrink: 0 }}>
              <button aria-label="Cerrar" onClick={() => setOpen(false)} style={{ width: 32, height: 32, borderRadius: 8, border: "1px solid var(--border)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", background: "var(--bg-muted)", color: "var(--text2)", fontSize: 16 }}>×</button>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 3 }}>
                  <span style={{ fontSize: 9, color: "var(--text3)", fontWeight: 700, textTransform: "uppercase", letterSpacing: ".06em" }}>Carga masiva</span>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 5, borderRadius: 999, border: "1px solid var(--border)", padding: "5px 8px", fontSize: 9, fontWeight: 700, color: "var(--text2)", background: "var(--bg-muted)" }}>{esFacturas ? "Solo Excel (plantilla)" : "Excel · PDF · CSV · Fotos"}</span>
                </div>
                <h2 style={{ fontSize: 16, fontWeight: 800, color: "var(--text)", letterSpacing: "-0.02em" }}>MassDTE</h2>
                <p style={{ fontSize: 11, color: "var(--text2)", marginTop: 2 }}>{esFacturas ? "Sube tu plantilla de facturas — cada fila es una factura lista para revisar." : "Sube cartolas bancarias y documentos para procesamiento masivo."}</p>
              </div>
            </div>
            <div style={{ flex: 1, padding: "16px 20px", overflowY: "auto" }}>
              <div className="sec" style={{ padding: 0 }}>
                <DropzoneUpload onUploaded={handleUploaded} mesa={mesa} />
              </div>
            </div>
            <div style={{ padding: "12px 20px", borderTop: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0, background: "var(--surface)" }}>
              <div style={{ fontSize: 10, color: "var(--text2)" }}>
                Descarga la plantilla para preparar tus datos.
              </div>
              <a href={esFacturas ? "/api/generar-template?mesa=factura" : "/api/generar-template"} style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "8px 14px", borderRadius: 10, border: "1px solid rgba(232,85,62,.18)", background: "rgba(232,85,62,.06)", color: "var(--accent)", fontSize: 10, fontWeight: 700, textDecoration: "none", cursor: "pointer" }}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 5v14m-7-7l7-7 7 7"/></svg>
                Plantilla Excel
              </a>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export function RCVContentWrapper({ children, headerRight }: { children: React.ReactNode; headerRight?: React.ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", gap: 12, flexShrink: 0 }}>
        <button onClick={() => window.dispatchEvent(new CustomEvent("switch-view", { detail: "dashboard" }))}
          style={{ width: 28, height: 28, borderRadius: 6, border: "none", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", background: "var(--bg-muted)", color: "var(--text2)", fontSize: 14 }}>
          ←
        </button>
        <h2 style={{ fontSize: 14, fontWeight: 700, color: "var(--text)" }}>Registro de Ventas</h2>
        {headerRight && <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 }}>{headerRight}</div>}
      </div>
      <div className="r-scroll" style={{ flex: 1 }}>
        {children}
      </div>
    </div>
  );
}

export function RCVButton() {
  return (
    <button onClick={() => window.dispatchEvent(new CustomEvent("switch-view", { detail: "rcv" }))}
      style={{width:"100%",border:"none",background:"none",cursor:"pointer",padding:0,textAlign:"left"}}>
      <GlowWrap glow style={{borderRadius:16,overflow:"visible"}}><div style={{background:"var(--surface)",borderRadius:16,padding:"9px 14px",border:"1px solid var(--border)",boxShadow:"inset 0 1px 0 var(--border),0 8px 32px var(--shadow)",display:"flex",alignItems:"center",gap:10,overflow:"hidden"}}>
        <div style={{width:28,height:28,borderRadius:7,display:"flex",alignItems:"center",justifyContent:"center",background:"rgba(232,85,62,.1)",color:"var(--accent)",flexShrink:0}}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg>
        </div>
        <div style={{flex:1,minWidth:0}}>
          <div style={{fontSize:12,fontWeight:700,color:"var(--text)"}}>REGISTRO DE VENTAS</div>
          <div style={{fontSize:9,color:"var(--text2)",marginTop:1}}>Resumen de ventas del período</div>
        </div>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{flexShrink:0,color:"var(--text2)"}}><path d="M9 18l6-6-6-6"/></svg>
      </div></GlowWrap>
    </button>
  );
}

export function ActivityButton() {
  return (
    <button onClick={() => window.dispatchEvent(new CustomEvent("switch-view", { detail: "actividad" }))}
      style={{width:"100%",border:"none",background:"none",cursor:"pointer",padding:0,textAlign:"left"}}>
      <GlowWrap glow style={{borderRadius:16,overflow:"visible"}}><div style={{background:"var(--surface)",borderRadius:16,padding:"9px 14px",border:"1px solid var(--border)",boxShadow:"inset 0 1px 0 var(--border),0 8px 32px var(--shadow)",display:"flex",alignItems:"center",gap:10,overflow:"hidden"}}>
        <div style={{width:28,height:28,borderRadius:7,display:"flex",alignItems:"center",justifyContent:"center",background:"var(--bg-muted)",color:"var(--text2)",flexShrink:0}}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
        </div>
        <div style={{flex:1,minWidth:0}}>
          <div style={{fontSize:12,fontWeight:700,color:"var(--text)"}}>REGISTRO DE ACTIVIDAD</div>
          <div style={{fontSize:9,color:"var(--text2)",marginTop:1}}>Últimos movimientos del período</div>
        </div>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{flexShrink:0,color:"var(--text2)"}}><path d="M9 18l6-6-6-6"/></svg>
      </div></GlowWrap>
    </button>
  );
}

export function HeaderActionsRow() {
  const [dashboardOpen, setDashboardOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [isDark, setIsDark] = useState(true); // default de marca: oscuro
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // Sincroniza el ícono con la clase .dark real de <html> (la pone el script
    // inline de ThemeInitializer antes del paint). rAF para no hacer setState
    // síncrono dentro del effect (regla react-hooks/set-state-in-effect).
    window.requestAnimationFrame(() => setIsDark(document.documentElement.classList.contains("dark")));
  }, []);

  function toggleTheme() {
    const next = !document.documentElement.classList.contains("dark");
    document.documentElement.classList.toggle("dark", next);
    try {
      window.localStorage.setItem("theme", next ? "dark" : "light");
    } catch {
      // Sin localStorage (modo privado) el tema igual cambia, solo no persiste.
    }
    setIsDark(next);
  }

  useEffect(() => {
    return () => document.documentElement.classList.remove("v5-dashboard-fullscreen");
  }, []);

  useEffect(() => {
    function handleFullscreen(e: CustomEvent<{ open?: boolean }>) {
      const open = Boolean(e.detail?.open);
      setDashboardOpen(open);
      if (!open) setSearchQuery("");
    }

    function handleFocusSearch() {
      searchRef.current?.focus();
    }

    function handleSync(e: CustomEvent<{ query?: string }>) {
      setSearchQuery(e.detail?.query ?? "");
    }

    window.addEventListener("toggle-dashboard-fullscreen", handleFullscreen as EventListener);
    window.addEventListener("focus-search-history", handleFocusSearch);
    window.addEventListener("search-history-query-sync", handleSync as EventListener);
    return () => {
      window.removeEventListener("toggle-dashboard-fullscreen", handleFullscreen as EventListener);
      window.removeEventListener("focus-search-history", handleFocusSearch);
      window.removeEventListener("search-history-query-sync", handleSync as EventListener);
    };
  }, []);

  useEffect(() => {
    // ⌘K / Ctrl+K abre el buscador fullscreen del historial
    function handleShortcut(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        document.documentElement.classList.add("v5-dashboard-fullscreen");
        // Mismo evento/forma que toggleDashboardFullscreen: lo escuchan
        // RightColumnView y el handleFullscreen de este componente
        window.dispatchEvent(new CustomEvent("toggle-dashboard-fullscreen", { detail: { open: true } }));
        window.setTimeout(() => searchRef.current?.focus(), 80);
      }
    }
    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, []);

  function updateSearchQuery(value: string) {
    setSearchQuery(value);
    window.dispatchEvent(new CustomEvent("search-history-query-change", { detail: { query: value } }));
  }

  function toggleDashboardFullscreen() {
    const next = !dashboardOpen;
    setDashboardOpen(next);
    document.documentElement.classList.toggle("v5-dashboard-fullscreen", next);
    window.dispatchEvent(new CustomEvent("toggle-dashboard-fullscreen", { detail: { open: next } }));
    if (!next) updateSearchQuery("");
  }

  return (
    <>
    <style>{`
      .ha-btn{position:relative;width:38px;height:38px;border-radius:12px;border:1px solid var(--border);cursor:pointer;background:var(--surface);color:var(--text2);display:flex;align-items:center;justify-content:center;box-shadow:inset 0 1px 0 var(--border),0 8px 32px var(--shadow);transition:all .2s;font-size:16px}
      .ha-btn:hover{border-color:rgba(232,85,62,.35);background:rgba(232,85,62,.08);box-shadow:0 0 22px rgba(232,85,62,.18),inset 0 1px 0 var(--border),0 8px 32px var(--shadow)}
      .ha-btn:hover svg{filter:drop-shadow(0 0 8px rgba(232,85,62,.5));color:var(--accent);transition:filter .25s,color .25s}
    `}</style>
    <div style={{display:"flex",flexDirection:"row",gap:8,alignItems:"center"}}>
      {dashboardOpen && (
        <div style={{position:"fixed",left:"50%",top:20,transform:"translateX(-50%)",zIndex:65,width:560,maxWidth:"48vw",minWidth:420,height:38}}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" style={{position:"absolute",left:13,top:"50%",transform:"translateY(-50%)",color:"var(--text3)",pointerEvents:"none"}}><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>
          <input ref={searchRef} value={searchQuery} onChange={(e) => updateSearchQuery(e.target.value)} placeholder="Buscar historial..." style={{width:"100%",height:38,padding:"0 58px 0 36px",borderRadius:12,border:"1px solid rgba(232,85,62,.22)",background:"var(--surface)",color:"var(--text)",boxShadow:"inset 0 1px 0 var(--border),0 8px 32px var(--shadow)",outline:"none",fontSize:12,fontWeight:650}} />
          <span style={{position:"absolute",right: searchQuery ? 36 : 12,top:"50%",transform:"translateY(-50%)",fontSize:9,fontWeight:850,color:"var(--text3)"}}>⌘K</span>
          {searchQuery && <button onClick={() => updateSearchQuery("")} aria-label="Limpiar búsqueda" style={{position:"absolute",right:8,top:"50%",transform:"translateY(-50%)",width:23,height:23,borderRadius:8,border:"1px solid var(--border)",background:"var(--bg-muted)",color:"var(--text2)",display:"grid",placeItems:"center",cursor:"pointer",padding:0}}>×</button>}
        </div>
      )}
      <button onClick={toggleDashboardFullscreen} aria-pressed={dashboardOpen} aria-label={dashboardOpen ? "Volver al dashboard" : "Buscar en historial (⌘K)"} title={dashboardOpen ? undefined : "Buscar en historial (⌘K)"}
        className={dashboardOpen ? "" : "ha-btn"}
        style={dashboardOpen ? {width:176,height:38,borderRadius:12,border:"1px solid rgba(232,85,62,.28)",cursor:"pointer",background:"rgba(232,85,62,.12)",color:"var(--accent)",display:"flex",alignItems:"center",justifyContent:"center",gap:8,padding:"0 14px",boxShadow:"0 0 22px rgba(232,85,62,.18),inset 0 1px 0 var(--border)",transition:"width .28s cubic-bezier(.22,1,.36,1),background .2s,border-color .2s,color .2s,box-shadow .2s",fontSize:16,overflow:"hidden",whiteSpace:"nowrap"} : undefined}>
        {dashboardOpen ? (
          <>
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" style={{flexShrink:0}}><path d="M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z"/></svg>
            <span style={{fontSize:12,fontWeight:700,letterSpacing:"-0.01em",lineHeight:1}}>Volver a dashboard</span>
          </>
        ) : (
          <span style={{display:"flex",alignItems:"center",justifyContent:"center",gap:2}}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
          </span>
        )}
      </button>
      <button onClick={() => window.dispatchEvent(new CustomEvent("toggle-empresa"))} className="ha-btn">
        
        <svg width="18" height="18" viewBox="0 0 256 256" fill="currentColor"><path d="M240,204H228V96a20,20,0,0,0-20-20H172V32a20,20,0,0,0-28.45-18.12l-104,48.54A20.06,20.06,0,0,0,28,80.55V204H16a12,12,0,0,0,0,24H240a12,12,0,0,0,0-24ZM204,100V204H172V100ZM52,83.09,148,38.3V204H52ZM132,112v12a12,12,0,0,1-24,0V112a12,12,0,0,1,24,0Zm-40,0v12a12,12,0,0,1-24,0V112a12,12,0,0,1,24,0Zm0,52v12a12,12,0,0,1-24,0V164a12,12,0,0,1,24,0Zm40,0v12a12,12,0,0,1-24,0V164a12,12,0,0,1,24,0Z"/></svg>
      </button>
      <button onClick={toggleTheme} className="ha-btn" aria-label={isDark ? "Cambiar a tema claro" : "Cambiar a tema oscuro"}>
        {isDark ? (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/></svg>
        ) : (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>
        )}
      </button>
      <button onClick={() => { void signOut(); }} className="ha-btn" aria-label="Cerrar sesión" title="Cerrar sesión">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"/><path d="M16 17l5-5-5-5"/><path d="M21 12H9"/></svg>
      </button>
    </div>
    </>
  );
}

/**
 * FACTURA ÚNICA (criterio 5 de Matías): el hermano de la boleta única para la
 * mesa Facturas. El usuario tipea el receptor COMPLETO (decisión del fundador:
 * la factura individualiza a su receptor — solo el email es opcional), el
 * detalle y el VALOR TOTAL; el sistema deriva neto/IVA según el emisor.
 *
 * Dos pasos contra el server, cero lógica duplicada: /factura-unica crea la
 * cadena documento→movimiento→propuesta (nace aprobada: tipearla ES el gesto)
 * y /emitir-lote la emite con la forma de pago elegida — mismos gates de
 * cuota, locks y validaciones del carril masivo.
 */
export function FacturaUnicaAction({ readOnlyReason }: { readOnlyReason?: string }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [f, setF] = useState({ rut: "", razon: "", giro: "", direccion: "", comuna: "", email: "", detalle: "", total: "" });
  // Criterio 7: forma de pago obligatoria y SIN default, también en la única.
  const [formaPago, setFormaPago] = useState<"contado" | "credito" | null>(null);
  const [folioListo, setFolioListo] = useState<number | null>(null);

  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF((v) => ({ ...v, [k]: e.target.value }));
  const totalNum = Math.round(Number(f.total.replace(/[$.\s]/g, "")) || 0);
  const completo = f.rut.trim() && f.razon.trim() && f.giro.trim() && f.direccion.trim() && f.comuna.trim() && f.detalle.trim() && totalNum > 0 && formaPago;

  async function emitir() {
    if (!completo || enviando) return;
    setEnviando(true);
    try {
      const crear = await fetch("/api/intermediaria/factura-unica", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          receptor_rut: f.rut, razon_social: f.razon, giro: f.giro, direccion: f.direccion,
          comuna: f.comuna, email: f.email || undefined, detalle: f.detalle, total: totalNum,
        }),
      });
      const creada = await crear.json().catch(() => null);
      if (!creada?.ok) {
        toast(creada?.detalle ?? "No se pudo preparar la factura", "error");
        setEnviando(false);
        return;
      }
      const emitirRes = await fetch("/api/intermediaria/emitir-lote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ propuesta_ids: [creada.propuesta_id], forma_pago_lote: formaPago }),
      });
      const r = await emitirRes.json().catch(() => null);
      const item = r?.resultados?.[0];
      if (r?.ok && item?.ok) {
        setFolioListo(item.folio ?? null);
      } else {
        toast(item?.error_message ?? r?.detalle ?? "No se pudo emitir la factura", "error");
      }
    } catch {
      toast("No se pudo emitir — revisa tu conexión", "error");
    }
    setEnviando(false);
  }

  const inputSt: React.CSSProperties = { width: "100%", boxSizing: "border-box", background: "var(--bg-muted)", border: "1px solid var(--border)", borderRadius: 9, padding: "9px 10px", color: "var(--text)", fontSize: 12, fontFamily: "inherit" };
  const labelSt: React.CSSProperties = { display: "block", fontSize: 9, fontWeight: 800, textTransform: "uppercase", letterSpacing: ".06em", color: "var(--text3)", margin: "10px 0 4px" };

  return (
    <>
      <button type="button" onClick={() => { if (!readOnlyReason) { setOpen(true); setFolioListo(null); } }} disabled={Boolean(readOnlyReason)}
        style={{ display: "flex", alignItems: "center", gap: 12, width: "100%", padding: "14px 16px", border: 0, background: "transparent", color: "var(--text)", cursor: readOnlyReason ? "default" : "pointer", textAlign: "left", font: "inherit" }}>
        <span style={{ width: 34, height: 34, borderRadius: 10, display: "grid", placeItems: "center", background: "rgba(201,242,75,.1)", color: "var(--lime)", flexShrink: 0 }}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
        </span>
        <span style={{ minWidth: 0 }}>
          <span style={{ display: "block", fontSize: 12.5, fontWeight: 800, letterSpacing: ".02em", color: "var(--lime)" }}>EMITIR FACTURA ÚNICA</span>
          <span style={{ display: "block", fontSize: 10, color: "var(--text2)", marginTop: 1 }}>{readOnlyReason ?? "Factura manual, una a la vez"}</span>
        </span>
      </button>

      {open && (
        <div className="md-overlay" onClick={() => { if (!enviando) setOpen(false); }}>
          <div className="md-panel" style={{ width: "min(560px, 94vw)", maxHeight: "92vh" }} onClick={(e) => e.stopPropagation()}>
            <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", gap: 12 }}>
              <button aria-label="Cerrar" onClick={() => setOpen(false)} style={{ width: 32, height: 32, borderRadius: 8, border: "1px solid var(--border)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", background: "var(--bg-muted)", color: "var(--text2)", fontSize: 16 }}>×</button>
              <div>
                <h2 style={{ fontSize: 16, fontWeight: 800, letterSpacing: "-0.02em" }}>Factura única</h2>
                <p style={{ fontSize: 11, color: "var(--text2)", marginTop: 2 }}>Receptor completo — la factura lo individualiza entero.</p>
              </div>
            </div>

            {folioListo !== null ? (
              <div style={{ padding: "28px 24px", textAlign: "center" }}>
                <div style={{ fontSize: 34, fontWeight: 800, color: "var(--green)", letterSpacing: "-.03em" }}>#{folioListo}</div>
                <div style={{ fontSize: 13, color: "var(--text2)", marginTop: 4 }}>Tu factura fue emitida correctamente.</div>
                <div style={{ fontSize: 10, color: "var(--amber)", marginTop: 8 }}>● Modo de prueba: se simula, no se informa al SII.</div>
                <button onClick={() => setOpen(false)} style={{ marginTop: 18, border: 0, borderRadius: 10, padding: "11px 22px", background: "var(--accent)", color: "#fff", fontSize: 13, fontWeight: 800, cursor: "pointer", font: "inherit" }}>Listo</button>
              </div>
            ) : (
              <div style={{ padding: "12px 20px 20px", overflowY: "auto" }}>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 12px" }}>
                  <div><label style={labelSt}>RUT receptor</label><input style={inputSt} value={f.rut} onChange={set("rut")} placeholder="12.345.678-5" /></div>
                  <div><label style={labelSt}>Razón social</label><input style={inputSt} value={f.razon} onChange={set("razon")} placeholder="Empresa SpA" /></div>
                  <div><label style={labelSt}>Giro</label><input style={inputSt} value={f.giro} onChange={set("giro")} placeholder="Servicios informáticos" /></div>
                  <div><label style={labelSt}>Comuna</label><input style={inputSt} value={f.comuna} onChange={set("comuna")} placeholder="Santiago" /></div>
                </div>
                <label style={labelSt}>Dirección</label><input style={inputSt} value={f.direccion} onChange={set("direccion")} placeholder="Av. Ejemplo 1234, of. 56" />
                <label style={labelSt}>Email (opcional)</label><input style={inputSt} value={f.email} onChange={set("email")} placeholder="pagos@empresa.cl" />
                <label style={labelSt}>Detalle</label><input style={inputSt} value={f.detalle} onChange={set("detalle")} placeholder="Asesoría mensual agosto" />
                <label style={labelSt}>Valor total (con IVA si corresponde)</label><input style={inputSt} value={f.total} onChange={set("total")} placeholder="500.000" inputMode="numeric" />

                <label style={labelSt}>Forma de pago</label>
                <div style={{ display: "flex", gap: 8 }}>
                  {(["contado", "credito"] as const).map((fp) => (
                    <button key={fp} type="button" onClick={() => setFormaPago(fp)}
                      style={{ flex: 1, padding: "10px 12px", borderRadius: 10, fontSize: 12, fontWeight: 800, cursor: "pointer", font: "inherit",
                        border: formaPago === fp ? "1px solid rgba(201,242,75,.5)" : "1px solid var(--border)",
                        background: formaPago === fp ? "rgba(201,242,75,.08)" : "transparent",
                        color: formaPago === fp ? "var(--lime)" : "var(--text2)" }}>
                      {fp === "contado" ? "Contado" : "Crédito"}
                    </button>
                  ))}
                </div>
                {!formaPago && <div style={{ marginTop: 5, fontSize: 9.5, color: "var(--text3)" }}>Sin selección previa a propósito: tú decides cómo fue la operación.</div>}

                <button onClick={emitir} disabled={!completo || enviando}
                  style={{ width: "100%", marginTop: 16, border: 0, borderRadius: 10, padding: "12px 14px", background: completo && !enviando ? "#E8553E" : "var(--bg-muted)", color: completo && !enviando ? "#fff" : "var(--text3)", fontSize: 13, fontWeight: 800, cursor: completo && !enviando ? "pointer" : "not-allowed", font: "inherit" }}>
                  {enviando ? "Emitiendo…" : "Emitir factura →"}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
