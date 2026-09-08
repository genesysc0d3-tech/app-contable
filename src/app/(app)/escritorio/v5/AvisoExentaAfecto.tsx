"use client";

/**
 * Triangulito ámbar con globito (Matías + fundador 2026-09-07): un
 * contribuyente AFECTO que manda una venta exenta está, casi siempre,
 * subdeclarando débito fiscal — y el RCV lo cruza al tiro. No se bloquea
 * (hay ventas exentas legítimas fuera del giro): se avisa en cada tx y en
 * cada cartola, y el porqué sale al pasar el mouse, no como texto suelto.
 *
 * Solo se muestra si el emisor es afecto (tipoDelCarril === "afecto") y el
 * documento va exento (41/34). Exento o `auto` no ven nada.
 */

export const AVISO_EXENTA_TX = "Va exenta y tu actividad es afecta. Solo corresponde si esta venta de verdad se escapa de tu giro. Si es un error, cámbiala en Check.";

export function avisoExentaDoc(n: number): string {
  return `${n === 1 ? "1 venta va exenta" : `${n} ventas van exentas`} y tu actividad es afecta. Solo corresponde si de verdad se escapan de tu giro. Si es un error, corrígelas en Check.`;
}

export function AvisoExentaAfecto({ texto, size = 11 }: { texto: string; size?: number }) {
  return (
    <span className="ax-wrap" role="img" aria-label={texto} onClick={(e) => e.stopPropagation()}>
      <style>{`
        .ax-wrap{position:relative;display:inline-flex;align-items:center;flex-shrink:0;color:var(--amber);cursor:default;vertical-align:middle}
        .ax-tip{position:absolute;left:50%;bottom:calc(100% + 7px);transform:translate(-50%,3px);width:220px;padding:8px 10px;border-radius:9px;background:var(--surface);border:1px solid var(--border);box-shadow:0 10px 28px var(--shadow);color:var(--text);font-size:10.5px;font-weight:600;line-height:1.4;text-align:left;white-space:normal;opacity:0;pointer-events:none;transition:opacity .14s,transform .14s;z-index:40}
        .ax-tip::after{content:"";position:absolute;left:50%;top:100%;transform:translateX(-50%);border:5px solid transparent;border-top-color:var(--border)}
        .ax-wrap:hover .ax-tip,.ax-wrap:focus-within .ax-tip{opacity:1;transform:translate(-50%,0)}
        @media (prefers-reduced-motion:reduce){.ax-tip{transition:none}}
      `}</style>
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ display: "block" }}>
        <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
        <path d="M12 9v4M12 17h.01" />
      </svg>
      <span className="ax-tip" role="tooltip">{texto}</span>
    </span>
  );
}
