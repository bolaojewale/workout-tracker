// Exercise library screen: list (favorites first), add, edit, favorite toggle,
// archive. Talks to /api/exercises.
import { api } from "../api";
import { esc } from "../util";
import type { Exercise } from "../../../shared/types";

let cache: Exercise[] = [];

export async function renderExercises(root: HTMLElement) {
  root.innerHTML = `<div class="card"><p class="muted">Loading…</p></div>`;
  try {
    cache = await api.get<Exercise[]>("/api/exercises");
  } catch {
    root.innerHTML = `<div class="card"><p class="error">Couldn’t load exercises.</p></div>`;
    return;
  }
  paint(root);
}

function paint(root: HTMLElement) {
  root.innerHTML = `
    <div class="card">
      <button id="add-ex" class="primary">+ Add exercise</button>
    </div>
    <div id="ex-list">
      ${cache.map(card).join("") || `<p class="muted">No exercises yet.</p>`}
    </div>`;

  root.querySelector("#add-ex")!.addEventListener("click", () => openForm(root, null));
  root.querySelectorAll<HTMLElement>("[data-edit]").forEach((el) =>
    el.addEventListener("click", () =>
      openForm(root, cache.find((e) => e.id === el.dataset.edit) ?? null),
    ),
  );
  root.querySelectorAll<HTMLElement>("[data-fav]").forEach((el) =>
    el.addEventListener("click", async () => {
      const ex = cache.find((e) => e.id === el.dataset.fav)!;
      const updated = await api.patch<Exercise>(`/api/exercises/${ex.id}`, {
        isFavorite: !ex.isFavorite,
      });
      Object.assign(ex, updated);
      cache.sort(byFavThenName);
      paint(root);
    }),
  );
}

function byFavThenName(a: Exercise, b: Exercise) {
  return Number(b.isFavorite) - Number(a.isFavorite) || a.name.localeCompare(b.name);
}

function card(e: Exercise): string {
  const meta = [
    e.kind,
    e.muscleGroup,
    e.kind === "lift" ? `+${e.progressionStep} ${e.unit}/step` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  return `
    <div class="card row">
      <button class="star ${e.isFavorite ? "on" : ""}" data-fav="${e.id}"
        title="Toggle favorite">★</button>
      <div class="grow">
        <strong>${esc(e.name)}</strong>
        <div class="muted small">${esc(meta)}</div>
      </div>
      <button class="link-btn" data-edit="${e.id}">Edit</button>
    </div>`;
}

function openForm(root: HTMLElement, ex: Exercise | null) {
  const editing = !!ex;
  const e: Partial<Exercise> = ex ?? {
    kind: "lift",
    defaultSets: 3,
    unit: "lbs",
    progressionStep: 5,
    isFavorite: false,
  };
  root.innerHTML = `
    <div class="card">
      <h2>${editing ? "Edit exercise" : "New exercise"}</h2>
      <form id="ex-form" class="stack">
        <label>Name<input name="name" required value="${esc(e.name ?? "")}" /></label>
        <label>Type
          <select name="kind">
            <option value="lift" ${e.kind === "lift" ? "selected" : ""}>Lift</option>
            <option value="cardio" ${e.kind === "cardio" ? "selected" : ""}>Cardio</option>
          </select>
        </label>
        <label>Muscle group <span class="muted">(optional)</span>
          <input name="muscleGroup" value="${esc(e.muscleGroup ?? "")}" /></label>
        <div class="two">
          <label>Default sets<input name="defaultSets" type="number" min="1" value="${e.defaultSets ?? 3}" /></label>
          <label>Unit<input name="unit" value="${esc(e.unit ?? "lbs")}" /></label>
        </div>
        <label>Progression step (${esc(e.unit ?? "lbs")})
          <input name="progressionStep" type="number" step="0.5" value="${e.progressionStep ?? 5}" /></label>
        <label class="check"><input name="isFavorite" type="checkbox" ${e.isFavorite ? "checked" : ""} /> Favorite (show on dashboard)</label>
        <p class="error" id="ex-err" hidden></p>
        <div class="two">
          <button type="button" class="ghost" id="cancel">Cancel</button>
          <button type="submit" class="primary">${editing ? "Save" : "Create"}</button>
        </div>
        ${editing ? `<button type="button" class="link-btn danger" id="archive">Archive exercise</button>` : ""}
      </form>
    </div>`;

  const form = root.querySelector<HTMLFormElement>("#ex-form")!;
  const err = root.querySelector<HTMLElement>("#ex-err")!;
  root.querySelector("#cancel")!.addEventListener("click", () => renderExercises(root));
  root.querySelector("#archive")?.addEventListener("click", async () => {
    if (!confirm("Archive this exercise? History is kept.")) return;
    await api.del(`/api/exercises/${ex!.id}`);
    renderExercises(root);
  });

  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    err.hidden = true;
    const fd = new FormData(form);
    const payload = {
      name: fd.get("name") as string,
      kind: fd.get("kind") as string,
      muscleGroup: (fd.get("muscleGroup") as string) || null,
      defaultSets: Number(fd.get("defaultSets")),
      unit: fd.get("unit") as string,
      progressionStep: Number(fd.get("progressionStep")),
      isFavorite: fd.get("isFavorite") === "on",
    };
    try {
      if (editing) await api.patch(`/api/exercises/${ex!.id}`, payload);
      else await api.post("/api/exercises", payload);
      renderExercises(root);
    } catch (e) {
      err.textContent = (e as Error).message;
      err.hidden = false;
    }
  });
}
