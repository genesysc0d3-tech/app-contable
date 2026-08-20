"use client";

import { useEffect, useState } from "react";
import styles from "./BrandPanel.module.css";

// Noticias curadas a mano: cada una le recuerda al usuario por qué emitir.
// Actualizar acá cuando haya novedad del SII relevante al producto.
const NOTICIAS = [
  {
    meta: "Ley 21.713 · Vigente",
    titulo: "Bancos informan al SII sobre 50+ transferencias mensuales",
    detalle:
      "Si recibes pagos por transferencia, el SII ya lo sabe. Emitir tus boletas al día te deja tranquilo.",
  },
  {
    meta: "Boleta electrónica",
    titulo: "Toda venta requiere boleta al momento de la operación",
    detalle:
      "La regla de oro: nunca cruzar el mes. Emite tus ventas dentro del mismo período tributario.",
  },
  {
    meta: "DJ 1963/1964 · Junio 2026",
    titulo: "Exchanges deberán reportar operaciones cripto al SII",
    detalle:
      "Las ventas P2P de cripto son ventas exentas: van con boleta. MassDTE las clasifica desde tu cartola.",
  },
];

// Boletas del cielo: posición, profundidad y ritmos de caída/vaivén por CSS vars.
const BOLETAS = [
  { folio: "5.181", total: "$45.900",  v: { "--x": "6%",  "--tilt": "-5deg", "--sway": "26px",  "--peak": 0.9,  "--swayd": "3.4s", "--swayoff": "-1s",   "--falld": "17s", "--falloff": "-6s" } },
  { folio: "5.203", total: "$120.000", v: { "--x": "34%", "--tilt": "4deg",  "--sway": "-30px", "--peak": 0.35, "--swayd": "4.6s", "--swayoff": "-2.2s", "--falld": "26s", "--falloff": "-18s", "--depth": 0.62, "--haze": "1.6px" } },
  { folio: "5.214", total: "$23.071",  v: { "--x": "58%", "--tilt": "-3deg", "--sway": "22px",  "--peak": 0.8,  "--swayd": "3.9s", "--swayoff": "-.6s",  "--falld": "20s", "--falloff": "-13s" } },
  { folio: "5.190", total: "$89.500",  v: { "--x": "78%", "--tilt": "6deg",  "--sway": "-24px", "--peak": 0.3,  "--swayd": "5s",   "--swayoff": "-3.1s", "--falld": "29s", "--falloff": "-9s",  "--depth": 0.55, "--haze": "2px" } },
  { folio: "5.222", total: "$310.750", v: { "--x": "20%", "--tilt": "3deg",  "--sway": "-20px", "--peak": 0.5,  "--swayd": "4.2s", "--swayoff": "-1.7s", "--falld": "23s", "--falloff": "-20s", "--depth": 0.78, "--haze": ".7px" } },
  { folio: "5.229", total: "$67.320",  v: { "--x": "48%", "--tilt": "-6deg", "--sway": "28px",  "--peak": 0.9,  "--swayd": "3.6s", "--swayoff": "-2.8s", "--falld": "18s", "--falloff": "-3s" } },
  { folio: "5.195", total: "$154.200", v: { "--x": "86%", "--tilt": "-4deg", "--sway": "18px",  "--peak": 0.45, "--swayd": "4.4s", "--swayoff": "-.3s",  "--falld": "25s", "--falloff": "-16s", "--depth": 0.7,  "--haze": "1px" } },
];

const LINE_WIDTHS = [
  ["82%", "60%", "70%"],
  ["60%", "82%", "70%"],
  ["70%", "82%", "60%"],
];

export default function BrandPanel() {
  const [activa, setActiva] = useState(0);

  useEffect(() => {
    const id = setInterval(() => {
      setActiva((i) => (i + 1) % NOTICIAS.length);
    }, 6000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className={styles.panel} aria-hidden="true">
      <div className={styles.sky} aria-hidden="true">
        {BOLETAS.map((b, i) => (
          <div key={b.folio} className={styles.boleta} style={b.v as React.CSSProperties}>
            <div className={styles.paper}>
              <div className={styles.paperHead}>
                <span className={styles.paperTipo}>BOLETA ELECTRÓNICA</span>
                <span className={styles.paperFolio}>N° {b.folio}</span>
              </div>
              {LINE_WIDTHS[i % LINE_WIDTHS.length].map((w, j) => (
                <div key={j} className={styles.paperLine} style={{ width: w }} />
              ))}
              <div className={styles.paperFoot}>
                <span className={styles.paperTotal}>{b.total}</span>
                <span className={styles.paperOk}>✓ Emitida</span>
              </div>
            </div>
          </div>
        ))}
      </div>
      <div className={styles.veil} aria-hidden="true" />

      <div className={styles.brand}>
        {/* eslint-disable-next-line @next/next/no-img-element -- logo estático chico, invertido por CSS */}
        <img src="/massdte-logo.png" alt="MassDTE" />
      </div>

      <div className={styles.tagline}>
        <h1>
          Tu cartola entra.
          <br />
          Tus boletas salen.
        </h1>
        <p>Emite el lote completo en el SII con tu propia clave, desde tu computador.</p>
      </div>

      <div className={styles.news}>
        <div className={styles.newsLabel}>Al día con el SII</div>
        <div className={styles.newsStage}>
          {NOTICIAS.map((n, i) => (
            <div
              key={n.meta}
              className={`${styles.newsCard} ${i === activa ? styles.newsCardActive : ""}`}
            >
              <div className={styles.newsMeta}>{n.meta}</div>
              <h3>{n.titulo}</h3>
              <p>{n.detalle}</p>
            </div>
          ))}
        </div>
        <div className={styles.newsDots}>
          {NOTICIAS.map((n, i) => (
            // key con la activa para reiniciar la barrita de progreso en cada rotación
            <i key={`${n.meta}-${i === activa}`} className={i === activa ? styles.dotOn : undefined} />
          ))}
        </div>
      </div>
    </div>
  );
}
