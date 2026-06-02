// Day-level Food card: log meals (pick from the Meals library or custom), with
// per-meal macros, auto-calculated calories, and protein-vs-goal. Mounted into
// the Today session view but data is keyed by DATE, not session.
import { api } from "../api";
import { mutate } from "../sync";
import { esc } from "../util";
import { macroCalories, type Meal, type MealLogEntry } from "../../../shared/types";

let entries: MealLogEntry[] = [];
let library: Meal[] = [];
let proteinGoal: number | null = null;
let theDate = "";

// Render the Food card body for a given date into `host`.
export async function renderFood(host: HTMLElement, date: string) {
  theDate = date;
  try {
    [entries, library, proteinGoal] = await Promise.all([
      api.get<MealLogEntry[]>(`/api/meal-log?date=${date}`),
      api.get<Meal[]>("/api/meals"),
      api.get<{ proteinGoal: number | null }>("/api/me").then((m) => m.proteinGoal),
    ]);
  } catch {
    host.innerHTML = `<p class="muted small">Food needs a connection the first time.</p>`;
    return;
  }
  // Always show at least one empty bar to start.
  if (entries.length === 0) {
    await addEntry({ name: "" });
  }
  paint(host);
}

function totals() {
  const p = entries.reduce((n, e) => n + e.protein, 0);
  const c = entries.reduce((n, e) => n + e.carbs, 0);
  const f = entries.reduce((n, e) => n + e.fat, 0);
  return { p, c, f, kcal: macroCalories(p, c, f) };
}

function paint(host: HTMLElement) {
  const t = totals();
  const goalLine =
    proteinGoal != null
      ? `<span class="${t.p >= proteinGoal ? "up" : "muted"}">${Math.round(t.p)}/${proteinGoal}g protein ${
          t.p >= proteinGoal ? "✓" : ""
        }</span>`
      : `<span class="muted">${Math.round(t.p)}g protein</span>`;

  host.innerHTML = `
    <div class="food-totals">
      <strong>${t.kcal} kcal</strong>
      <span class="muted small">P ${Math.round(t.p)} · C ${Math.round(t.c)} · F ${Math.round(t.f)}</span>
      <div class="small">${goalLine}</div>
    </div>
    <div id="meal-bars">${entries.map(mealBar).join("")}</div>
    <button class="ghost" id="add-meal">+ Add meal</button>
    ${
      proteinGoal == null
        ? `<button class="link-btn" id="set-goal">Set a daily protein goal</button>`
        : `<button class="link-btn" id="set-goal">Protein goal: ${proteinGoal}g (edit)</button>`
    }`;

  host.querySelectorAll<HTMLElement>(".meal-bar").forEach((bar) => wireBar(host, bar));

  host.querySelector("#add-meal")!.addEventListener("click", async () => {
    await addEntry({ name: "" });
    paint(host);
  });

  host.querySelector("#set-goal")!.addEventListener("click", async () => {
    const val = prompt("Daily protein goal (grams):", proteinGoal != null ? String(proteinGoal) : "");
    if (val === null) return;
    const g = val.trim() === "" ? null : Number(val);
    proteinGoal = g;
    mutate("PATCH", "/api/me", { proteinGoal: g });
    paint(host);
  });
}

function mealBar(e: MealLogEntry): string {
  // A datalist lets you pick a saved meal by name or type a custom one.
  return `
    <div class="meal-bar" data-id="${e.id}">
      <input class="meal-name" list="meal-options" value="${esc(e.name)}" placeholder="Meal name" />
      <div class="macros">
        <input class="num" type="number" step="any" data-f="protein" value="${e.protein || ""}" placeholder="P" title="protein g" />
        <input class="num" type="number" step="any" data-f="carbs" value="${e.carbs || ""}" placeholder="C" title="carbs g" />
        <input class="num" type="number" step="any" data-f="fat" value="${e.fat || ""}" placeholder="F" title="fat g" />
        <button class="iconbtn danger" data-rm title="Remove meal">✕</button>
      </div>
    </div>`;
}

// Shared datalist of saved meals (rendered once near the bars).
function datalist(): string {
  return `<datalist id="meal-options">${library
    .map((m) => `<option value="${esc(m.name)}"></option>`)
    .join("")}</datalist>`;
}

function wireBar(host: HTMLElement, bar: HTMLElement) {
  const id = bar.dataset.id!;
  const entry = entries.find((e) => e.id === id)!;
  const nameInput = bar.querySelector<HTMLInputElement>(".meal-name")!;

  // Pick from library when the typed name matches a saved meal: autofill macros.
  nameInput.addEventListener("change", () => {
    entry.name = nameInput.value.trim();
    const match = library.find((m) => m.name.toLowerCase() === entry.name.toLowerCase());
    if (match) {
      entry.protein = match.protein;
      entry.carbs = match.carbs;
      entry.fat = match.fat;
      entry.mealId = match.id;
      mutate("PATCH", `/api/meal-log/${id}`, {
        name: entry.name,
        protein: entry.protein,
        carbs: entry.carbs,
        fat: entry.fat,
      });
      paint(host); // re-render to show autofilled macros + totals
    } else {
      mutate("PATCH", `/api/meal-log/${id}`, { name: entry.name });
    }
  });

  bar.querySelectorAll<HTMLInputElement>("input[data-f]").forEach((inp) =>
    inp.addEventListener("change", () => {
      const f = inp.dataset.f as "protein" | "carbs" | "fat";
      entry[f] = inp.value === "" ? 0 : Number(inp.value);
      mutate("PATCH", `/api/meal-log/${id}`, { [f]: entry[f] });
      updateTotals(host);
    }),
  );

  bar.querySelector("[data-rm]")!.addEventListener("click", async () => {
    entries = entries.filter((e) => e.id !== id);
    mutate("DELETE", `/api/meal-log/${id}`);
    paint(host);
  });
}

// Light-touch totals refresh without re-rendering inputs you're typing in.
function updateTotals(host: HTMLElement) {
  const t = totals();
  const tot = host.querySelector(".food-totals");
  if (tot) {
    const goalLine =
      proteinGoal != null
        ? `<span class="${t.p >= proteinGoal ? "up" : "muted"}">${Math.round(t.p)}/${proteinGoal}g protein ${
            t.p >= proteinGoal ? "✓" : ""
          }</span>`
        : `<span class="muted">${Math.round(t.p)}g protein</span>`;
    tot.innerHTML = `<strong>${t.kcal} kcal</strong>
      <span class="muted small">P ${Math.round(t.p)} · C ${Math.round(t.c)} · F ${Math.round(t.f)}</span>
      <div class="small">${goalLine}</div>`;
  }
}

// Create a meal-log entry (optimistic, offline-capable via client id).
async function addEntry(seed: Partial<MealLogEntry>) {
  const id = crypto.randomUUID();
  const e: MealLogEntry = {
    id,
    date: theDate,
    mealId: seed.mealId ?? null,
    name: seed.name ?? "",
    protein: seed.protein ?? 0,
    carbs: seed.carbs ?? 0,
    fat: seed.fat ?? 0,
    position: entries.length,
  };
  entries.push(e);
  mutate("POST", "/api/meal-log", {
    id,
    date: theDate,
    name: e.name,
    protein: e.protein,
    carbs: e.carbs,
    fat: e.fat,
    mealId: e.mealId,
  });
}

// Inject the shared datalist once when the card first renders.
export function foodDatalist(): string {
  return datalist();
}
