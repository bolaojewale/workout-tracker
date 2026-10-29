// Exercise library screen: list (favorites first), add, edit, favorite toggle,
// archive, and merging duplicates. Talks to /api/exercises.
import { api } from "../api";
import { esc } from "../util";
import type { Exercise } from "../../../shared/types";

// Every exercise including archived ones (archived duplicates still own
// history, so they must be mergeable too). `cache` is the visible subset.
let all: Exercise[] = [];
let cache: Exercise[] = [];

export async function renderExercises(root: HTMLElement) {
  root.innerHTML = `<div class="card"><p class="muted">Loading…</p></div>`;
  try {
    all = await api.get<Exercise[]>("/api/exercises?archived=1");
    cache = all.filter((e) => !e.archived);
  } catch {
    root.innerHTML = `<div class="card"><p class="error">Couldn’t load exercises.</p></div>`;
    return;
  }
  paint(root);
}

// "Barbell Bench-Press " and "barbell bench press" are the same exercise.
const normName = (n: string) =>
  n
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

// Groups of 2+ exercises whose names match after normalisation.
function duplicateGroups(): Exercise[][] {
  const byName = new Map<string, Exercise[]>();
  for (const e of all) {
    const k = normName(e.name);
    if (!k) continue;
    byName.set(k, [...(byName.get(k) ?? []), e]);
  }
  return [...byName.values()]
    .filter((g) => g.length > 1)
    .map((g) => g.sort(byUsage));
}

// Most-used first, then favourites, then active over archived.
function byUsage(a: Exercise, b: Exercise) {
  return (
    (b.sessionCount ?? 0) - (a.sessionCount ?? 0) ||
    Number(b.isFavorite) - Number(a.isFavorite) ||
    Number(a.archived) - Number(b.archived)
  );
}

const usageLabel = (e: Exercise) => {
  const n = e.sessionCount ?? 0;
  const parts = [`${n} workout${n === 1 ? "" : "s"}`];
  if (e.isFavorite) parts.push("★ favorite");
  if (e.archived) parts.push("archived");
  return parts.join(" · ");
};

function duplicatesCard(groups: Exercise[][]): string {
  if (!groups.length) return "";
  return `
    <div class="card dupes">
      <h2>Duplicates found</h2>
      <p class="muted small">Pick which copy to keep. Its history, routines, and check-ins from the other copies move over, then the copies are deleted.</p>
      ${groups
        .map(
          (g, gi) => `
        <div class="dupe-group" data-group="${gi}">
          ${g
            .map(
              (e, i) => `
            <label class="check dupe-row">
              <input type="radio" name="keep-${gi}" value="${e.id}" ${i === 0 ? "checked" : ""} />
              <span class="grow">
                <strong>${esc(e.name)}</strong>
                <span class="muted small block">${esc(usageLabel(e))}</span>
              </span>
            </label>`,
            )
            .join("")}
          <button class="ghost" data-merge-group="${gi}">Keep selected, merge ${g.length - 1} other${g.length === 2 ? "" : "s"} into it</button>
        </div>`,
        )
        .join("")}
    </div>`;
}

async function mergeInto(root: HTMLElement, keep: Exercise, remove: Exercise[]) {
  const names = remove.map((e) => `“${e.name}”`).join(", ");
  if (!confirm(`Merge ${names} into “${keep.name}”? All their logged sets move to “${keep.name}” and the duplicates are deleted. This can’t be undone.`)) return;
  try {
    await api.post("/api/exercises/merge", { keepId: keep.id, removeIds: remove.map((e) => e.id) });
    renderExercises(root);
  } catch (e) {
    alert((e as Error).message || "Couldn’t merge (are you online?)");
  }
}

function paint(root: HTMLElement) {
  const groups = duplicateGroups();
  root.innerHTML = `
    <div class="card">
      <button id="add-ex" class="primary">+ Add exercise</button>
    </div>
    ${duplicatesCard(groups)}
    <div id="ex-list">
      ${cache.map(card).join("") || `<p class="muted">No exercises yet.</p>`}
    </div>`;

  root.querySelector("#add-ex")!.addEventListener("click", () => openForm(root, null));
  root.querySelectorAll<HTMLElement>("[data-merge-group]").forEach((btn) =>
    btn.addEventListener("click", () => {
      const gi = Number(btn.dataset.mergeGroup);
      const group = groups[gi];
      const keepId = root.querySelector<HTMLInputElement>(`input[name="keep-${gi}"]:checked`)?.value;
      const keep = group.find((e) => e.id === keepId);
      if (!keep) return;
      mergeInto(root, keep, group.filter((e) => e.id !== keep.id));
    }),
  );
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
    </div>
    ${
      editing
        ? `<div class="card">
      <h2>Merge into another exercise</h2>
      <p class="muted small">Use this when the same lift exists under two different names. This exercise's ${
        ex!.sessionCount ?? 0
      } logged workout${(ex!.sessionCount ?? 0) === 1 ? "" : "s"}, routines, and check-ins move to the one you pick, then this one is deleted.</p>
      <div class="row">
        <select id="merge-target" class="grow">
          <option value="">— pick the exercise to keep —</option>
          ${all
            .filter((o) => o.id !== ex!.id)
            .sort((a, b) => a.name.localeCompare(b.name))
            .map((o) => `<option value="${o.id}">${esc(o.name)}${o.archived ? " (archived)" : ""}</option>`)
            .join("")}
        </select>
        <button type="button" class="ghost" id="merge-go" disabled>Merge</button>
      </div>
    </div>`
        : ""
    }`;

  const form = root.querySelector<HTMLFormElement>("#ex-form")!;
  const err = root.querySelector<HTMLElement>("#ex-err")!;
  root.querySelector("#cancel")!.addEventListener("click", () => renderExercises(root));
  root.querySelector("#archive")?.addEventListener("click", async () => {
    if (!confirm("Archive this exercise? History is kept.")) return;
    await api.del(`/api/exercises/${ex!.id}`);
    renderExercises(root);
  });

  // Merge this exercise into another one (different-name duplicates).
  const target = root.querySelector<HTMLSelectElement>("#merge-target");
  const mergeGo = root.querySelector<HTMLButtonElement>("#merge-go");
  target?.addEventListener("change", () => (mergeGo!.disabled = !target.value));
  mergeGo?.addEventListener("click", () => {
    const keep = all.find((o) => o.id === target!.value);
    if (keep) mergeInto(root, keep, [ex!]);
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
