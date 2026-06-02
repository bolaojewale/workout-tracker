// Today / session logging: pick date + routine, load a prefilled session
// (progression-suggested), then edit sets, metrics, run, and notes live.
import { api, ApiError } from "../api";
import { mutate } from "../sync";
import { cacheGet, cacheSet } from "../store";
import { esc } from "../util";
import { renderFood, foodDatalist } from "./food";
import type { Exercise, Routine, Session, SessionExercise } from "../../../shared/types";

let library: Exercise[] = [];
let routines: Routine[] = [];
let current: Session | null = null;
let chosenDate = new Date().toISOString().slice(0, 10);

const exName = (id: string) => library.find((e) => e.id === id)?.name ?? "(exercise)";
const exUnit = (id: string) => library.find((e) => e.id === id)?.unit ?? "lbs";
const exStep = (id: string) => library.find((e) => e.id === id)?.progressionStep ?? 5;

// Time-of-day label, e.g. "7:32 AM" — used to tell apart multiple same-day workouts.
const timeLabel = (epochMs: number) =>
  new Date(epochMs).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

export async function renderToday(root: HTMLElement) {
  root.innerHTML = `<div class="card"><p class="muted">Loading…</p></div>`;
  try {
    [library, routines] = await Promise.all([
      api.get<Exercise[]>("/api/exercises"),
      api.get<Routine[]>("/api/routines"),
    ]);
    cacheSet("exercises", library);
    cacheSet("routines", routines);
  } catch {
    // Offline: fall back to last-known data so the gym still works.
    library = (await cacheGet<Exercise[]>("exercises")) ?? [];
    routines = (await cacheGet<Routine[]>("routines")) ?? [];
    if (!library.length) {
      root.innerHTML = `<div class="card"><p class="error">Couldn’t load and no offline copy yet. Connect once, then it works offline.</p></div>`;
      return;
    }
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
    </div>
    <div class="card">
      <h2>Recent workouts</h2>
      <div id="recent"><p class="muted small">Loading…</p></div>
    </div>`;

  root.querySelector<HTMLInputElement>("#date")!.addEventListener("change", (e) => {
    chosenDate = (e.target as HTMLInputElement).value;
  });
  root.querySelector("#load")!.addEventListener("click", () => {
    const routineId = root.querySelector<HTMLSelectElement>("#routine")!.value || null;
    loadSession(root, chosenDate, routineId);
  });

  paintRecent(root);
}

// Load (or create) a session for a date+routine and switch to the logging view.
// forceNew always creates a fresh session (multiple workouts per day).
async function loadSession(
  root: HTMLElement,
  date: string,
  routineId: string | null,
  forceNew = false,
) {
  const cacheKey = `session:${date}:${routineId ?? ""}`;
  try {
    current = await api.post<Session>("/api/sessions", { date, routineId, forceNew });
    if (!forceNew) cacheSet(cacheKey, current);
    paintSession(root);
  } catch (e) {
    if (forceNew) {
      alert("Starting another workout needs a connection.");
      return;
    }
    const cached = await cacheGet<Session>(cacheKey);
    if (cached) {
      current = cached;
      paintSession(root);
    } else {
      alert(
        e instanceof ApiError
          ? e.message
          : "You’re offline and haven’t loaded this workout before. Load it once online first.",
      );
    }
  }
}

// Open an already-saved session by id (from the recent list).
async function openSessionById(root: HTMLElement, id: string) {
  try {
    current = await api.get<Session>(`/api/sessions/${id}`);
    cacheCurrent();
    paintSession(root);
  } catch {
    alert("Couldn’t open that workout (are you online?).");
  }
}

// Recent-sessions list with per-day delete.
async function paintRecent(root: HTMLElement) {
  const host = root.querySelector<HTMLElement>("#recent");
  if (!host) return;
  let recent: Session[];
  try {
    recent = await api.get<Session[]>("/api/sessions");
    cacheSet("recent-sessions", recent);
  } catch {
    recent = (await cacheGet<Session[]>("recent-sessions")) ?? [];
  }
  recent = recent.slice(0, 15);

  if (!recent.length) {
    host.innerHTML = `<p class="muted small">No workouts yet. Load one above to get started.</p>`;
    return;
  }
  // When a date has more than one workout, show each one's time of day so they
  // can be told apart.
  const perDate = new Map<string, number>();
  recent.forEach((s) => perDate.set(s.date, (perDate.get(s.date) ?? 0) + 1));

  host.innerHTML = recent
    .map((s) => {
      const setCount = s.exercises.reduce((n, ex) => n + ex.sets.length, 0);
      const label = `${s.exercises.length} exercise${s.exercises.length === 1 ? "" : "s"} · ${setCount} set${setCount === 1 ? "" : "s"}`;
      const when =
        (perDate.get(s.date) ?? 0) > 1 ? `${esc(s.date)} · ${esc(timeLabel(s.createdAt))}` : esc(s.date);
      return `
      <div class="row recent-item" data-open="${s.id}">
        <div class="grow">
          <strong>${esc(s.title ?? "Workout")}</strong> ${s.completed ? "✅" : ""}
          <div class="muted small">${when} · ${label}</div>
        </div>
        <button class="iconbtn danger" data-del-session="${s.id}" title="Delete this workout">🗑</button>
      </div>`;
    })
    .join("");

  host.querySelectorAll<HTMLElement>("[data-open]").forEach((el) =>
    el.addEventListener("click", (e) => {
      if ((e.target as HTMLElement).closest("[data-del-session]")) return; // ignore delete clicks
      openSessionById(root, el.dataset.open!);
    }),
  );
  host.querySelectorAll<HTMLElement>("[data-del-session]").forEach((el) =>
    el.addEventListener("click", async () => {
      const s = recent.find((x) => x.id === el.dataset.delSession)!;
      if (!confirm(`Delete the "${s.title ?? "Workout"}" on ${s.date}? All its logged sets will be lost.`)) return;
      try {
        await api.del(`/api/sessions/${s.id}`);
        paintRecent(root);
      } catch {
        alert("Couldn’t delete (are you online?).");
      }
    }),
  );
}

function paintSession(root: HTMLElement) {
  const s = current!;
  root.innerHTML = `
    <div class="card">
      <div class="row">
        <div class="grow">
          <strong>${esc(s.title ?? "Workout")}</strong>
          <div class="muted small">${esc(s.date)} · ${esc(timeLabel(s.createdAt))}${
            s.routineId ? " · prefilled from last time" : ""
          }</div>
        </div>
        <button class="link-btn" id="change">Change</button>
      </div>
      <label class="check"><input type="checkbox" id="completed" ${s.completed ? "checked" : ""}/> Completed</label>
      <div class="row two">
        <button class="link-btn" id="another">+ Start another (same day)</button>
        <button class="link-btn danger" id="del-session">Delete this workout</button>
      </div>
    </div>

    <details class="card"><summary>Daily metrics</summary>
      <div class="two">
        ${metricInput("bodyWeight", "Weight (lbs)", s.bodyWeight)}
        ${metricInput("sleepHours", "Sleep (hrs)", s.sleepHours)}
      </div>
      <div class="two">
        ${metricInput("bodyFat", "Body fat (%)", s.bodyFat)}
        ${metricInput("muscleMass", "Muscle mass (lbs)", s.muscleMass)}
      </div>
      <div class="two">
        ${metricInput("energy", "Energy 1–10", s.energy)}
        ${metricInput("mood", "Mood 1–10", s.mood)}
      </div>
    </details>

    <details class="card" id="food-card"><summary>Food</summary>
      ${foodDatalist()}
      <div id="food-body"><p class="muted small">Open to load…</p></div>
    </details>

    <div id="exercises">${s.exercises.map(exerciseCard).join("")}</div>

    <div class="card">
      <div class="row add-ex">
        <select id="add-ex-pick" class="grow">
          <option value="">— add an exercise —</option>
          ${library
            .filter((e) => !e.archived)
            .map((e) => `<option value="${e.id}">${esc(e.name)}</option>`)
            .join("")}
          <option value="__new__">+ New exercise…</option>
        </select>
        <button class="ghost" id="add-ex-go">Add</button>
      </div>
    </div>

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
        <button class="iconbtn danger" data-rmex title="Remove exercise from this workout">🗑</button>
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

  // Food card: load the day's meals the first time it's expanded.
  const foodCard = root.querySelector<HTMLDetailsElement>("#food-card");
  let foodLoaded = false;
  foodCard?.addEventListener("toggle", () => {
    if (foodCard.open && !foodLoaded) {
      foodLoaded = true;
      renderFood(root.querySelector<HTMLElement>("#food-body")!, s.date);
    }
  });

  root.querySelector("#change")!.addEventListener("click", () => paintPicker(root));

  root.querySelector("#del-session")!.addEventListener("click", async () => {
    if (
      !confirm(
        `Delete the "${s.title ?? "Workout"}" on ${s.date}? All its logged sets will be lost.`,
      )
    )
      return;
    try {
      await api.del(`/api/sessions/${s.id}`);
      current = null;
      paintPicker(root);
    } catch {
      alert("Couldn’t delete (are you online?).");
    }
  });

  // Start another workout on the same day (same routine), even though one exists.
  root.querySelector("#another")!.addEventListener("click", () => {
    loadSession(root, s.date, s.routineId, true);
  });

  root.querySelector<HTMLInputElement>("#completed")!.addEventListener("change", (e) =>
    patchSession({ completed: (e.target as HTMLInputElement).checked }),
  );

  // Daily metrics
  root.querySelectorAll<HTMLElement>("[data-metric]").forEach((el) =>
    el.addEventListener("change", () => {
      const field = el.dataset.metric!;
      const raw = (el as HTMLInputElement).value;
      patchSession({ [field]: raw === "" ? null : Number(raw) });
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
      mutate("PATCH", `/api/session-exercises/${sxId}`, { rpe: v === "" ? null : Number(v) });
    });

    cardEl.querySelectorAll<HTMLElement>(".setrow").forEach((rowEl) => wireSetRow(rowEl));

    cardEl.querySelector("[data-addset]")!.addEventListener("click", () => {
      const sx = s.exercises.find((x) => x.id === sxId)!;
      // Client-generated id keeps the set stable for optimistic UI + replay.
      const id = crypto.randomUUID();
      sx.sets.push({
        id,
        setNumber: sx.sets.length + 1,
        weight: null,
        reps: null,
        rpe: null,
        isWarmup: false,
        completed: false,
      });
      mutate("POST", `/api/session-exercises/${sxId}/sets`, { id, weight: null, reps: null });
      cacheCurrent();
      paintSession(root);
    });

    cardEl.querySelector("[data-bump]")!.addEventListener("click", () => {
      const sx = s.exercises.find((x) => x.id === sxId)!;
      const step = exStep(exId);
      sx.sets.forEach((set) => {
        set.weight = (set.weight ?? 0) + step;
        mutate("PATCH", `/api/sets/${set.id}`, { weight: set.weight });
      });
      cacheCurrent();
      paintSession(root);
    });

    cardEl.querySelector("[data-rmex]")!.addEventListener("click", () => {
      const sx = s.exercises.find((x) => x.id === sxId)!;
      // Only confirm if you've actually logged work (a completed set). Untouched
      // or merely prefilled exercises remove instantly so skipping is friction-free.
      const logged = sx.sets.some((set) => set.completed);
      if (
        logged &&
        !confirm(
          `Remove "${exName(exId)}" from this workout? Its logged sets today will be discarded. (Your routine isn’t changed.)`,
        )
      )
        return;
      s.exercises = s.exercises.filter((x) => x.id !== sxId);
      mutate("DELETE", `/api/session-exercises/${sxId}`);
      cacheCurrent();
      paintSession(root);
    });
  });

  wireAddExercise(root);
  wireRun(root);
}

// "+ Add an exercise" control below the exercise list. Picks from the library
// or creates a new one inline; the server prefills via the progression engine.
function wireAddExercise(root: HTMLElement) {
  const pick = root.querySelector<HTMLSelectElement>("#add-ex-pick");
  const go = root.querySelector<HTMLButtonElement>("#add-ex-go");
  if (!pick || !go) return;

  go.addEventListener("click", async () => {
    const choice = pick.value;
    if (!choice) return;

    let body: { exerciseId?: string; name?: string };
    if (choice === "__new__") {
      const name = prompt("New exercise name:")?.trim();
      if (!name) return;
      body = { name };
    } else {
      body = { exerciseId: choice };
    }

    go.disabled = true;
    try {
      // Need the server's progression prefill + any newly-created exercise id,
      // so this one goes through the API directly (online action).
      const updated = await api.post<Session>(`/api/sessions/${current!.id}/exercises`, body);
      current = updated;
      // Refresh the library so a newly-created exercise resolves to a name.
      library = await api.get<Exercise[]>("/api/exercises");
      cacheSet("exercises", library);
      cacheCurrent();
      paintSession(root);
    } catch (e) {
      go.disabled = false;
      alert((e as Error).message || "Couldn’t add exercise (are you online?)");
    }
  });
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
      mutate("PATCH", `/api/sets/${setId}`, { [f]: v });
      cacheCurrent();
    }),
  );

  rowEl.querySelector("[data-done]")!.addEventListener("click", () => {
    set.completed = !set.completed;
    rowEl.querySelector("[data-done]")!.classList.toggle("on", set.completed);
    mutate("PATCH", `/api/sets/${setId}`, { completed: set.completed });
    cacheCurrent();
  });

  rowEl.querySelector("[data-rmset]")!.addEventListener("click", () => {
    mutate("DELETE", `/api/sets/${setId}`);
    sx.sets = sx.sets.filter((st) => st.id !== setId);
    rowEl.remove();
    cacheCurrent();
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
    mutate("PUT", `/api/sessions/${current!.id}/run`, {
      distanceMi: dist.value === "" ? null : Number(dist.value),
      durationSec: parseMmss(time.value),
      effort: effort.value === "" ? null : Number(effort.value),
      runType: type.value || null,
    });
  }
  [dist, time, effort, type].forEach((el) => el.addEventListener("change", save));
  showPace();
}

function patchSession(patch: Record<string, unknown>) {
  Object.assign(current!, patch);
  cacheCurrent();
  mutate("PATCH", `/api/sessions/${current!.id}`, patch);
}

// Snapshot the live session so an offline reload restores latest edits.
function cacheCurrent() {
  if (current) cacheSet(`session:${current.date}:${current.routineId ?? ""}`, current);
}
