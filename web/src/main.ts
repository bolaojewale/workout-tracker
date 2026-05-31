// App shell + a tiny hash router, gated behind auth.
import { api, type AuthStatus } from "./api";
import { renderAuthGate, logout } from "./auth";
import { renderExercises } from "./screens/exercises";
import { renderRoutines } from "./screens/routines";
import { renderToday } from "./screens/today";
import { renderProgress } from "./screens/progress";
import { renderSummary } from "./screens/summary";
import { initSync, onPendingChange, onSaveStateChange, type SaveState } from "./sync";

let pending = 0;
let saveState: SaveState = "idle";

interface Route {
  path: string;
  label: string;
  icon: string;
  render: (root: HTMLElement) => void;
}


const routes: Route[] = [
  { path: "/today", label: "Today", icon: "🏋️", render: renderToday },
  { path: "/routines", label: "Routines", icon: "📋", render: renderRoutines },
  { path: "/exercises", label: "Exercises", icon: "💪", render: renderExercises },
  { path: "/progress", label: "Progress", icon: "📈", render: renderProgress },
  { path: "/summary", label: "Summary", icon: "📅", render: renderSummary },
];

function currentPath(): string {
  const hash = location.hash.replace(/^#/, "");
  return routes.some((r) => r.path === hash) ? hash : routes[0].path;
}

function renderApp() {
  const app = document.getElementById("app")!;
  const path = currentPath();
  const route = routes.find((r) => r.path === path)!;

  app.innerHTML = `
    <header class="app-bar">
      <h1>BJ Workout Tracker</h1>
      <span id="save" class="pill" hidden></span>
      <span id="net" class="pill">…</span>
      <button id="logout" class="link-btn" title="Log out">Log out</button>
    </header>
    <main id="screen"></main>
    <nav class="tabs">
      ${routes
        .map(
          (r) =>
            `<a href="#${r.path}" class="${r.path === path ? "active" : ""}">
               <span>${r.icon}</span>${r.label}
             </a>`,
        )
        .join("")}
    </nav>`;

  route.render(document.getElementById("screen")!);
  document.getElementById("logout")!.addEventListener("click", async () => {
    await logout();
    boot();
  });
  updateNet();
}

function updateNet() {
  const el = document.getElementById("net");
  if (!el) return;
  const online = navigator.onLine;
  if (pending > 0) {
    el.textContent = online ? `syncing ${pending}…` : `offline · ${pending} queued`;
    el.className = "pill";
  } else {
    el.textContent = online ? "online" : "offline";
    el.className = `pill ${online ? "online" : ""}`;
  }
  updateSave();
}

// Save-status pill: "Saving…" while a write is in flight/queued, "Saved ✓"
// briefly after it settles, hidden when idle (auto-save, so no button needed).
function updateSave() {
  const el = document.getElementById("save");
  if (!el) return;
  if (saveState === "saving") {
    el.textContent = "Saving…";
    el.className = "pill saving";
    el.hidden = false;
  } else if (saveState === "offline-queued") {
    el.textContent = "Will save when online";
    el.className = "pill";
    el.hidden = false;
  } else if (saveState === "saved") {
    el.textContent = "Saved ✓";
    el.className = "pill online";
    el.hidden = false;
  } else {
    el.hidden = true;
  }
}

async function boot() {
  const app = document.getElementById("app")!;
  let status: AuthStatus;
  try {
    status = await api.get<AuthStatus>("/api/auth/status");
  } catch {
    // Offline and not yet cached: assume we need to (re)auth when back online.
    status = { registered: true, authenticated: false };
  }

  if (status.authenticated) {
    renderApp();
  } else {
    app.innerHTML = `<header class="app-bar"><h1>BJ Workout Tracker</h1></header>
      <main id="screen"></main>`;
    renderAuthGate(document.getElementById("screen")!, status, boot);
  }
}

window.addEventListener("hashchange", () => {
  if (document.querySelector("nav.tabs")) renderApp();
});
window.addEventListener("online", updateNet);
window.addEventListener("offline", updateNet);

onPendingChange((n) => {
  pending = n;
  updateNet();
});
onSaveStateChange((state) => {
  saveState = state;
  updateSave();
});
initSync();
boot();

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {
      /* SW optional in dev */
    });
  });
}
