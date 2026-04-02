# Feature Landscape

**Domain:** Frontend JWT auth integration, route protection, pre-compute polling — React SPA
**Researched:** 2026-04-02
**Milestone scope:** v2.0 — Integrar frontend React com JWT cookie auth, protecao de rotas, e polling de pre-computo Over/Under

---

## Context: What Already Exists (Do Not Re-Build)

| Existing Feature | Location | Status |
|-----------------|----------|--------|
| API client using X-API-Key header | `services/api.ts` | Needs migration, not replacement |
| SessionContext (in-memory page state) | `components/SessionContext.tsx` | Stable — no changes needed |
| File upload + analysis flow (Dale + Over/Under) | `DalePage.tsx`, `OverUnderPage.tsx` | Stable — extend, do not rewrite |
| Route definitions (react-router v7) | `routes.ts` — 4 routes, no guards | Needs guard wrapping |
| Layout with sidebar | `Layout.tsx` | Needs logout button; no structural rewrite |
| Results table, filters, blueprint | Various | No changes needed |

---

## Table Stakes

Features users expect. Missing = product feels broken or inaccessible.

| Feature | Why Expected | Complexity | Depends On |
|---------|--------------|------------|------------|
| Login page (`/login`) | Backend now requires JWT. Without a login page, the app is permanently locked. | Low | — |
| `credentials: "include"` on all API calls | JWT is an HttpOnly cookie. Without this flag, the browser never sends the cookie, every call gets 401, app is unusable. | Low | Login established first |
| Redirect to `/login` on 401 | Backend now returns 401 instead of rejecting with API key error. Without a catch, user sees a blank error or crash. | Low | A way to detect 401 centrally (shared fetch wrapper) |
| Route guard: all existing routes protected | Every existing page (`/`, `/dale`, `/over-under`, `/blueprint/:cacheKey`) requires auth. Without guards, unauthenticated users land on a broken dashboard (API calls 401, nothing loads). | Low | Auth state held somewhere (context or cookie check) |
| Logout action | User session must be terminable. Without logout, token lives until expiry and there is no clean exit. | Low | `POST /auth/logout` endpoint (already built) |
| Remove `VITE_API_KEY` env var and `X-API-Key` header | Old auth mechanism conflicts with new one. Leaving both creates confusion and two-path code. | Low | `credentials: "include"` working |

---

## Differentiators

Features that improve UX beyond the bare minimum for this product.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Pre-compute auto-triggered on Over/Under file upload | Core value proposition: "user uploads and already finds results." Without this, Over/Under combinations are only computed on-demand (slow). With it, by the time user clicks Analyze, results are cached. | Medium | `POST /precompute` already built. Frontend needs to fire it immediately on file selection, not on Analyze button click. |
| Job progress indicator during pre-compute | With 2^N-1 jobs running (e.g., 7 for 3 files), user needs feedback. A progress bar (X of Y jobs complete) reduces perceived wait time and confirms computation is happening. | Medium | Requires polling `GET /jobs/{job_id}` for each job_id returned by `/precompute`. |
| Polling terminates cleanly | If user navigates away or changes files, orphaned polling intervals cause stale state updates and React warnings. | Low-Medium | useEffect cleanup + abort on unmount / file change. |
| Auth context with `isAuthenticated` flag | Components that need to conditionally render logout buttons or username need a central state source. Checking cookies directly from JS is not possible (HttpOnly). An auth context that calls `GET /strategies` (or a dedicated `/auth/me`) to verify cookie validity on mount is the idiomatic pattern. | Low | One auth-check call on app mount; errors caught globally |
| Login form: show password toggle | Single-user dashboard — no autocomplete, often typed manually. Show/hide password button reduces friction. | Low | Pure UI, no API dependency |
| "Sessao expirada" toast on 401 mid-session | User starts working, session expires, clicks Analyze. Raw 401 redirect is abrupt. A brief toast ("Sessao expirada — redirecionando para login") before redirect is smoother. | Low | Interceptor in fetch wrapper |

---

## Anti-Features

Features to explicitly NOT build in this milestone.

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| Refresh token rotation in frontend | Backend does not issue refresh tokens (single short-lived JWT per login). Frontend managing refresh logic that doesn't exist on the backend wastes time and creates mismatched state. | Re-login on 401. Session expiry is acceptable for a single-user internal tool. |
| Remember-me / persistent login checkbox | Backend JWT expiry is fixed in env config. Frontend has no way to extend it client-side. HttpOnly cookie is automatically persistent across browser restart if `max_age` is set (backend already sets it). | No UI needed — cookie persistence is controlled by backend `max_age`. |
| Optimistic UI for pre-compute (faking completion) | If frontend shows "computed" before jobs are actually done and user clicks Analyze immediately, they get a cache miss and wait anyway. | Show real job status. Only mark complete when all jobs return `completed` or `failed`. |
| WebSocket for job updates | 7 jobs completing in under 30 seconds. Polling at 2-second intervals costs 3-4 round trips per job. WebSocket adds reconnection logic and backend plumbing for no gain. | Polling with 2s interval, exponential backoff optional. |
| Dedicated `/auth/me` endpoint call on every route render | Calling auth-check on each route change causes flicker (unauthenticated flash) and extra round trips. | Single check on app mount, result cached in React context. |
| Multi-tab auth sync | Single internal user with a single browser session. `BroadcastChannel` / `storage` event listeners for auth sync add complexity with no identified need. | Ignore. |
| Pre-compute for Dale (eSoccer — Dupla) | Explicitly out of scope in PROJECT.md. DALE performance is acceptable without pre-computation. | DALE upload triggers only the standard `/analyze` flow. |

---

## Feature Dependencies

```
Auth Context (AuthProvider, useAuth hook)
  --> Login Page (/login route, POST /auth/login)
  --> Route Guard (ProtectedRoute wrapper component)
       --> All existing routes stay inside guard
  --> Logout button in Layout/Sidebar (POST /auth/logout)

API Client migration
  --> Remove authHeaders / VITE_API_KEY
  --> Add credentials: "include" to all fetch() calls
  --> Add central 401 interceptor (redirect or toast + redirect)
       --> Depends on AuthContext to trigger logout state

Pre-compute flow (Over/Under only)
  --> Triggered on file selection (not on Analyze button)
       --> POST /precompute called with selected files
            --> job_ids[] returned
                 --> Polling loop: GET /jobs/{job_id} every 2s per job_id
                      --> On all completed: cache is warm, Analyze button triggers cache hit
                      --> On any failed: show error, Analyze button still works (computes fresh)
  --> Polling state stored in local component state (not SessionContext)
  --> Polling must be cleaned up on component unmount and file change
```

---

## Implementation Notes

### Auth Check on Mount (Table Stakes)

The backend backend serves HttpOnly cookies — JavaScript cannot read `document.cookie` to check auth state. The idiomatic approach:

1. On `App` mount, call any authenticated endpoint (e.g., `GET /strategies`).
2. If 200: user is authenticated, set `isAuthenticated = true`.
3. If 401: set `isAuthenticated = false`, render `<Navigate to="/login" />`.
4. While pending: render a loading spinner (avoids unauthenticated flash to protected routes).

This avoids a dedicated `/auth/me` endpoint (which doesn't exist on the backend) and reuses an endpoint the app already calls at startup.

**Confidence:** HIGH — standard React SPA pattern with HttpOnly cookies.

### Route Guard Pattern (Table Stakes, Low Complexity)

React Router v7 uses the same component-based guard pattern as v6:

```tsx
// ProtectedRoute.tsx
function ProtectedRoute() {
  const { isAuthenticated, isLoading } = useAuth();
  if (isLoading) return <LoadingSpinner />;
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  return <Outlet />;
}
```

In `routes.ts`, wrap the existing Layout route:
```tsx
{ path: "/", Component: ProtectedRoute, children: [
  { path: "/", Component: Layout, children: [...existing routes] }
]}
{ path: "/login", Component: LoginPage }
```

The login route must sit outside the guard — otherwise `/login` itself is protected and you have an infinite redirect loop.

**Confidence:** HIGH — official React Router v7 pattern, no behavior change from v6 for this use case.

### Central 401 Handling (Table Stakes, Low Complexity)

All fetch calls in `services/api.ts` should funnel through a shared wrapper that checks `res.status === 401` and calls a provided callback (trigger logout + redirect). Pass the callback from the auth context or use a module-level setter pattern.

Option A (simpler): Module-level `onUnauthorized` callback set by `AuthProvider` on mount:
```ts
// api.ts
let onUnauthorized: (() => void) | null = null;
export function setUnauthorizedHandler(fn: () => void) { onUnauthorized = fn; }

// in every API function:
if (res.status === 401) { onUnauthorized?.(); throw new Error("Unauthorized"); }
```

Option B: Custom `useFetch` hook that wraps fetch and injects auth context. More idiomatic React, but requires refactoring all call sites.

Recommendation: Option A. All API calls are already centralized in `services/api.ts` — adding the 401 check there means zero changes to any component.

**Confidence:** HIGH — pattern used in production React SPAs.

### Pre-Compute Polling (Differentiator, Medium Complexity)

Key facts from backend code (`routers/precompute.py`):
- `POST /precompute` accepts N files, returns `{ job_ids: string[], total_jobs: number }`.
- `GET /jobs/{job_id}` returns `{ status: "pending"|"running"|"completed"|"failed", cache_key?: string, error?: string }`.
- There is no bulk jobs endpoint. Frontend must poll each `job_id` individually.
- Jobs run in a `ThreadPoolExecutor` (max 2 workers). With 7 combinations, the first 2 run immediately; remaining 5 queue.
- `completed` jobs include `cache_key` — this is the same key `POST /analyze` would generate for the same file set + strategy, so subsequent `/analyze` calls will hit the cache.

Polling strategy:
- Start polling all job_ids simultaneously (not sequentially).
- `setInterval` per job, clear on `completed` or `failed`.
- Aggregate status: `{ pending: N, running: N, completed: N, failed: N }`.
- Show progress: `completed / total_jobs` as a progress bar.
- Stop all polling when `completed + failed === total_jobs`.
- Clean up all intervals in useEffect return callback.

When to trigger `POST /precompute`:
- On `files` state change in `OverUnderPage` (not on Analyze button).
- If files change mid-session, cancel previous job polling and start fresh.

**Confidence:** HIGH — derived directly from reading `routers/precompute.py`.

### `credentials: "include"` Migration (Table Stakes, Low Complexity)

Current `services/api.ts` uses:
```ts
const authHeaders = { "X-API-Key": API_KEY };
// ...
const res = await fetch(`${BASE_URL}/analyze`, { method: "POST", headers: authHeaders, body: form });
```

Migration removes `authHeaders` entirely and adds `credentials: "include"` to every `fetch()` call. CORS on the backend is already locked to `FRONTEND_ORIGIN` with `allow_credentials=true` (confirmed in PROJECT.md). No backend changes needed.

Also remove `VITE_API_KEY` from `.env` and from the `console.log` statements that expose it.

---

## MVP Recommendation

Build in this order (each phase is independently shippable):

1. **Auth flow** (login page + route guard + logout) — Unlocks the app for production use with new backend. No other feature can be tested without this.
   - AuthProvider context
   - `POST /auth/login` call
   - ProtectedRoute wrapper in routes.ts
   - Login page component
   - Logout in sidebar/header
   - `credentials: "include"` + remove X-API-Key

2. **Central 401 handling** — Prevents silent failures on token expiry mid-session. Pairs with auth flow above.

3. **Pre-compute integration on Over/Under** — Core value prop. After auth works, add:
   - `POST /precompute` on file selection
   - Polling `GET /jobs/{job_id}` per job
   - Progress indicator in OverUnderPage

Defer: login form UX polish (show/hide password, error styling) — functional first, polish after.

---

## Sources

- React Router v7 official docs: route protection patterns — HIGH confidence
- `routers/precompute.py` (codebase) — `POST /precompute` and `GET /jobs/{job_id}` contracts — HIGH confidence
- `routers/auth.py` (codebase) — cookie name `access_token`, HttpOnly, SameSite=Lax, max_age — HIGH confidence
- `middleware/auth.py` (codebase) — dual-mode auth (cookie + Bearer header) — HIGH confidence
- `services/api.ts` (codebase) — current fetch pattern, authHeaders, all call sites — HIGH confidence
- `routes.ts` (codebase) — current route structure, no guards — HIGH confidence
- React SPA HttpOnly cookie auth patterns — MEDIUM confidence (WebSearch-consistent with official React/browser docs)
