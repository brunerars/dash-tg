# Project Research Summary

**Project:** Dashboard TG — Frontend Integration v2 (JWT auth UI, route guards, pre-compute polling)
**Domain:** React SPA — JWT HttpOnly cookie auth migration + route protection + background job polling
**Researched:** 2026-04-02
**Confidence:** HIGH

## Executive Summary

This milestone integrates the React frontend with a backend that has already been upgraded to JWT cookie auth (Phase 02-02). The task is purely frontend: replace the `X-API-Key` header pattern with HttpOnly cookie auth, add a login page and route guards, and wire up the pre-compute polling flow in Over/Under. The backend contracts (`POST /auth/login`, `POST /auth/logout`, `POST /precompute`, `GET /jobs/{job_id}`) are stable and already deployed. No new frontend libraries are required — every capability needed is already present in the dependency tree (React 18, react-router 7, react-hook-form, shadcn/ui, sonner, @radix-ui/react-progress).

The recommended approach is a two-phase execution: first deliver the full auth chain (AuthContext + LoginPage + ProtectedRoute + api.ts migration + logout), then layer in the pre-compute polling. Auth must come first because without it no other feature can be tested against the new backend. The auth implementation centers on three concrete patterns: an `AuthContext` (~30 lines) that probes `GET /strategies` on mount to verify cookie validity, a `ProtectedRoute` component that renders null while the probe is in flight (to prevent flash redirects), and a DOM event (`auth:unauthorized`) dispatched from a central `apiFetch` wrapper to decouple 401 handling from React navigation.

The main risks are dev environment breakage (SameSite=Lax cross-port cookie issues between Vite port 5173 and API port 8000) and incomplete migration (leaving residual `X-API-Key` headers that mask cookie failures in dev). Both are preventable: add a Vite dev proxy as the first action before writing any auth code, and replace all `authHeaders` references in a single atomic commit that also removes `VITE_API_KEY` from `.env`.

---

## Key Findings

### Recommended Stack

Zero new libraries are required. The existing stack handles every capability: react-hook-form covers the login form, `fetch()` with `credentials: "include"` handles cookie transmission, react-router `<Navigate>` and nested route wrappers handle route protection, `useState`/`useEffect`/`setInterval` handle polling, and `@radix-ui/react-progress` provides the progress bar component already installed.

The only infrastructure change needed is a Vite dev proxy to align the browser origin for dev requests, eliminating SameSite cookie cross-port issues without touching CORS or backend config.

**Core technologies:**
- `react-router 7.13.0`: Nested layout routes for ProtectedRoute wrapper — already in use at pinned version
- `react-hook-form 7.55.0`: Login form state and validation — already in use in the project
- `native fetch()` with `credentials: "include"`: Cookie transmission on all API calls — replaces X-API-Key header pattern
- `React Context (18.3.1)`: New AuthContext (~30 lines) separate from SessionContext — no new library
- `@radix-ui/react-progress 1.1.2`: Pre-compute job progress bar — already installed

### Expected Features

**Must have (table stakes):**
- Login page (`/login`) — backend now requires JWT; without it the app is permanently locked
- `credentials: "include"` on all API calls — without this flag the HttpOnly cookie is never sent; every call returns 401
- Redirect to `/login` on 401 — backend returns 401 instead of API key rejection; raw 401 without a catch causes blank errors
- Route guard protecting all existing routes — unauthenticated users get a broken dashboard without guards
- Logout action — user session must be terminable; `POST /auth/logout` already built on backend
- Remove `VITE_API_KEY` env var and `X-API-Key` header — old auth mechanism conflicts with new one

**Should have (differentiators):**
- Pre-compute auto-triggered on Over/Under file upload — core value prop: cache is warm by the time user clicks Analyze
- Job progress indicator (X of N jobs complete) — with up to 31 combinations, user needs feedback that computation is running
- Clean polling termination — orphaned intervals cause React warnings and network spam
- "Sessao expirada" toast on 401 mid-session — smoother UX than abrupt redirect on token expiry

**Defer (v2+):**
- Refresh token rotation — backend does not issue refresh tokens; re-login on expiry is acceptable
- Remember-me checkbox — cookie persistence already controlled by backend `max_age`
- WebSocket for job updates — 2s polling for up to 31 jobs is sufficient for single-user; no backend plumbing needed
- Multi-tab auth sync — single internal user, no identified need

### Architecture Approach

The architecture change is a provider injection at the root and a route wrapper. `AuthProvider` is added above `SessionProvider` in `App.tsx`. `ProtectedRoute` (a layout route component, not a path route) wraps the existing `Layout` in the route tree. `LoginPage` sits outside the guard at `/login`. The `api.ts` module gets a central `apiFetch` wrapper that attaches `credentials: "include"` and dispatches an `auth:unauthorized` DOM event on 401 — decoupling auth logic from React navigation without passing hooks into a plain module. Pre-compute state (job IDs, statuses) lives in `OverUnderPage` local state, not `SessionContext`, because it is ephemeral per file upload.

**Major components:**
1. `AuthContext.tsx` (new, ~30 lines) — `isAuthenticated`, `isLoading`, `login()`, `logout()`; probes `GET /strategies` on mount; listens for `auth:unauthorized` DOM event
2. `ProtectedRoute.tsx` (new, ~15 lines) — renders null while `isLoading`, redirects with `replace` to `/login` when `!isAuthenticated`
3. `LoginPage.tsx` (new, ~60 lines) — react-hook-form form, calls `AuthContext.login()`, redirects to `/` on success, redirects to `/` if already authenticated
4. `apiFetch` wrapper in `api.ts` (edit) — central `credentials: "include"`, 401 dispatch, `login()`/`logout()`/`precompute()`/`pollJob()` functions added
5. `PrecomputeStatus.tsx` (new, ~40 lines) — single `setInterval` polling all job IDs, progress bar via `@radix-ui/react-progress`, cleanup on unmount and job completion

### Critical Pitfalls

1. **Residual X-API-Key after migration** — Replace all `authHeaders` references and remove `VITE_API_KEY` in a single atomic commit. The backend's dual-auth (API key still in env) means everything works in dev with the old key, masking the broken cookie path until production deploy. Verify in DevTools Network that requests carry `Cookie: access_token=...` not `X-API-Key`.

2. **Auth state flash on page refresh** — `ProtectedRoute` must render `null` (not redirect) while `isLoading === true`. Only redirect when `isLoading === false && isAuthenticated === false`. Without this, every hard refresh kicks the user to `/login` even with a valid session.

3. **SameSite=Lax cross-port cookie failure in dev** — Add Vite proxy (`/api` → `http://localhost:8000`) before writing any auth code. Without it, login sets the cookie but subsequent calls to port 8000 may not include it due to browser SameSite enforcement.

4. **Polling interval leak** — Use a single `setInterval` that polls all pending job IDs per tick (not N separate intervals). Always return `clearInterval` from `useEffect`. Stop and clear when all jobs reach terminal state (`completed` or `failed`).

5. **Logout does not clear client state** — Await `POST /auth/logout` before setting `isAuthenticated = false` and calling `navigate("/login", { replace: true })`. Also clear `SessionContext` state to prevent stale analysis data appearing to the next login session.

---

## Implications for Roadmap

Based on combined research, two phases are sufficient.

### Phase 1: Auth Chain

**Rationale:** All auth infrastructure must be in place before any other feature can be tested against the backend. Pre-compute polling has no value without a working session. The auth chain is a linear dependency: `api.ts` migration first, then AuthContext, then LoginPage + ProtectedRoute, then routes.ts update, then App.tsx wrapping, then Layout logout button.

**Delivers:** Fully functional login/logout flow. All existing routes protected. Cookie-based auth replaces header auth. Old `VITE_API_KEY` removed. Users can authenticate and access the dashboard in production.

**Addresses:** All table-stakes features — login page, `credentials: "include"`, route guard, logout, `X-API-Key` removal.

**Avoids:** Pitfall 3 (add Vite proxy first), Pitfall 1 (atomic api.ts migration), Pitfall 2 (isLoading guard), Pitfall 6 (await logout + clear state), Pitfall 9 (ignore token in response body), Pitfall 13 (use `replace` on redirect).

**Build order within phase (serial, each step depends on prior):**
1. Add Vite dev proxy to `vite.config.ts`
2. Migrate `api.ts`: remove `authHeaders`/`VITE_API_KEY`, add `apiFetch` wrapper, add `login()`/`logout()`/`precompute()`/`pollJob()`
3. Build `AuthContext.tsx` with `isLoading`, session probe on mount, `auth:unauthorized` listener
4. Build `LoginPage.tsx` — redirects authenticated users to `/`
5. Build `ProtectedRoute.tsx` — `replace` on redirect, renders null while loading
6. Update `routes.ts` — add `/login` outside guard, wrap children under `ProtectedRoute`
7. Update `App.tsx` — add `<AuthProvider>` above `<SessionProvider>`
8. Add logout button to `Layout.tsx`

### Phase 2: Pre-compute Polling

**Rationale:** Over/Under pre-compute is the core value proposition of this milestone. Once auth is working, this phase is self-contained: trigger `POST /precompute` on file change, store job IDs in local state, poll until terminal. Does not require changes to any auth code.

**Delivers:** Pre-compute is triggered automatically on file selection in Over/Under. Users see a progress indicator (X of N jobs). When they click Analyze, the cache is warm and results appear instantly. Failed jobs show error messages with the `error` field from the job response.

**Addresses:** Pre-compute auto-trigger, job progress indicator, clean polling termination, failed job UI.

**Avoids:** Pitfall 5 (single interval + cleanup), Pitfall 10 (snapshot files at call time, same as `ouRef` pattern), Pitfall 14 (explicitly handle `failed` status in UI).

**Build order within phase:**
1. Build `PrecomputeStatus.tsx` — polling, progress bar, failed state handling
2. Update `OverUnderPage.tsx` — call `precompute()` on file change, render `PrecomputeStatus`, reset on file change

### Phase Ordering Rationale

- Auth must precede pre-compute: `POST /precompute` is a protected endpoint; without a valid cookie the call returns 401
- Vite proxy must precede all auth code: SameSite cross-port issue would make the entire auth chain appear broken during development
- `api.ts` migration must precede `AuthContext`: the context calls `apiFetch` and registers the `auth:unauthorized` listener
- `ProtectedRoute` and `LoginPage` can be built in parallel after `AuthContext` is done
- `PrecomputeStatus` can begin after `api.ts` migration (only needs `pollJob()` exported)

### Research Flags

Phases with standard patterns (skip research-phase):
- **Phase 1 (Auth Chain):** All patterns are well-documented. Backend contracts confirmed from source. React Router v7 guard pattern is identical to v6. No unknowns.
- **Phase 2 (Pre-compute Polling):** Backend contract confirmed from `routers/precompute.py`. `setInterval` + `useEffect` cleanup is a standard React pattern. No unknowns.

No phases require `/gsd:research-phase` — all conclusions drawn from direct codebase inspection at HIGH confidence.

---

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | All technologies confirmed from `package.json` at pinned versions. Zero library lookup needed. |
| Features | HIGH | Backend contracts confirmed by reading `routers/auth.py`, `routers/precompute.py` directly. Feature list is exhaustive. |
| Architecture | HIGH | All conclusions from reading actual source files: `api.ts`, `routes.ts`, `App.tsx`, `SessionContext.tsx`, `OverUnderPage.tsx`, `middleware/auth.py`. No training-data assumptions. |
| Pitfalls | HIGH | Critical pitfalls (cross-port cookie, flash redirect, interval leak) are well-documented in browser specs and confirmed applicable by reading the codebase. |

**Overall confidence:** HIGH

### Gaps to Address

- **`/auth/me` endpoint absent:** `GET /strategies` is used as the auth probe on mount (no `/auth/me` exists). If the backend adds `/auth/me` later, update `AuthContext` probe. Non-blocking for now — `GET /strategies` works and is called at startup anyway.
- **`SECURE_COOKIES` in dev:** Confirm `SECURE_COOKIES=false` is set in the backend dev `.env` before first test. Required for cookies to be sent over `http://` in local development.
- **Token expiry toast:** The "Sessao expirada" toast is a polish step. The central 401 interceptor (clears auth, redirects) must ship in Phase 1. The toast can be a one-liner added at the end of Phase 1 or deferred — the redirect already handles the user correctly.

---

## Sources

### Primary (HIGH confidence)
- Codebase direct inspection: `esoccerdashboard/src/app/services/api.ts`, `routes.ts`, `App.tsx`, `SessionContext.tsx`, `components/Layout.tsx`, `components/OverUnderPage.tsx`, `package.json`
- Backend source: `routers/auth.py`, `routers/precompute.py`, `middleware/auth.py`, `config/settings.py`, `main.py`
- React Router v7 official docs — nested route protection patterns
- MDN fetch credentials mode — `credentials: "include"` behavior specification

### Secondary (MEDIUM confidence)
- React SPA HttpOnly cookie auth patterns — consistent across multiple community sources
- Auth context `isLoading` guard pattern — documented in auth0-react issue tracker and community React auth guides
- SameSite=Lax cross-port localhost behavior — documented in browser-specific bug reports; Vite proxy is universally recommended mitigation
- Dan Abramov / React official docs — declarative `setInterval` with hooks, `useEffect` cleanup patterns

---
*Research completed: 2026-04-02*
*Ready for roadmap: yes*
