// Routines screen: list templates, create/edit (pick exercises from the
// library, set target sets/reps, reorder, remove). Talks to /api/routines.
import { api } from "../api";
import { esc } from "../util";
import type { Exercise, Routine } from "../../../shared/types";

interface DraftItem {
  exerciseId: string;
  targetSets: number;
  targetReps: number | null;
}

let routines: Routine[] = [];
let library: Exercise[] = [];

export async function renderRoutines(root: HTMLElement) {
  root.innerHTML = `<div class="card"><p class="muted">Loading…</p></div>`;
  try {
    [routines, library] = await Promise.all([
      api.get<Routine[]>("/api/routines"),
      api.get<Exercise[]>("/api/exercises"),
    ]);
  } catch {
    root.innerHTML = `<div class="card"><p class="error">Couldn’t load routines.</p></div>`;
    return;
  }
  paintList(root);
}

function exName(id: string): string {
  return library.find((e) => e.id === id)?.name ?? "(removed exercise)";
}

function paintList(root: HTMLElement) {
  root.innerHTML = `
    <div class="card"><button id="add" class="primary">+ New routine</button></div>
    ${
      routines.length
        ? routines.map(routineCard).join("")
        : `<p class="muted">No routines yet. Create one like “Push A”.</p>`
    }`;
  root.querySelector("#add")!.addEventListener("click", () => paintForm(root, null));
  root.querySelectorAll<HTMLElement>("[data-edit]").forEach((el) =>
    el.addEventListener("click", () =>
      paintForm(root, routines.find((r) => r.id === el.dataset.edit) ?? null),
    ),
  );
}

function routineCard(r: Routine): string {
  const items = r.exercises
    .map(
      (e) =>
        `<li>${esc(exName(e.exerciseId))} <span class="muted small">${e.targetSets}×${
          e.targetReps ?? "—"
        }</span></li>`,
    )
    .join("");
  return `
    <div class="card">
      <div class="row">
        <strong class="grow">${esc(r.name)}</strong>
        <button class="link-btn" data-edit="${r.id}">Edit</button>
      </div>
      ${r.notes ? `<p class="muted small">${esc(r.notes)}</p>` : ""}
      <ul class="tight">${items || `<li class="muted">No exercises</li>`}</ul>
    </div>`;
}

function paintForm(root: HTMLElement, routine: Routine | null) {
  const editing = !!routine;
  let name = routine?.name ?? "";
  let notes = routine?.notes ?? "";
  const draft: DraftItem[] = (routine?.exercises ?? []).map((e) => ({
    exerciseId: e.exerciseId,
    targetSets: e.targetSets,
    targetReps: e.targetReps,
  }));

  function render() {
    const options = library
      .filter((e) => !e.archived)
      .map((e) => `<option value="${e.id}">${esc(e.name)}</option>`)
      .join("");
    root.innerHTML = `
      <div class="card">
        <h2>${editing ? "Edit routine" : "New routine"}</h2>
        <label class="stack">Name<input id="r-name" value="${esc(name)}" /></label>
        <label class="stack">Notes <span class="muted">(optional)</span>
          <input id="r-notes" value="${esc(notes)}" /></label>
      </div>
      <div class="card">
        <h2>Exercises</h2>
        <div id="items">${draft.map(itemRow).join("") || `<p class="muted">None yet.</p>`}</div>
        <div class="row add-ex">
          <select id="pick" class="grow">${options}</select>
          <button id="add-item" class="ghost">Add</button>
        </div>
      </div>
      <div class="card">
        <p class="error" id="r-err" hidden></p>
        <div class="two">
          <button id="cancel" class="ghost">Cancel</button>
          <button id="save" class="primary">${editing ? "Save" : "Create"}</button>
        </div>
        ${editing ? `<button id="archive" class="link-btn danger">Archive routine</button>` : ""}
      </div>`;
    wire();
  }

  function itemRow(it: DraftItem, i: number): string {
    return `
      <div class="row item" data-i="${i}">
        <div class="grow"><strong>${esc(exName(it.exerciseId))}</strong></div>
        <input class="num" type="number" min="1" value="${it.targetSets}" data-f="targetSets" title="sets" />
        <span class="muted">×</span>
        <input class="num" type="number" min="0" value="${it.targetReps ?? ""}" data-f="targetReps" placeholder="reps" title="target reps" />
        <button class="iconbtn" data-up="${i}" ${i === 0 ? "disabled" : ""}>↑</button>
        <button class="iconbtn" data-down="${i}" ${i === draft.length - 1 ? "disabled" : ""}>↓</button>
        <button class="iconbtn danger" data-rm="${i}">✕</button>
      </div>`;
  }

  function wire() {
    const q = <T extends HTMLElement>(s: string) => root.querySelector<T>(s)!;
    q<HTMLInputElement>("#r-name").addEventListener("input", (e) => (name = (e.target as HTMLInputElement).value));
    q<HTMLInputElement>("#r-notes").addEventListener("input", (e) => (notes = (e.target as HTMLInputElement).value));

    q("#add-item").addEventListener("click", () => {
      const id = q<HTMLSelectElement>("#pick").value;
      const ex = library.find((e) => e.id === id);
      if (!ex) return;
      draft.push({ exerciseId: id, targetSets: ex.defaultSets, targetReps: null });
      render();
    });

    root.querySelectorAll<HTMLInputElement>(".item input[data-f]").forEach((inp) =>
      inp.addEventListener("input", () => {
        const i = Number((inp.closest(".item") as HTMLElement).dataset.i);
        const f = inp.dataset.f as "targetSets" | "targetReps";
        if (f === "targetSets") draft[i].targetSets = Number(inp.value) || 1;
        else draft[i].targetReps = inp.value === "" ? null : Number(inp.value);
      }),
    );
    root.querySelectorAll<HTMLElement>("[data-up]").forEach((b) =>
      b.addEventListener("click", () => move(Number(b.dataset.up), -1)),
    );
    root.querySelectorAll<HTMLElement>("[data-down]").forEach((b) =>
      b.addEventListener("click", () => move(Number(b.dataset.down), 1)),
    );
    root.querySelectorAll<HTMLElement>("[data-rm]").forEach((b) =>
      b.addEventListener("click", () => {
        draft.splice(Number(b.dataset.rm), 1);
        render();
      }),
    );

    q("#cancel").addEventListener("click", () => renderRoutines(root));
    q("#archive")?.addEventListener("click", async () => {
      if (!confirm("Archive this routine?")) return;
      await api.del(`/api/routines/${routine!.id}`);
      renderRoutines(root);
    });
    q("#save").addEventListener("click", save);
  }

  function move(i: number, dir: number) {
    const j = i + dir;
    if (j < 0 || j >= draft.length) return;
    [draft[i], draft[j]] = [draft[j], draft[i]];
    render();
  }

  async function save() {
    const err = root.querySelector<HTMLElement>("#r-err")!;
    err.hidden = true;
    const payload = { name, notes: notes || null, exercises: draft };
    try {
      if (editing) await api.patch(`/api/routines/${routine!.id}`, payload);
      else await api.post("/api/routines", payload);
      renderRoutines(root);
    } catch (e) {
      err.textContent = (e as Error).message;
      err.hidden = false;
    }
  }

  render();
}
