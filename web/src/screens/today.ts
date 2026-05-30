// Today / session logging: pick date + routine, load a prefilled session
// (progression-suggested), then edit sets, metrics, run, and notes live.
import { api } from "../api";
import { esc } from "../util";
import type { Exercise, Routine, Session, SessionExercise } from "../../../shared/types";

let library: Exercise[] = [];
let routines: Routine[] = [];
let current: Session | null = null;
let chosenDate = new Date().toISOString().slice(0, 10);

const exName = (id: string) => library.find((e) => e.id === id)?.name ?? "(exercise)";
const exUnit = (id: string) => library.find((e) => e.id === id)?.unit ?? "lbs";
const exStep = (id: string) => library.find((e) => e.id === id)?.progressionStep ?? 5;

export async function renderToday(root: HTMLElement) {
  root.innerHTML = `<div class="card"><p class="muted">Loading…</p></div>`;
  try {
    [library, routines] = await Promise.all([
      api.get<Exercise[]>("/api/exercises"),
      api.get<Routine[]>("/api/routines"),
    ]);
  } catch {
    root.innerHTML = `<div class="card"><p class="error">Couldn’t load. Are you online?</p></div>`;
    return;
  }
  current = null;
  paintPicker(root);
}

function paintPicker(root: HTMLElement) {
  root.innerHTML = `
    <div class="card">
      <h2>Load a workout</h2>
      <label class="stack">Date<input id="date" type="date" value="${chosenDate}" /></label>
      <label class="stack">Routine
        <select id="routine">
          <option value="">— empty session —</option>
          ${routines.map((r) => `<option value="${r.id}">${esc(r.name)}</option>`).join("")}
        </select>
      </label>
      <button id="load" class="primary">Load today’s workout</button>
      ${routines.length ? "" : `<p class="muted small">Tip: create a routine first for prefilled, progressed sets.</p>`}
    </div>`;

  root.querySelector<HTMLInputElement>("#date")!.addEventListener("change", (e) => {
    chosenDate = (e.target as HTMLInputElement).value;
  });
  root.querySelector("#load")!.addEventListener("click", async () => {
    const routineId = root.querySelector<HTMLSelectElement>("#routine")!.value || null;
    const btn = root.querySelector<HTMLButtonElement>("#load")!;
    btn.disabled = true;
    try {
      current = await api.post<Session>("/api/sessions", { date: chosenDate, routineId });
      paintSession(root);
    } catch (e) {
      btn.disabled = false;
      alert((e as Error).message);
    }
  });
}

function paintSession(root: HTMLElement) {
  const s = current!;
  root.innerHTML = `
    <div class="card">
      <div class="row">
        <div class="grow">
          <strong>${esc(s.title ?? "Workout")}</strong>
          <div class="muted small">${esc(s.date)}${
            s.routineId ? " · prefilled from last time" : ""
          }</div>
        </div>
        <button class="link-btn" id="change">Change</button>
      </div>
      <label class="check"><input type="checkbox" id="completed" ${s.completed ? "checked" : ""}/> Completed</label>
    </div>

    <details class="card"><summary>Daily metrics</summary>
      <div class="two">
        ${metricInput("bodyWeight", "Weight (lbs)", s.bodyWeight)}
        ${metricInput("sleepHours", "Sleep (hrs)", s.sleepHours)}
      </div>
      <div class="two">
        ${metricInput("energy", "Energy 1–10", s.energy)}
        ${metricInput("mood", "Mood 1–10", s.mood)}
      </div>
      <div class="two">
        ${metricInput("calories", "Calories", s.calories)}
        <label class="stack">Protein hit?
          <select data-metric="proteinHit">
            <option value=""  ${s.proteinHit == null ? "selected" : ""}>—</option>
            <option value="1" ${s.proteinHit === true ? "selected" : ""}>Yes</option>
            <option value="0" ${s.proteinHit === false ? "selected" : ""}>No</option>
          </select>
        </label>
      </div>
    </details>

    <div id="exercises">${s.exercises.map(exerciseCard).join("")}</div>

    ${runCard(s)}

    <div class="card">
      <label class="stack">Notes<textarea id="notes" rows="3">${esc(s.notes ?? "")}</textarea></label>
    </div>`;

  wireSession(root);
}

function metricInput(field: string, label: string, value: number | null): string {
  return `<label class="stack">${label}
    <input type="number" step="any" data-metric="${field}" value="${value ?? ""}" /></label>`;
}

function exerciseCard(sx: SessionExercise): string {
  const unit = exUnit(sx.exerciseId);
  const rows = sx.sets
    .map(
      (set) => `
      <div class="row setrow" data-set="${set.id}">
        <span class="setnum">${set.setNumber}</span>
        <input class="num" type="number" step="any" data-f="weight" value="${set.weight ?? ""}" placeholder="${esc(unit)}" />
        <span class="muted">×</span>
        <input class="num" type="number" data-f="reps" value="${set.reps ?? ""}" placeholder="reps" />
        <button class="done ${set.completed ? "on" : ""}" data-done title="Mark set done">✓</button>
        <button class="iconbtn danger" data-rmset title="Remove set">✕</button>
      </div>`,
    )
    .join("");
  return `
    <div class="card" data-sx="${sx.id}" data-ex="${sx.exerciseId}">
      <div class="row">
        <strong class="grow">${esc(exName(sx.exerciseId))}</strong>
        <input class="num" type="number" step="0.5" data-rpe value="${sx.rpe ?? ""}" placeholder="RPE" title="RPE" />
      </div>
      <div class="sets">${rows}</div>
      <div class="row">
        <button class="ghost" data-addset>+ Set</button>
        <button class="ghost" data-bump>+${exStep(sx.exerciseId)} ${esc(unit)} all</button>
      </div>
    </div>`;
}

function runCard(s: Session): string {
  const r = s.run;
  const mmss =
    r?.durationSec != null
      ? `${Math.floor(r.durationSec / 60)}:${String(r.durationSec % 60).padStart(2, "0")}`
      : "";
  return `
    <details class="card" id="run" ${r ? "open" : ""}><summary>Running (optional)</summary>
      <div class="two">
        <label class="stack">Distance (mi)<input id="run-dist" type="number" step="any" value="${r?.distanceMi ?? ""}" /></label>
        <label class="stack">Time (mm:ss)<input id="run-time" value="${mmss}" placeholder="28:30" /></label>
      </div>
      <div class="two">
        <label class="stack">Effort 1–10<input id="run-effort" type="number" value="${r?.effort ?? ""}" /></label>
        <label class="stack">Type
          <select id="run-type">
            ${["", "easy", "tempo", "intervals", "long", "recovery"]
              .map((t) => `<option value="${t}" ${r?.runType === (t || null) ? "selected" : ""}>${t || "—"}</option>`)
              .join("")}
          </select>
        </label>
      </div>
      <div class="muted small" id="pace"></div>
    </details>`;
}

// ---------- wiring ----------
function wireSession(root: HTMLElement) {
  const s = current!;

  root.querySelector("#change")!.addEventListener("click", () => paintPicker(root));

  root.querySelector<HTMLInputElement>("#completed")!.addEventListener("change", (e) =>
    patchSession({ completed: (e.target as HTMLInputElement).checked }),
  );

  // Daily metrics
  root.querySelectorAll<HTMLElement>("[data-metric]").forEach((el) =>
    el.addEventListener("change", () => {
      const field = el.dataset.metric!;
      const raw = (el as HTMLInputElement).value;
      let value: number | boolean | null;
      if (field === "proteinHit") value = raw === "" ? null : raw === "1";
      else value = raw === "" ? null : Number(raw);
      patchSession({ [field]: value });
    }),
  );

  root.querySelector<HTMLTextAreaElement>("#notes")!.addEventListener("change", (e) =>
    patchSession({ notes: (e.target as HTMLTextAreaElement).value || null }),
  );

  // Per-exercise / per-set
  root.querySelectorAll<HTMLElement>("[data-sx]").forEach((cardEl) => {
    const sxId = cardEl.dataset.sx!;
    const exId = cardEl.dataset.ex!;

    cardEl.querySelector<HTMLInputElement>("[data-rpe]")!.addEventListener("change", (e) => {
      const v = (e.target as HTMLInputElement).value;
      api.patch(`/api/session-exercises/${sxId}`, { rpe: v === "" ? null : Number(v) });
    });

    cardEl.querySelectorAll<HTMLElement>(".setrow").forEach((rowEl) => wireSetRow(rowEl));

    cardEl.querySelector("[data-addset]")!.addEventListener("click", async () => {
      const res = await api.post<{ id: string; setNumber: number }>(
        `/api/session-exercises/${sxId}/sets`,
        {},
      );
      const sx = s.exercises.find((x) => x.id === sxId)!;
      sx.sets.push({
        id: res.id,
        setNumber: res.setNumber,
        weight: null,
        reps: null,
        rpe: null,
        isWarmup: false,
        completed: false,
      });
      paintSession(root);
    });

    cardEl.querySelector("[data-bump]")!.addEventListener("click", async () => {
      const sx = s.exercises.find((x) => x.id === sxId)!;
      const step = exStep(exId);
      await Promise.all(
        sx.sets.map((set) => {
          set.weight = (set.weight ?? 0) + step;
          return api.patch(`/api/sets/${set.id}`, { weight: set.weight });
        }),
      );
      paintSession(root);
    });
  });

  wireRun(root);
}

function wireSetRow(rowEl: HTMLElement) {
  const setId = rowEl.dataset.set!;
  const sx = current!.exercises.find((x) => x.sets.some((st) => st.id === setId))!;
  const set = sx.sets.find((st) => st.id === setId)!;

  rowEl.querySelectorAll<HTMLInputElement>("input[data-f]").forEach((inp) =>
    inp.addEventListener("change", () => {
      const f = inp.dataset.f as "weight" | "reps";
      const v = inp.value === "" ? null : Number(inp.value);
      (set as unknown as Record<string, unknown>)[f] = v;
      api.patch(`/api/sets/${setId}`, { [f]: v });
    }),
  );

  rowEl.querySelector("[data-done]")!.addEventListener("click", () => {
    set.completed = !set.completed;
    rowEl.querySelector("[data-done]")!.classList.toggle("on", set.completed);
    api.patch(`/api/sets/${setId}`, { completed: set.completed });
  });

  rowEl.querySelector("[data-rmset]")!.addEventListener("click", async () => {
    await api.del(`/api/sets/${setId}`);
    sx.sets = sx.sets.filter((st) => st.id !== setId);
    rowEl.remove();
  });
}

function parseMmss(v: string): number | null {
  if (!v.trim()) return null;
  const [m, s] = v.split(":");
  if (s === undefined) return Number(m) || null;
  return (Number(m) || 0) * 60 + (Number(s) || 0);
}

function wireRun(root: HTMLElement) {
  const get = <T extends HTMLElement>(s: string) => root.querySelector<T>(s)!;
  const dist = get<HTMLInputElement>("#run-dist");
  const time = get<HTMLInputElement>("#run-time");
  const effort = get<HTMLInputElement>("#run-effort");
  const type = get<HTMLSelectElement>("#run-type");
  const pace = get<HTMLElement>("#pace");

  function showPace() {
    const d = Number(dist.value);
    const secs = parseMmss(time.value);
    if (d > 0 && secs) {
      const p = secs / d;
      pace.textContent = `Pace: ${Math.floor(p / 60)}:${String(Math.round(p % 60)).padStart(2, "0")}/mi`;
    } else pace.textContent = "";
  }
  function save() {
    showPace();
    api
      .put(`/api/sessions/${current!.id}/run`, {
        distanceMi: dist.value === "" ? null : Number(dist.value),
        durationSec: parseMmss(time.value),
        effort: effort.value === "" ? null : Number(effort.value),
        runType: type.value || null,
      })
      .catch(() => {});
  }
  [dist, time, effort, type].forEach((el) => el.addEventListener("change", save));
  showPace();
}

function patchSession(patch: Record<string, unknown>) {
  Object.assign(current!, patch);
  api.patch(`/api/sessions/${current!.id}`, patch).catch(() => {});
}
