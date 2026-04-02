# Domain Pitfalls

**Domain:** Frontend JWT cookie auth migration + route protection + polling (React SPA)
**Researched:** 2026-04-02
**Scope:** Adding JWT HttpOnly cookie auth, login page, route guards, and pre-compute polling to existing React 18 + Vite 6 + react-router v7 app that currently uses X-API-Key header auth.

---

## Critical Pitfalls

Mistakes that cause broken auth, security holes, or UX regressions.

---

### Pitfall 1: Residual X-API-Key Header After Migration — Silent Dual Auth

**What goes wrong:** `api.ts` currently passes `headers: authHeaders` (`{ "X-API-Key": API_KEY }`) on every `fetch` call. During migration, if `credentials: "include"` is added without removing `authHeaders`, both auth methods run simultaneously. The backend accepts the API Key (still in env) so everything appears to work — but the cookie path is never exercised. The bug only surfaces after `VITE_API_KEY` is removed from the environment.

**Why it happens:** Replacing a header with an invisible browser mechanism leaves no compile-time signal. A developer can add `credentials: "include"` to one call and forget to remove `authHeaders` from five others. The `console.log("[API] API_KEY definida:", !!API_KEY)` line in `api.ts` gives false confidence that auth is working when it is the old path doing the work.

**Consequences:**
- All API calls work in dev (API Key still in `.env`) but fail in production after the key is removed from Portainer.
- Migration appears complete in QA but breaks on first production deploy.
- Mixed auth modes in the same codebase confuse future debugging.

**Prevention:**
- Remove `VITE_API_KEY` from `.env` and `.env.example` on day one of the auth phase.
- Replace all `fetch(url, { headers: authHeaders, ... })` calls with a central `apiFetch(url, options)` wrapper that sets `credentials: "include"` and no `X-API-Key` header. Do this in a single commit that touches every call site.
- Delete the `const authHeaders = { "X-API-Key": API_KEY }` line and the `console.log("[API] API_KEY definida:", !!API_KEY)` log at the same time.
- After migration, verify in DevTools Network that requests carry `Cookie: access_token=...`, not `X-API-Key`.

**Detection:** DevTools → Network → any API request → Headers tab. If `X-API-Key` is present after the migration commit, the migration is incomplete.

**Phase:** Phase 2 (auth migration).

---

### Pitfall 2: Auth State Flash — ProtectedRoute Redirects Before Cookie Check Completes

**What goes wrong:** On hard refresh of `/dale` or `/over-under`, the auth context initializes with `isAuthenticated: false` (its only safe default, since the HttpOnly cookie is invisible to JavaScript). The route guard runs synchronously, sees `false`, and immediately redirects to `/login`. The async `GET /auth/me` call then completes and confirms the user is authenticated — but they are already on `/login`.

**Why it happens:** There is no `isLoading` state in the current `SessionContext`. The guard has only two states: authenticated or not. A third state (checking) is required to bridge the async cookie validation.

**Consequences:**
- Every hard refresh kicks the user to `/login`. They are redirected back after the check completes (if the login page redirects authenticated users), causing a visible flash.
- If the login page does not redirect authenticated users, the user must manually navigate back after every refresh.
- Can produce a redirect loop: `/dale` → `/login` → `/dale` → `/login`.

**Prevention:**
- Add `isLoading: boolean` to the auth context. Initialize to `true`. Set to `false` after the `GET /auth/me` call resolves (success or failure).
- In the `ProtectedRoute` component, render `null` (or a minimal spinner) while `isLoading === true`. Never redirect while loading.
- Only redirect to `/login` when `isLoading === false && isAuthenticated === false`.
- The backend already has `verify_jwt_cookie` — add a `GET /auth/me` endpoint that returns `{"username": sub}` to enable this check. One lightweight call on app mount.

```typescript
function ProtectedRoute({ children }: { children: ReactNode }) {
  const { isAuthenticated, isLoading } = useAuth();
  if (isLoading) return null; // wait for cookie check
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  return children;
}
```

**Detection:** Hard refresh on `/dale`. If you are redirected to `/login` even with a valid session, this pitfall is active.

**Phase:** Phase 2 (auth context + route guards).

---

### Pitfall 3: SameSite=Lax Cookie Not Sent on Cross-Port Dev Requests

**What goes wrong:** Vite runs on `localhost:5173`. FastAPI runs on `localhost:8000`. The browser treats these as different origins (port is part of the origin). `SameSite=Lax` cookies are sent on same-site navigations but browser behavior for cross-port `localhost` requests is inconsistent. The login sets the cookie, but subsequent `fetch` calls to port 8000 may not include it — even with `credentials: "include"`.

**Why it happens:** `SECURE_COOKIES` is configurable in `config/settings.py`. In dev it is likely `false`. Without `Secure=true`, `SameSite=None` cannot be used (browsers reject it). With `SameSite=Lax`, cross-port behavior is browser-dependent. The cookie appears in DevTools but is silently excluded from the request.

**Consequences:** Login returns 200 and sets the cookie. The next API call returns 401. Appears as "auth broken" even though the token is valid. This breaks the entire dev workflow until a proxy is added.

**Prevention — add a Vite dev proxy:**
```typescript
// vite.config.ts
export default defineConfig({
  server: {
    proxy: {
      "/api": {
        target: "http://localhost:8000",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ""),
      },
    },
  },
  // ... rest of config
});
```

With the proxy, the browser sends all API calls to `localhost:5173/api/...` (same origin), the proxy forwards to port 8000. The cookie is always sent. Set `VITE_API_BASE_URL=/api` in `.env.local`.

This also eliminates the need for `FRONTEND_ORIGIN` to be correct in dev — CORS is not involved when requests are same-origin from the browser's perspective.

**Detection:** DevTools → Application → Cookies: `access_token` exists. DevTools → Network → any POST/GET to port 8000: no `Cookie` header. That is the bug.

**Phase:** Phase 2 (first thing, before any auth code is written).

---

### Pitfall 4: CORS Misconfiguration Silently Breaks Cookie Delivery

**What goes wrong:** `main.py` correctly sets `allow_origins=[FRONTEND_ORIGIN]` with `allow_credentials=True`. The risk is `FRONTEND_ORIGIN` being empty, wrong, or inadvertently changed to `["*"]`. When `allow_origins=["*"]` is combined with `allow_credentials=True`, browsers block the response entirely — but the error message ("CORS error") does not explain that the root cause is the wildcard + credentials conflict.

**Specific risks in this codebase:**
- `FRONTEND_ORIGIN` env var not set in Portainer on first deploy → defaults to `http://localhost:3000` in `config/settings.py`, which does not match the production URL.
- During debugging, a developer temporarily changes to `allow_origins=["*"]` and forgets to revert.
- Trailing slash mismatch: `FRONTEND_ORIGIN=https://dash.example.com/` (with slash) vs the actual origin `https://dash.example.com` (without) causes a silent mismatch.

**Prevention:**
- Add a startup assertion in `main.py`: if `FRONTEND_ORIGIN` contains `*` and `allow_credentials=True`, raise a `ValueError` at startup.
- Document the exact value of `FRONTEND_ORIGIN` to use in Portainer in the deploy checklist.
- Never use `allow_origins=["*"]` with `allow_credentials=True` — this is enforced by browsers and will silently break all credentialed requests.

**Detection:** Browser console: `Access to fetch at '...' from origin '...' has been blocked by CORS policy`. Check that the `Access-Control-Allow-Origin` response header matches exactly the origin in the request (no trailing slash, same scheme).

**Phase:** Phase 2 (deploy validation).

---

### Pitfall 5: Polling Interval Leak — `setInterval` Not Cleared on Unmount or Job Completion

**What goes wrong:** `OverUnderPage` will trigger `POST /precompute` and receive an array of `job_ids`. For each job ID, polling `GET /jobs/{job_id}` must run until the job reaches a terminal state (`completed` or `failed`). If the polling is implemented as `N` separate `setInterval` calls (one per job ID), and the `useEffect` cleanup does not clear all of them, intervals outlive the component.

**Why it happens:** The `OverUnderPage` already has complex `useRef`/`useEffect` patterns for debouncing re-analysis. Adding polling intervals to this mix is high-risk for missing a cleanup. `setInterval` callbacks capture stale closures — if state is read directly inside the callback (not via a ref), the callback sees stale values and may call `setState` on an unmounted component.

**Consequences:**
- Network spam: up to 2^N-1 polling requests continue after the user navigates away.
- React warning: "Can't perform a React state update on an unmounted component."
- If the component remounts while old intervals are still running, duplicate intervals accumulate.

**Prevention:**
- Use a single interval that polls all pending job IDs in one tick, not N separate intervals.
- Stop the interval when all jobs are in terminal states (`completed` or `failed`).
- Always return a cleanup function from `useEffect` that calls `clearInterval`.
- Read job state via a `useRef` inside the interval callback, not directly from state (avoids stale closure).

```typescript
useEffect(() => {
  if (jobIds.length === 0) return;
  const id = setInterval(async () => {
    const results = await Promise.all(jobIds.map(id => fetchJobStatus(id)));
    setJobStatuses(results);
    const allDone = results.every(r => r.status === "completed" || r.status === "failed");
    if (allDone) clearInterval(id);
  }, 3000);
  return () => clearInterval(id); // cleanup on unmount OR jobIds change
}, [jobIds]);
```

**Detection:** Navigate away from Over/Under page while pre-compute is running. Open DevTools Network. If `GET /jobs/...` requests continue appearing, the cleanup is missing.

**Phase:** Phase 3 (pre-compute polling).

---

### Pitfall 6: Logout Does Not Immediately Clear Client Auth State

**What goes wrong:** `POST /auth/logout` deletes the `access_token` cookie on the server. But if the auth context still holds `isAuthenticated: true` after the call, the UI stays fully accessible. The next hard refresh triggers the auth check, discovers the cookie is gone, and finally redirects — but only on refresh.

**Why it happens:** HttpOnly cookies are invisible to JavaScript. The client cannot directly observe the cookie being deleted. If `POST /auth/logout` is called without awaiting the response and updating context state, the UI and server auth state diverge.

**Consequences:** User clicks logout, stays on the current page with full access. No redirect. Looks like broken logout.

**Prevention:**
- Await `POST /auth/logout` before updating auth context.
- On success (2xx), set `isAuthenticated: false` and call `navigate("/login")`.
- Clear `SessionContext` state (`dale`, `overUnder` page states) on logout to prevent stale analysis data from being visible to the next login session.
- Handle logout API failure gracefully: still clear local auth state and redirect. The JWT TTL will expire the cookie server-side anyway.

**Detection:** Click logout. If the URL stays on the current page without redirect, this pitfall is active.

**Phase:** Phase 2.

---

## Moderate Pitfalls

---

### Pitfall 7: No Centralized 401 Handler — Silent Session Expiry After 12 Hours

**What goes wrong:** The JWT TTL defaults to 720 minutes (12 hours) per `config/settings.py`. After expiry, every API call returns 401. The current `api.ts` throws `new Error(err?.detail ?? "Erro na análise: ${res.status}")` on non-ok responses — a generic error that displays as a toast or error div, not a redirect to `/login`. The user sees "Erro: 401" without understanding their session has expired.

**Prevention:**
- In the `apiFetch` wrapper, add a global 401 interceptor: if response status is 401, clear auth context and navigate to `/login`.
- This handles both token expiry and any future auth failure without per-call handling.

```typescript
async function apiFetch(url: string, options?: RequestInit): Promise<Response> {
  const res = await fetch(url, { credentials: "include", ...options });
  if (res.status === 401) {
    authContext.setAuthenticated(false);
    router.navigate("/login");
  }
  return res;
}
```

**Phase:** Phase 2.

---

### Pitfall 8: Login Page Remains Accessible to Authenticated Users

**What goes wrong:** After login, if the user navigates to `/login` manually, they see the login form again. Submitting it issues a new cookie, overwriting the current one. There is no UX feedback that they are already logged in.

**Prevention:** On the `/login` route, check `isAuthenticated` in the auth context (after `isLoading` resolves). If `true`, redirect to `/` (or the route the user was trying to access before being sent to login, via `state.from` in the navigation).

**Phase:** Phase 2.

---

### Pitfall 9: `access_token` in Login Response Body Stored in JS-Accessible State

**What goes wrong:** `routers/auth.py` returns `{"access_token": token, "token_type": "bearer"}` in the response body (intentionally, for Swagger compatibility). If the frontend login handler stores this token in React state, `localStorage`, or `sessionStorage`, the HttpOnly cookie's security benefit is negated — any XSS can now read the token from JS-accessible storage.

**Prevention:** The frontend login handler must call `POST /auth/login`, receive the 200 response, and ignore the `access_token` in the body. Rely entirely on the cookie the browser stores automatically. Do not `localStorage.setItem("token", data.access_token)` or put it in any React state.

**Phase:** Phase 2.

---

### Pitfall 10: Pre-compute Called With Stale `File` References

**What goes wrong:** `POST /precompute` reads all uploaded `File` objects into `FormData`. If `files` state in `OverUnderPage` is updated by the user (removing or adding a file) between the time the button is clicked and the time `fetch` resolves, the `FormData` may contain incorrect files. This is the same stale closure risk that `handleAnalyze` already guards against via `ouRef.current`.

**Prevention:** Snapshot the file list at the moment `POST /precompute` is triggered, identical to how `handleAnalyze` uses `ouRef.current.files`. Do not read from reactive state inside the async call.

**Phase:** Phase 3.

---

### Pitfall 11: Vite Dev Proxy Missing — `FRONTEND_ORIGIN` Must Match Dev Port

**What goes wrong:** Without the Vite proxy (see Pitfall 3), every API call in dev is cross-origin. CORS is required, and `FRONTEND_ORIGIN` must be set to `http://localhost:5173` (the exact Vite port) in the backend's `.env`. If Vite's port changes (e.g., port 5173 is busy and Vite picks 5174), all API calls break.

**Prevention:** Either add the Vite proxy (recommended, eliminates this class of problem entirely) or pin Vite's port explicitly in `vite.config.ts` with `server: { port: 5173, strictPort: true }`.

**Phase:** Phase 2 (dev environment setup).

---

## Minor Pitfalls

---

### Pitfall 12: Console Logs Exposing Auth State in Production

**What goes wrong:** `api.ts` contains `console.log("[API] API_KEY definida:", !!API_KEY)` and multiple `console.log` / `console.warn` calls that log raw API responses. Adding similar debug logs for JWT state (e.g., logging the token value or auth context state) during development and forgetting to remove them before production deploy.

**Prevention:** Remove all auth-related `console.log` calls as part of the migration commit. The existing `console.log("[API] BASE_URL:", BASE_URL)` and `console.log("[API] API_KEY definida:", !!API_KEY)` must both be deleted.

**Phase:** Phase 2.

---

### Pitfall 13: Missing `replace` on Auth Redirect — Back Button Loops to Protected Route

**What goes wrong:** If `<Navigate to="/login" />` does not include `replace`, the login redirect pushes a new history entry. After successful login, clicking the browser back button returns to the protected route's redirect — which sends the user back to `/login` again.

**Prevention:** Always use `<Navigate to="/login" replace />` in route guards (and `navigate("/login", { replace: true })` in imperative redirects). This replaces the history entry instead of pushing, breaking the loop.

**Phase:** Phase 2.

---

### Pitfall 14: Job Status `failed` State Has No User-Facing Error Message

**What goes wrong:** `GET /jobs/{job_id}` returns `{"status": "failed", "error": "..."}` on failure. If the polling UI only checks for `completed` to show results and `pending`/`running` to show a spinner, a `failed` status is silently ignored — the spinner continues forever or disappears without explanation.

**Prevention:** Explicitly handle the `failed` status in the polling UI: show an error message with the `error` field from the job response. Distinguish between "all jobs failed" (show an error state) and "some jobs failed, some completed" (show partial results with a warning).

**Phase:** Phase 3.

---

## Phase-Specific Warnings

| Phase Topic | Likely Pitfall | Mitigation |
|-------------|---------------|------------|
| Phase 2: Dev environment setup | Pitfall 3 (SameSite cross-port) | Add Vite proxy first, before writing any auth code |
| Phase 2: API client migration | Pitfall 1 (X-API-Key residue) | Single-commit replacement; delete env var same day |
| Phase 2: Auth context | Pitfall 2 (flash redirect) | `isLoading` state in context; ProtectedRoute renders null while loading |
| Phase 2: Logout | Pitfall 6 (stale client state) | Await logout response, then clear context and navigate |
| Phase 2: Token expiry | Pitfall 7 (silent 401) | Central 401 interceptor in `apiFetch` wrapper |
| Phase 2: Login response body | Pitfall 9 (token in JS state) | Ignore token in response body; rely on cookie only |
| Phase 2: History on redirect | Pitfall 13 (back button loop) | Always use `replace` on auth redirects |
| Phase 2: CORS in production | Pitfall 4 (FRONTEND_ORIGIN wrong) | Verify exact value in Portainer before first deploy |
| Phase 3: Pre-compute polling | Pitfall 5 (interval leak) | Single interval, cleanup on unmount and terminal state |
| Phase 3: File snapshot | Pitfall 10 (stale File refs) | Snapshot files array at call time (same pattern as `ouRef`) |
| Phase 3: Job failure UI | Pitfall 14 (failed state ignored) | Explicitly handle `failed` status in polling component |

---

## Sources

- CORS + credentials with `allow_credentials=True`: https://fastapi.tiangolo.com/tutorial/cors/ (HIGH confidence — official FastAPI docs)
- `credentials: "include"` fetch behavior: https://zellwk.com/blog/fetch-credentials/ (MEDIUM confidence — verified against MDN)
- `SameSite` cookie attribute spec: https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Set-Cookie (HIGH confidence — MDN)
- React Router v7 protected routes: https://www.robinwieruch.de/react-router-private-routes/ (MEDIUM confidence)
- Auth context race condition / `isLoading` guard: https://github.com/auth0/auth0-react/issues/343 (MEDIUM confidence — well-documented pattern)
- `setInterval` cleanup in React: https://javascript.plainenglish.io/pitfalls-when-using-setinterval-in-react-72cf2c566b6a (MEDIUM confidence)
- Declarative `setInterval` with hooks: https://overreacted.io/making-setinterval-declarative-with-react-hooks/ (HIGH confidence — Dan Abramov, React core team)
- Stale closure in `setInterval`: https://react.dev/reference/react/useEffect (HIGH confidence — React official docs)
- HttpOnly cookie logout: https://medium.com/@kartikey8604/handling-authentication-cookie-expiry-and-session-logout-using-axios-interceptors-in-reactjs-63a8c14825aa (MEDIUM confidence)
- Codebase direct inspection: `api.ts`, `SessionContext.tsx`, `middleware/auth.py`, `routers/auth.py`, `routers/precompute.py`, `main.py`, `config/settings.py`, `vite.config.ts`, `routes.ts`, `OverUnderPage.tsx` (HIGH confidence)
