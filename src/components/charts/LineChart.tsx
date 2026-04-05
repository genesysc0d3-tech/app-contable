"use client";

import { useEffect, useRef } from "react";
import {
  Chart,
  LineElement,
  PointElement,
  LineController,
  CategoryScale,
  LinearScale,
  Filler,
  Tooltip,
} from "chart.js";

Chart.register(LineElement, PointElement, LineController, CategoryScale, LinearScale, Filler, Tooltip);

const MESES = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];

function fmtAxis(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n}`;
}

function fmtTooltip(n: number): string {
  return `$${Math.round(n).toLocaleString("es-CL")}`;
}

interface LineChartProps {
  data: { mes: number; anio: number; ingresos: number; egresos: number }[];
}

export default function LineChart({ data }: LineChartProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const chartRef = useRef<Chart | null>(null);

  useEffect(() => {
    if (!canvasRef.current) return;
    const ctx = canvasRef.current.getContext("2d");
    if (!ctx) return;

    // Destroy previous
    if (chartRef.current) chartRef.current.destroy();

    const labels = data.map((d) => `${MESES[d.mes - 1]} ${String(d.anio).slice(2)}`);
    const ingresos = data.map((d) => d.ingresos);
    const egresos = data.map((d) => d.egresos);
    const resultado = data.map((d) => d.ingresos - d.egresos);

    // Detect dark mode
    const isDark = document.documentElement.classList.contains("dark");
    const gridColor = isDark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.04)";
    const tickColor = isDark ? "rgba(255,255,255,0.3)" : "#AAAAAA";

    // Gradients
    const greenGrad = ctx.createLinearGradient(0, 0, 0, 200);
    greenGrad.addColorStop(0, "rgba(74,222,128,0.25)");
    greenGrad.addColorStop(1, "rgba(74,222,128,0)");

    const coralGrad = ctx.createLinearGradient(0, 0, 0, 200);
    coralGrad.addColorStop(0, "rgba(232,120,58,0.2)");
    coralGrad.addColorStop(1, "rgba(232,120,58,0)");

    chartRef.current = new Chart(ctx, {
      type: "line",
      data: {
        labels,
        datasets: [
          {
            label: "Ingresos",
            data: ingresos,
            borderColor: "#4ade80",
            backgroundColor: greenGrad,
            fill: true,
            tension: 0.35,
            pointRadius: 4,
            pointHoverRadius: 7,
            pointBackgroundColor: "#4ade80",
            pointBorderColor: isDark ? "#1c1c1e" : "#ffffff",
            pointBorderWidth: 2,
            borderWidth: 2.5,
          },
          {
            label: "Egresos",
            data: egresos,
            borderColor: "#E8783A",
            backgroundColor: coralGrad,
            fill: true,
            tension: 0.35,
            pointRadius: 4,
            pointHoverRadius: 7,
            pointBackgroundColor: "#E8783A",
            pointBorderColor: isDark ? "#1c1c1e" : "#ffffff",
            pointBorderWidth: 2,
            borderWidth: 2.5,
          },
          {
            label: "Resultado",
            data: resultado,
            borderColor: "#6366f1",
            backgroundColor: "transparent",
            fill: false,
            tension: 0.35,
            borderDash: [6, 4],
            pointRadius: 3,
            pointHoverRadius: 6,
            pointBackgroundColor: "#6366f1",
            pointBorderColor: isDark ? "#1c1c1e" : "#ffffff",
            pointBorderWidth: 2,
            borderWidth: 2,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: {
          duration: 1000,
          easing: "easeInOutQuart",
        },
        interaction: {
          mode: "index",
          intersect: false,
        },
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: isDark ? "#2a2a2e" : "#1c1c1e",
            titleColor: "#ffffff",
            bodyColor: "rgba(255,255,255,0.8)",
            cornerRadius: 10,
            padding: 12,
            titleFont: { size: 12, weight: "bold" as const },
            bodyFont: { size: 11 },
            displayColors: true,
            boxWidth: 8,
            boxHeight: 8,
            boxPadding: 4,
            callbacks: {
              label: (ctx) => ` ${ctx.dataset.label}: ${fmtTooltip(ctx.parsed.y ?? 0)}`,
            },
          },
        },
        scales: {
          x: {
            grid: { display: false },
            ticks: { color: tickColor, font: { size: 10 } },
            border: { display: false },
          },
          y: {
            grid: { color: gridColor },
            ticks: {
              color: tickColor,
              font: { size: 10 },
              callback: (v) => fmtAxis(v as number),
            },
            border: { display: false },
          },
        },
      },
    });

    return () => { chartRef.current?.destroy(); };
  }, [data]);

  // Current month metrics
  const current = data[data.length - 1];
  const resultado = current ? current.ingresos - current.egresos : 0;

  return (
    <div className="rounded-[20px] bg-white dark:bg-white/5 shadow-[var(--card-shadow)] dark:shadow-none border border-[var(--border)] md:hover:-translate-y-0.5 md:hover:shadow-[0_4px_16px_rgba(0,0,0,0.1)] transition-all duration-200 p-4 space-y-3">
      {/* Custom legend */}
      <div className="flex items-center justify-between">
        <p className="text-xs text-[var(--muted)]">Últimos 6 meses</p>
        <div className="flex gap-3">
          <span className="text-[9px] text-[var(--muted-light)] flex items-center gap-1">
            <span className="w-3 h-0.5 rounded-full bg-[#4ade80]" /> Ingresos
          </span>
          <span className="text-[9px] text-[var(--muted-light)] flex items-center gap-1">
            <span className="w-3 h-0.5 rounded-full bg-[#E8783A]" /> Egresos
          </span>
          <span className="text-[9px] text-[var(--muted-light)] flex items-center gap-1">
            <span className="w-3 h-0.5 rounded-full bg-[#6366f1] border-dashed" style={{ borderTop: "1.5px dashed #6366f1", height: 0, width: 12 }} /> Neto
          </span>
        </div>
      </div>

      {/* Chart */}
      <div className="h-48">
        <canvas ref={canvasRef} />
      </div>

      {/* Metrics below */}
      {current && (
        <div className="grid grid-cols-3 gap-2 text-center">
          <div>
            <p className="text-[9px] text-[var(--muted-light)]">Ingresos</p>
            <p className="text-xs font-semibold text-[#4ade80] tabular-nums">{fmtAxis(current.ingresos)}</p>
          </div>
          <div>
            <p className="text-[9px] text-[var(--muted-light)]">Egresos</p>
            <p className="text-xs font-semibold text-[#E8783A] tabular-nums">{fmtAxis(current.egresos)}</p>
          </div>
          <div>
            <p className="text-[9px] text-[var(--muted-light)]">Resultado</p>
            <p className={`text-xs font-semibold tabular-nums ${resultado >= 0 ? "text-[#6366f1]" : "text-[#E8553E]"}`}>{fmtAxis(resultado)}</p>
          </div>
        </div>
      )}
    </div>
  );
}
