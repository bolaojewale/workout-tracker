// Minimal dependency-free SVG charts. Responsive via viewBox; the container
// controls width. Designed for small progress trends.
import { esc } from "./util";

export interface Point {
  label: string; // x-axis label (e.g. a date)
  value: number;
}

const W = 320;
const H = 120;
const PAD = { top: 12, right: 8, bottom: 18, left: 30 };

export function lineChart(
  points: Point[],
  opts: { unit?: string; color?: string; format?: (n: number) => string } = {},
): string {
  if (points.length === 0) {
    return `<p class="muted small">No data yet.</p>`;
  }
  const color = opts.color ?? "var(--accent)";
  const fmt = opts.format ?? defaultFmt;
  const values = points.map((p) => p.value);
  let min = Math.min(...values);
  let max = Math.max(...values);
  if (min === max) {
    min -= 1;
    max += 1;
  }
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;

  const x = (i: number) =>
    PAD.left + (points.length === 1 ? plotW / 2 : (i / (points.length - 1)) * plotW);
  const y = (v: number) => PAD.top + plotH - ((v - min) / (max - min)) * plotH;

  const path = points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(" ");
  const dots = points
    .map((p, i) => `<circle cx="${x(i).toFixed(1)}" cy="${y(p.value).toFixed(1)}" r="2.5" fill="${color}"/>`)
    .join("");

  const last = points[points.length - 1];
  const first = points[0];

  return `
    <svg viewBox="0 0 ${W} ${H}" class="chart" preserveAspectRatio="none" role="img">
      <line x1="${PAD.left}" y1="${PAD.top}" x2="${PAD.left}" y2="${H - PAD.bottom}" class="axis"/>
      <line x1="${PAD.left}" y1="${H - PAD.bottom}" x2="${W - PAD.right}" y2="${H - PAD.bottom}" class="axis"/>
      <text x="2" y="${PAD.top + 4}" class="axis-lbl">${fmt(max)}</text>
      <text x="2" y="${H - PAD.bottom}" class="axis-lbl">${fmt(min)}</text>
      <path d="${path}" fill="none" stroke="${color}" stroke-width="2"/>
      ${dots}
      <text x="${PAD.left}" y="${H - 4}" class="axis-lbl">${esc(first.label)}</text>
      <text x="${W - PAD.right}" y="${H - 4}" text-anchor="end" class="axis-lbl">${esc(last.label)}</text>
    </svg>
    <div class="chart-current">${fmt(last.value)}${opts.unit ? " " + esc(opts.unit) : ""}
      <span class="muted small">latest</span></div>`;
}

function defaultFmt(n: number): string {
  return Math.abs(n) >= 1000 ? (n / 1000).toFixed(1) + "k" : String(Math.round(n * 10) / 10);
}

// Format seconds as m:ss (for running pace).
export function paceLabel(secPerMi: number): string {
  return `${Math.floor(secPerMi / 60)}:${String(Math.round(secPerMi % 60)).padStart(2, "0")}`;
}
