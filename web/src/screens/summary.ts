// Weekly & monthly summaries, laid out like the paper sheet.
// Weekly is computed (read-only); monthly is the editable check-in log.
import { api } from "../api";
import { esc } from "../util";
import { paceLabel } from "../chart";
import { renderPhotos } from "./photos";
import type { Checkin, Exercise } from "../../../shared/types";

let tab: "weekly" | "monthly" = "weekly";
let weekDate = new Date().toISOString().slice(0, 10);

interface WeeklySummary {
  weekStart: string;
  weekEnd: string;
  weightDays: { date: string; weight: number | null }[];
  weightAvg: number | null;
  workouts: { date: string; hasSession: boolean; completed: boolean }[];
  mainLifts: { exerciseId: string; name: string; unit: string; bestWeight: number | null; bestReps: number | null }[];
  running: { easyPace: number | null; longPace: number | null; speedPace: number | null; totalMiles: number };
}

const DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export async function renderSummary(root: HTMLElement) {
  root.innerHTML = `
    <div class="card tabbar">
      <button class="tab ${tab === "weekly" ? "active" : ""}" id="t-weekly">Weekly</button>
      <button class="tab ${tab === "monthly" ? "active" : ""}" id="t-monthly">Monthly</button>
    </div>
    <div id="sum-body"><p class="muted">Loading…</p></div>`;
  root.querySelector("#t-weekly")!.addEventListener("click", () => {
    tab = "weekly";
    renderSummary(root);
  });
  root.querySelector("#t-monthly")!.addEventListener("click", () => {
    tab = "monthly";
    renderSummary(root);
  });
  const body = root.querySelector<HTMLElement>("#sum-body")!;
  if (tab === "weekly") await renderWeekly(body);
  else await renderMonthly(body);
}

// ---------- Weekly ----------
async function renderWeekly(body: HTMLElement) {
  let w: WeeklySummary;
  try {
    w = await api.get<WeeklySummary>(`/api/summary/weekly?week=${weekDate}`);
  } catch {
    body.innerHTML = `<p class="error">Couldn’t load (offline?).</p>`;
    return;
  }

  const weightRow = w.weightDays
    .map(
      (d, i) =>
        `<div class="wcell"><span class="muted small">${DOW[i]}</span><strong>${d.weight ?? "—"}</strong></div>`,
    )
    .join("");
  const workoutRow = w.workouts
    .map(
      (d, i) =>
        `<div class="wcell"><span class="muted small">${DOW[i]}</span>${
          d.completed ? "✅" : d.hasSession ? "🟡" : "—"
        }</div>`,
    )
    .join("");
  const lifts = w.mainLifts
    .map(
      (l) =>
        `<div class="row"><span class="grow">${esc(l.name)}</span><strong>${
          l.bestWeight != null ? `${l.bestWeight}×${l.bestReps} ${esc(l.unit)}` : "—"
        }</strong></div>`,
    )
    .join("");
  const pace = (p: number | null) => (p != null ? `${paceLabel(p)}/mi` : "—");

  body.innerHTML = `
    <div class="card weeknav">
      <button class="iconbtn" id="prev">←</button>
      <div class="grow center"><strong>Week of ${esc(w.weekStart)}</strong></div>
      <button class="iconbtn" id="next">→</button>
      <button class="link-btn" id="thisweek">This week</button>
    </div>

    <div class="card">
      <h2>Weight trend</h2>
      <div class="wgrid">${weightRow}</div>
      <p class="muted small">Avg: ${w.weightAvg ?? "—"} lbs</p>
    </div>

    <div class="card">
      <h2>Workouts (completed vs planned)</h2>
      <div class="wgrid">${workoutRow}</div>
      <p class="muted small">✅ completed · 🟡 logged, not marked done · — none</p>
    </div>

    <div class="card">
      <h2>Main lift progress (best set)</h2>
      ${lifts || `<p class="muted small">No favorite lifts.</p>`}
    </div>

    <div class="card">
      <h2>Running</h2>
      <div class="row"><span class="grow">Easy pace</span><strong>${pace(w.running.easyPace)}</strong></div>
      <div class="row"><span class="grow">Long run pace</span><strong>${pace(w.running.longPace)}</strong></div>
      <div class="row"><span class="grow">Speed work pace</span><strong>${pace(w.running.speedPace)}</strong></div>
      <div class="row"><span class="grow">Weekly total</span><strong>${w.running.totalMiles} mi</strong></div>
    </div>`;

  body.querySelector("#prev")!.addEventListener("click", () => {
    weekDate = shiftWeek(w.weekStart, -7);
    renderSummary(body.closest("#screen") as HTMLElement);
  });
  body.querySelector("#next")!.addEventListener("click", () => {
    weekDate = shiftWeek(w.weekStart, 7);
    renderSummary(body.closest("#screen") as HTMLElement);
  });
  body.querySelector("#thisweek")!.addEventListener("click", () => {
    weekDate = new Date().toISOString().slice(0, 10);
    renderSummary(body.closest("#screen") as HTMLElement);
  });
}

function shiftWeek(date: string, days: number): string {
  const d = new Date(date + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// ---------- Monthly (check-ins) ----------
let library: Exercise[] = [];

async function renderMonthly(body: HTMLElement) {
  let checkins: Checkin[];
  try {
    [checkins, library] = await Promise.all([
      api.get<Checkin[]>("/api/checkins"),
      api.get<Exercise[]>("/api/exercises"),
    ]);
  } catch {
    body.innerHTML = `<p class="error">Couldn’t load (offline?).</p>`;
    return;
  }

  const cards = checkins
    .map((ci, i) => checkinCard(ci, checkins[i + 1] ?? null))
    .join("");
  body.innerHTML = `
    <div class="card"><button class="primary" id="new-ci">+ New check-in</button></div>
    ${cards || `<p class="muted">No check-ins yet. Log measurements monthly.</p>`}`;

  body.querySelector("#new-ci")!.addEventListener("click", () => checkinForm(body, null));
  body.querySelectorAll<HTMLElement>("[data-edit-ci]").forEach((el) =>
    el.addEventListener("click", () =>
      checkinForm(body, checkins.find((c) => c.id === el.dataset.editCi) ?? null),
    ),
  );
}

const exName = (id: string) => library.find((e) => e.id === id)?.name ?? "(lift)";

function delta(cur: number | null, prev: number | null, unit = ""): string {
  if (cur == null || prev == null) return "";
  const d = Math.round((cur - prev) * 10) / 10;
  if (d === 0) return ` <span class="muted small">(±0)</span>`;
  const cls = d > 0 ? "up" : "down";
  return ` <span class="small ${cls}">(${d > 0 ? "+" : ""}${d}${unit})</span>`;
}

function mmss(sec: number | null): string {
  if (sec == null) return "—";
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
}

function checkinCard(ci: Checkin, prev: Checkin | null): string {
  const m = (label: string, v: number | null, p: number | null, unit = '"') =>
    v == null ? "" : `<div class="row"><span class="grow">${label}</span><strong>${v}${unit}${delta(v, p, unit)}</strong></div>`;
  const measurements = [
    m("Chest", ci.chest, prev?.chest ?? null),
    m("Waist", ci.waist, prev?.waist ?? null),
    m("Hips", ci.hips, prev?.hips ?? null),
    m("Arms", ci.arms, prev?.arms ?? null),
    m("Thighs", ci.thighs, prev?.thighs ?? null),
    m("Forearms", ci.forearms, prev?.forearms ?? null),
  ].join("");
  const lifts = ci.lifts
    .map((l) => {
      const pl = prev?.lifts.find((x) => x.exerciseId === l.exerciseId) ?? null;
      return `<div class="row"><span class="grow">${esc(exName(l.exerciseId))}</span><strong>${
        l.weight != null ? `${l.weight}×${l.reps}` : "—"
      }${delta(l.weight, pl?.weight ?? null)}</strong></div>`;
    })
    .join("");
  const mile =
    ci.mileTimeSec != null
      ? `<div class="row"><span class="grow">1-mile time</span><strong>${mmss(ci.mileTimeSec)}${delta(
          ci.mileTimeSec,
          prev?.mileTimeSec ?? null,
          "s",
        )}</strong></div>`
      : "";
  const bw =
    ci.bodyWeight != null
      ? `<div class="row"><span class="grow">Weight</span><strong>${ci.bodyWeight} lbs${delta(
          ci.bodyWeight,
          prev?.bodyWeight ?? null,
          " lbs",
        )}</strong></div>`
      : "";

  return `
    <div class="card">
      <div class="row"><strong class="grow">${esc(ci.date)}</strong>
        <button class="link-btn" data-edit-ci="${ci.id}">Edit</button></div>
      ${bw}${mile}
      ${measurements ? `<h2 class="mini">Measurements</h2>${measurements}` : ""}
      ${lifts ? `<h2 class="mini">Compound lifts</h2>${lifts}` : ""}
      ${ci.notes ? `<p class="muted small">${esc(ci.notes)}</p>` : ""}
    </div>`;
}

function checkinForm(body: HTMLElement, ci: Checkin | null) {
  const editing = !!ci;
  const v = (n: number | null | undefined) => (n == null ? "" : String(n));
  const favs = library.filter((e) => e.isFavorite && e.kind === "lift");
  const liftVal = (exId: string, f: "weight" | "reps") => {
    const l = ci?.lifts.find((x) => x.exerciseId === exId);
    return l ? v(l[f]) : "";
  };

  body.innerHTML = `
    <div class="card">
      <h2>${editing ? "Edit check-in" : "New check-in"}</h2>
      <label class="stack">Date<input id="ci-date" type="date" value="${ci?.date ?? new Date().toISOString().slice(0, 10)}" /></label>
      <div class="two">
        <label class="stack">Weight (lbs)<input id="ci-bw" type="number" step="any" value="${v(ci?.bodyWeight)}" /></label>
        <label class="stack">1-mile (mm:ss)<input id="ci-mile" value="${mmss(ci?.mileTimeSec ?? null).replace("—", "")}" placeholder="7:30" /></label>
      </div>
    </div>
    <div class="card">
      <h2 class="mini">Measurements (in)</h2>
      <div class="two">
        ${num("ci-chest", "Chest", v(ci?.chest))}${num("ci-waist", "Waist", v(ci?.waist))}
      </div>
      <div class="two">
        ${num("ci-hips", "Hips", v(ci?.hips))}${num("ci-arms", "Arms", v(ci?.arms))}
      </div>
      <div class="two">
        ${num("ci-thighs", "Thighs", v(ci?.thighs))}${num("ci-forearms", "Forearms", v(ci?.forearms))}
      </div>
    </div>
    <div class="card">
      <h2 class="mini">Compound lift tests</h2>
      ${
        favs
          .map(
            (e) => `
        <div class="row" data-lift="${e.id}">
          <span class="grow">${esc(e.name)}</span>
          <input class="num" type="number" step="any" data-lw value="${liftVal(e.id, "weight")}" placeholder="lbs" />
          <span class="muted">×</span>
          <input class="num" type="number" data-lr value="${liftVal(e.id, "reps")}" placeholder="reps" />
        </div>`,
          )
          .join("") || `<p class="muted small">Mark lifts as favorites to test them here.</p>`
      }
    </div>
    ${
      editing
        ? `<div class="card"><h2 class="mini">Progress photos</h2><div id="ci-photos"></div></div>`
        : `<div class="card"><p class="muted small">Save the check-in first, then reopen it to add progress photos.</p></div>`
    }
    <div class="card">
      <label class="stack">Notes<textarea id="ci-notes" rows="2">${esc(ci?.notes ?? "")}</textarea></label>
      <p class="error" id="ci-err" hidden></p>
      <div class="two">
        <button class="ghost" id="ci-cancel">Cancel</button>
        <button class="primary" id="ci-save">${editing ? "Save" : "Create"}</button>
      </div>
      ${editing ? `<button class="link-btn danger" id="ci-del">Delete check-in</button>` : ""}
    </div>`;

  if (editing) renderPhotos(body.querySelector<HTMLElement>("#ci-photos")!, ci!.id);

  body.querySelector("#ci-cancel")!.addEventListener("click", () => renderMonthly(body));
  body.querySelector("#ci-del")?.addEventListener("click", async () => {
    if (!confirm("Delete this check-in?")) return;
    await api.del(`/api/checkins/${ci!.id}`);
    renderMonthly(body);
  });

  body.querySelector("#ci-save")!.addEventListener("click", async () => {
    const err = body.querySelector<HTMLElement>("#ci-err")!;
    err.hidden = true;
    const num = (id: string) => {
      const el = body.querySelector<HTMLInputElement>(id)!;
      return el.value === "" ? null : Number(el.value);
    };
    const lifts = [...body.querySelectorAll<HTMLElement>("[data-lift]")]
      .map((el) => ({
        exerciseId: el.dataset.lift!,
        weight: parseInput(el.querySelector<HTMLInputElement>("[data-lw]")!.value),
        reps: parseInput(el.querySelector<HTMLInputElement>("[data-lr]")!.value),
      }))
      .filter((l) => l.weight != null || l.reps != null);
    const payload = {
      date: body.querySelector<HTMLInputElement>("#ci-date")!.value,
      bodyWeight: num("#ci-bw"),
      mileTimeSec: parseMmss(body.querySelector<HTMLInputElement>("#ci-mile")!.value),
      chest: num("#ci-chest"),
      waist: num("#ci-waist"),
      hips: num("#ci-hips"),
      arms: num("#ci-arms"),
      thighs: num("#ci-thighs"),
      forearms: num("#ci-forearms"),
      notes: body.querySelector<HTMLTextAreaElement>("#ci-notes")!.value || null,
      lifts,
    };
    try {
      if (editing) await api.patch(`/api/checkins/${ci!.id}`, payload);
      else await api.post("/api/checkins", payload);
      renderMonthly(body);
    } catch (e) {
      err.textContent = (e as Error).message;
      err.hidden = false;
    }
  });
}

function num(id: string, label: string, value: string): string {
  return `<label class="stack">${label}<input id="${id}" type="number" step="any" value="${value}" /></label>`;
}
function parseInput(s: string): number | null {
  return s.trim() === "" ? null : Number(s);
}
function parseMmss(v: string): number | null {
  if (!v.trim()) return null;
  const [m, s] = v.split(":");
  if (s === undefined) return Number(m) || null;
  return (Number(m) || 0) * 60 + (Number(s) || 0);
}
