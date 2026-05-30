// Auth gate. First run (no user) shows a "create your account" form; afterwards
// shows login. Calls onAuthed() once a session is established.
import { api, ApiError, type AuthStatus } from "./api";

export async function renderAuthGate(
  root: HTMLElement,
  status: AuthStatus,
  onAuthed: () => void,
): Promise<void> {
  const mode: "register" | "login" = status.registered ? "login" : "register";

  root.innerHTML = `
    <div class="card auth">
      <h2>${mode === "register" ? "Create your account" : "Welcome back"}</h2>
      <p class="muted">
        ${
          mode === "register"
            ? "Set a password to start tracking. This is a single-user app — just you."
            : "Log in to load your workouts."
        }
      </p>
      <form id="auth-form">
        <label>Email <span class="muted">(optional)</span>
          <input name="email" type="email" autocomplete="email" />
        </label>
        <label>Password
          <input name="password" type="password" required minlength="8"
            autocomplete="${mode === "register" ? "new-password" : "current-password"}" />
        </label>
        <p class="error" id="auth-error" hidden></p>
        <button class="primary" type="submit">
          ${mode === "register" ? "Create account" : "Log in"}
        </button>
      </form>
    </div>`;

  const form = root.querySelector<HTMLFormElement>("#auth-form")!;
  const errEl = root.querySelector<HTMLParagraphElement>("#auth-error")!;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    errEl.hidden = true;
    const btn = form.querySelector("button")!;
    btn.disabled = true;
    const data = new FormData(form);
    const payload = {
      email: (data.get("email") as string) || undefined,
      password: data.get("password") as string,
    };
    try {
      await api.post(`/api/auth/${mode}`, payload);
      onAuthed();
    } catch (err) {
      errEl.textContent =
        err instanceof ApiError ? err.message : "Something went wrong";
      errEl.hidden = false;
      btn.disabled = false;
    }
  });
}

export async function logout(): Promise<void> {
  try {
    await api.post("/api/auth/logout");
  } catch {
    /* ignore */
  }
}
