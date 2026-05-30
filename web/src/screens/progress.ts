// Progress dashboards: favorite-lift strength (est-1RM), bodyweight trend,
// weekly volume, and running pace. Charts are dependency-free SVG.
import { api } from "../api";
import { esc } from "../util";
import { lineChart, paceLabel, type Point } from "../chart";
import type { Exercise } from "../../../shared/types";

interface Series<T> {
  points: T[];
}
type ExPoint = { date: string; oneRm: number; volume: number; bestWeight: number; bestReps: number };
type BwPoint = { date: string; weight: number };
type VolPoint = { week: string; volume: number };
type RunPoint = { date: string; pace: number; distance: number; type: string | null };

const md = (date: string) => date.slice(5); // MM-DD

export async function renderProgress(root: HTMLElement) {
  root.innerHTML = `<div class="card"><p class="muted">Loading…</p></div>`;

  let exercises: Exercise[];
  try {
    exercises = await api.get<Exercise[]>("/api/exercises");
  } catch {
    root.innerHTML = `<div class="card"><p class="error">Couldn’t load progress (offline?).</p></div>`;
    return;
  }
  const favorites = exercises.filter((e) => e.isFavorite);

  const [favSeries, bw, vol, run] = await Promise.all([
    Promise.all(
      favorites.map((e) =>
        api.get<Series<ExPoint>>(`/api/stats/exercise/${e.id}`).then((s) => ({ e, s })),
      ),
    ),
    api.get<Series<BwPoint>>("/api/stats/bodyweight"),
    api.get<Series<VolPoint>>("/api/stats/volume"),
    api.get<Series<RunPoint>>("/api/stats/running"),
  ]);

  const favCards = favSeries
    .map(({ e, s }) => {
      const pts: Point[] = s.points.map((p) => ({ label: md(p.date), value: p.oneRm }));
      const latest = s.points[s.points.length - 1];
      const sub = latest
        ? `best ${latest.bestWeight}×${latest.bestReps} ${esc(e.unit)} · est 1RM`
        : "no sessions logged yet";
      return `
        <div class="card">
          <div class="row"><strong class="grow">${esc(e.name)}</strong>
            <span class="muted small">${sub}</span></div>
          ${lineChart(pts, { unit: e.unit })}
        </div>`;
    })
    .join("");

  const bwCard = `
    <div class="card">
      <h2>Bodyweight</h2>
      ${lineChart(
        bw.points.map((p) => ({ label: md(p.date), value: p.weight })),
        { unit: "lbs", color: "var(--good)" },
      )}
    </div>`;

  const volCard = `
    <div class="card">
      <h2>Weekly volume</h2>
      ${lineChart(
        vol.points.map((p) => ({ label: md(p.week), value: p.volume })),
        { unit: "lbs", color: "#a78bfa" },
      )}
    </div>`;

  const runCard = `
    <div class="card">
      <h2>Running pace</h2>
      ${lineChart(
        run.points.map((p) => ({ label: md(p.date), value: p.pace })),
        { unit: "/mi", color: "#fbbf24", format: paceLabel },
      )}
      ${run.points.length ? `<p class="muted small">lower is faster</p>` : ""}
    </div>`;

  root.innerHTML = `
    ${favorites.length ? `<h2 class="section">Favorite lifts</h2>${favCards}` : ""}
    <h2 class="section">Body & volume</h2>
    ${bwCard}
    ${volCard}
    ${runCard}`;
}
