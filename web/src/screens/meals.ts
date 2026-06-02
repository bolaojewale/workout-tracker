// Meals library: reusable meals with set macros, like Routines but for food.
// e.g. "Chicken + Rice + Broccoli — 45g protein, 50g carbs, 8g fat".
import { api } from "../api";
import { esc } from "../util";
import { macroCalories, type Meal } from "../../../shared/types";

let meals: Meal[] = [];

export async function renderMeals(root: HTMLElement) {
  root.innerHTML = `<div class="card"><p class="muted">Loading…</p></div>`;
  try {
    meals = await api.get<Meal[]>("/api/meals");
  } catch {
    root.innerHTML = `<div class="card"><p class="error">Couldn’t load meals.</p></div>`;
    return;
  }
  paint(root);
}

function paint(root: HTMLElement) {
  root.innerHTML = `
    <div class="card"><button id="add" class="primary">+ Add meal</button></div>
    ${meals.length ? meals.map(card).join("") : `<p class="muted">No saved meals yet. Add one like “Chicken + Rice + Broccoli”.</p>`}`;
  root.querySelector("#add")!.addEventListener("click", () => openForm(root, null));
  root.querySelectorAll<HTMLElement>("[data-edit]").forEach((el) =>
    el.addEventListener("click", () => openForm(root, meals.find((m) => m.id === el.dataset.edit) ?? null)),
  );
}

function card(m: Meal): string {
  const kcal = macroCalories(m.protein, m.carbs, m.fat);
  return `
    <div class="card row">
      <div class="grow">
        <strong>${esc(m.name)}</strong>
        <div class="muted small">${m.protein}g protein · ${m.carbs}g carbs · ${m.fat}g fat · ${kcal} kcal</div>
      </div>
      <button class="link-btn" data-edit="${m.id}">Edit</button>
    </div>`;
}

function openForm(root: HTMLElement, meal: Meal | null) {
  const editing = !!meal;
  const m: Partial<Meal> = meal ?? { protein: 0, carbs: 0, fat: 0 };
  root.innerHTML = `
    <div class="card">
      <h2>${editing ? "Edit meal" : "New meal"}</h2>
      <form id="meal-form" class="stack">
        <label>Name<input name="name" required value="${esc(m.name ?? "")}" placeholder="Chicken + Rice + Broccoli" /></label>
        <div class="two">
          <label>Protein (g)<input name="protein" type="number" step="any" value="${m.protein ?? 0}" /></label>
          <label>Carbs (g)<input name="carbs" type="number" step="any" value="${m.carbs ?? 0}" /></label>
        </div>
        <label>Fat (g)<input name="fat" type="number" step="any" value="${m.fat ?? 0}" /></label>
        <p class="muted small" id="kcal"></p>
        <p class="error" id="meal-err" hidden></p>
        <div class="two">
          <button type="button" class="ghost" id="cancel">Cancel</button>
          <button type="submit" class="primary">${editing ? "Save" : "Create"}</button>
        </div>
        ${editing ? `<button type="button" class="link-btn danger" id="del">Delete meal</button>` : ""}
      </form>
    </div>`;

  const form = root.querySelector<HTMLFormElement>("#meal-form")!;
  const err = root.querySelector<HTMLElement>("#meal-err")!;
  const kcalEl = root.querySelector<HTMLElement>("#kcal")!;

  const showKcal = () => {
    const fd = new FormData(form);
    kcalEl.textContent = `${macroCalories(
      Number(fd.get("protein")) || 0,
      Number(fd.get("carbs")) || 0,
      Number(fd.get("fat")) || 0,
    )} kcal`;
  };
  showKcal();
  form.querySelectorAll("input[type=number]").forEach((i) => i.addEventListener("input", showKcal));

  root.querySelector("#cancel")!.addEventListener("click", () => renderMeals(root));
  root.querySelector("#del")?.addEventListener("click", async () => {
    if (!confirm("Delete this meal?")) return;
    await api.del(`/api/meals/${meal!.id}`);
    renderMeals(root);
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    err.hidden = true;
    const fd = new FormData(form);
    const payload = {
      name: fd.get("name") as string,
      protein: Number(fd.get("protein")) || 0,
      carbs: Number(fd.get("carbs")) || 0,
      fat: Number(fd.get("fat")) || 0,
    };
    try {
      if (editing) await api.patch(`/api/meals/${meal!.id}`, payload);
      else await api.post("/api/meals", payload);
      renderMeals(root);
    } catch (e2) {
      err.textContent = (e2 as Error).message;
      err.hidden = false;
    }
  });
}
