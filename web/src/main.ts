// App shell + a tiny hash router, gated behind auth. Screens are scaffolds for
// now; each step of the roadmap (DESIGN.md §10) fills them in.
import { api, type AuthStatus } from "./api";
import { renderAuthGate, logout } from "./auth";
import { renderExercises } from "./screens/exercises";
import { renderRoutines } from "./screens/routines";
import { renderToday } from "./screens/today";

interface Route {
  path: string;
  label: string;
  icon: string;
  render: (root: HTMLElement) => void;
}

function placeholder(title: string, blurb: string) {
  return (root: HTMLElement) => {
    root.innerHTML = `
      <div class="card">
        <h2>${title}</h2>
        <p class="muted">${blurb}</p>
      </div>`;
  };
}

const routes: Route[] = [
  { path: "/today", label: "Today", icon: "🏋️", render: renderToday },
  { path: "/routines", label: "Routines", icon: "📋", render: renderRoutines },
  { path: "/exercises", label: "Exercises", icon: "💪", render: renderExercises },
  { path: "/progress", label: "Progress", icon: "📈",
    render: placeholder("Progress", "Per-exercise strength, bodyweight, volume, and running pace trends.") },
  { path: "/summary", label: "Summary", icon: "📅",
    render: placeholder("Summaries", "Weekly and monthly summaries, laid out like your paper sheet.") },
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
  el.textContent = online ? "online" : "offline";
  el.className = `pill ${online ? "online" : ""}`;
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

boot();

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {
      /* SW optional in dev */
    });
  });
}
