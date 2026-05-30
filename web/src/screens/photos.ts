// Progress photo gallery + uploader for a monthly check-in. Photos require a
// network connection (R2), so this isn't part of the offline path.
import { api } from "../api";

interface PhotoMeta {
  id: string;
  angle: string | null;
  takenAt: number;
  url: string;
}

const ANGLES = ["front", "side", "back"] as const;

// Render the photos section into `host` for a saved check-in.
export async function renderPhotos(host: HTMLElement, checkinId: string) {
  host.innerHTML = `<p class="muted small">Loading photos…</p>`;
  let list: PhotoMeta[] = [];
  try {
    list = await api.get<PhotoMeta[]>(`/api/photos/checkin/${checkinId}`);
  } catch {
    host.innerHTML = `<p class="muted small">Photos need a connection.</p>`;
    return;
  }

  const grid = list
    .map(
      (p) => `
      <div class="photo" data-photo="${p.id}">
        <img src="${p.url}" alt="${p.angle ?? "progress"} photo" loading="lazy" />
        <span class="photo-angle">${p.angle ?? ""}</span>
        <button class="iconbtn danger photo-del" data-del="${p.id}" title="Delete">✕</button>
      </div>`,
    )
    .join("");

  host.innerHTML = `
    <div class="photo-grid">${grid || `<p class="muted small">No photos yet.</p>`}</div>
    <div class="row add-ex">
      <select id="photo-angle" class="grow">
        ${ANGLES.map((a) => `<option value="${a}">${a}</option>`).join("")}
      </select>
      <label class="ghost photo-upload">
        + Add photo
        <input id="photo-file" type="file" accept="image/*" capture="environment" hidden />
      </label>
    </div>
    <p class="muted small" id="photo-status">Same lighting & pose each month for honest comparisons.</p>`;

  const fileInput = host.querySelector<HTMLInputElement>("#photo-file")!;
  const angleSel = host.querySelector<HTMLSelectElement>("#photo-angle")!;
  const status = host.querySelector<HTMLElement>("#photo-status")!;

  fileInput.addEventListener("change", async () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    status.textContent = "Uploading…";
    try {
      const res = await fetch(
        `/api/photos?checkinId=${encodeURIComponent(checkinId)}&angle=${angleSel.value}`,
        {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": file.type },
          body: file,
        },
      );
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? "upload failed");
      }
      renderPhotos(host, checkinId); // refresh
    } catch (e) {
      status.textContent = (e as Error).message;
    }
  });

  host.querySelectorAll<HTMLElement>("[data-del]").forEach((b) =>
    b.addEventListener("click", async () => {
      if (!confirm("Delete this photo?")) return;
      await api.del(`/api/photos/${b.dataset.del}`);
      renderPhotos(host, checkinId);
    }),
  );
}
