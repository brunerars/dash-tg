# Technology Stack

**Project:** Dashboard TG — Frontend Integration v2 (JWT auth UI, route guards, pre-compute polling)
**Researched:** 2026-04-02
**Scope:** What stack additions/changes are needed for the new frontend features?

---

## Verdict: Zero New Libraries Required

Every capability needed for JWT cookie auth, route protection, and pre-compute polling is already
present in the existing dependency tree. Zero new `npm install` calls.

---

## Existing Stack (Confirmed From package.json)

| Technology | Version | Role |
|---|---|---|
| React | 18.3.1 | UI runtime (peerDependency) |
| Vite | 6.3.5 | Build tool |
| react-router | 7.13.0 | Routing + navigation |
| react-hook-form | 7.55.0 | Form state + validation |
| shadcn/ui (Radix) | various | UI component library |
| @radix-ui/react-progress | 1.1.2 | Progress bar component |
| sonner | 2.0.3 | Toast notifications |
| native fetch() | Browser | HTTP client |
| React Context | 18.3.1 | App-wide state (SessionContext) |

---

## Feature-by-Feature Analysis

### 1. Login Page (POST /auth/login)

**Backend contract** (from `routers/auth.py`):
- `POST /auth/login` — JSON body `{username, password}` — sets HttpOnly cookie `access_token`, returns `{access_token, token_type: "bearer"}`
- `POST /auth/logout` — deletes cookie
- Cookie: `httponly=True, samesite="lax"`, `secure` controlled by `SECURE_COOKIES` env var

| Capability | Library | Version | Status |
|---|---|---|---|
| Form state + validation | react-hook-form | 7.55.0 | Existing |
| Input + Label + Button components | shadcn/ui (Radix) | various | Existing, in `ui/input.tsx` etc. |
| POST with JSON body | native fetch() | — | Existing |
| Cookie receipt | Browser (automatic) | — | No library needed |
| Redirect after login | react-router `useNavigate` | 7.13.0 | Existing |
| Error display | sonner toast | 2.0.3 | Existing |

`credentials: "include"` is NOT needed for the login call itself — the login endpoint sets the
cookie via `Set-Cookie` response header, which the browser stores automatically regardless of
credentials mode. Only subsequent authenticated calls need `credentials: "include"`.

**No new library needed.**

---

### 2. API Client Migration (X-API-Key header → HttpOnly cookie)

**Current pattern in `api.ts`:**
```ts
const authHeaders = { "X-API-Key": API_KEY };
// every call: fetch(url, { headers: authHeaders })
```

**Target pattern:**
```ts
// every call: fetch(url, { credentials: "include" })
// on 401 response: clear auth state, redirect to /login
```

| Capability | Library | Status |
|---|---|---|
| Cookie attachment on requests | `fetch(..., { credentials: "include" })` | Browser native |
| 401 response handling | Existing `if (!res.ok)` checks | Add `res.status === 401` branch |
| Token storage | None — HttpOnly cookie (browser-managed) | No client-side storage needed |

**CORS dependency:** `credentials: "include"` requires backend CORS `allow_credentials=True` with
a non-wildcard `allow_origins`. Backend already has this — CORS is locked to `FRONTEND_ORIGIN`
(confirmed from Phase 02-02 git commits).

**Cleanup:** `VITE_API_KEY` env var becomes dead config after migration. Remove from `.env` and
from the `api.ts` module. No replacement needed.

**No new library needed.**

---

### 3. Route Protection (redirect to /login on unauthenticated access)

**Current `routes.ts`:** `createBrowserRouter` with single `Layout` at `/` and four child routes.
No auth state exists in the app — `SessionContext.tsx` only tracks page-level data (files,
results, filters).

**Recommended approach — AuthGuard component + AuthContext:**

Two concerns to separate:

1. **AuthContext** (new, ~30 lines): Holds `isAuthenticated: boolean`, `login()`, `logout()`,
   and a `checkAuth()` probe called on app load. The probe calls `GET /strategies` with
   `credentials: "include"` — if it returns 200, the user has a valid cookie; if 401, they do not.
   No `/auth/me` endpoint is needed (no such endpoint exists on the backend currently).

2. **AuthGuard component** (new, ~15 lines): Reads `isAuthenticated` from `AuthContext`. If
   false and auth check has completed, renders `<Navigate to="/login" />`. If check is in progress,
   renders a loading state. Used as a wrapper in the route tree.

**Route tree change:**
```ts
createBrowserRouter([
  { path: "/login", Component: LoginPage },   // public route
  {
    path: "/",
    Component: AuthGuard,                      // new wrapper
    children: [
      {
        Component: Layout,
        children: [
          { index: true, Component: HomePage },
          { path: "dale", Component: DalePage },
          { path: "over-under", Component: OverUnderPage },
          { path: "blueprint/:cacheKey", Component: BlueprintPage },
        ],
      },
    ],
  },
])
```

| Capability | Library | Version | Status |
|---|---|---|---|
| Nested route wrapper | react-router | 7.13.0 | Existing |
| Redirect component | `<Navigate>` from react-router | 7.13.0 | Existing |
| Auth state | React Context | 18.3.1 | New AuthContext (no new library) |
| Auth probe request | native fetch() | — | Existing |

**No new library needed.**

---

### 4. Pre-Compute Polling (POST /precompute + GET /jobs/{job_id})

**Backend contract** (from `routers/precompute.py`):
- `POST /precompute` (202) — multipart/form-data with files → `{job_ids: string[], total_jobs: number}`
- `GET /jobs/{job_id}` → `{status: "pending"|"running"|"completed"|"failed", cache_key?: string, error?: string}`

**Flow:** OverUnderPage uploads files → calls POST /precompute → receives N job_ids → polls each
job_id every 2 seconds → when all terminal (completed/failed), stops polling. The user does not
need to wait for all jobs to finish before running `/analyze` — a cache hit will occur for their
specific file combination as soon as that job is done.

| Capability | Library | Version | Status |
|---|---|---|---|
| POST /precompute (multipart) | native fetch() | — | Existing pattern (same as /analyze) |
| Polling loop | `useEffect` + `setInterval` | React 18.3.1 | Existing |
| Job state array | `useState` | React 18.3.1 | Existing |
| Progress display | @radix-ui/react-progress | 1.1.2 | Existing, in `ui/progress.tsx` |
| Stop condition | `useRef` for interval ref | React 18.3.1 | Existing |
| Completion/error toast | sonner | 2.0.3 | Existing |

**Polling implementation pattern** (~25 lines, no external library):
```ts
// Pseudocode — not final implementation
useEffect(() => {
  if (jobIds.length === 0) return;
  const id = setInterval(async () => {
    const statuses = await Promise.all(jobIds.map(id => fetchJobStatus(id)));
    setJobStatuses(statuses);
    const allDone = statuses.every(s => s.status === "completed" || s.status === "failed");
    if (allDone) clearInterval(id);
  }, 2000);
  return () => clearInterval(id);
}, [jobIds]);
```

**Why not react-query/SWR:** Those libraries add ~50KB to bundle and a new mental model for a
single polling use case. `useEffect + setInterval` is 25 lines and zero dependencies.

**No new library needed.**

---

## Auth State Architecture

**Recommendation: Separate `AuthContext` from `SessionContext`.**

Rationale: Auth state (`isAuthenticated`, `username`) has a different lifecycle than page state
(files, results, filters). Auth persists as long as the cookie is valid. Page state resets per
analysis. Mixing them into `SessionContext` would create coupling — a "reset session" action would
incorrectly clear auth state.

```ts
// New AuthContext (~30 lines)
interface AuthState {
  isAuthenticated: boolean;
  username: string | null;
  isLoading: boolean;            // true during initial auth probe
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}
```

`AuthProvider` wraps the app at the root, outside `SessionProvider`. On mount it calls `checkAuth()`
which probes `GET /strategies` — if 401, `isAuthenticated = false`; otherwise `true`.

---

## Summary: New Dependencies

**Zero.** No new packages. No `package.json` changes.

| Change | Type | Size |
|---|---|---|
| `AuthContext.tsx` | New file (~30 lines) | n/a |
| `AuthGuard.tsx` | New file (~15 lines) | n/a |
| `LoginPage.tsx` | New file (~60 lines) | n/a |
| `api.ts` — add `login()`, `logout()` functions | Edit existing | +20 lines |
| `api.ts` — replace `authHeaders` with `credentials: "include"` | Edit existing | -3/+1 per call |
| `routes.ts` — add `/login` + `AuthGuard` wrapper | Edit existing | +5 lines |
| `OverUnderPage.tsx` — add precompute + polling | Edit existing | +~60 lines |

---

## What NOT to Add

| Library | Reason Not Needed |
|---|---|
| `@tanstack/react-query` | Overkill for 2 endpoints + one polling screen. native fetch + useEffect covers it. |
| `axios` | fetch() already works; axios interceptors add complexity not worth the bundle. |
| `js-cookie` | HttpOnly cookies are not readable from JS by design — this library can't access them. |
| `jwt-decode` | Client doesn't need to read JWT payload. Auth state comes from API responses and 401 probes. |
| `zustand` / `jotai` | SessionContext already handles page state. AuthContext adds 30 lines of standard React Context. |
| `swr` | Polling library for one use case is not justified. |
| `react-use` | useInterval hook is 8 lines — no reason to import a full utility library. |

---

## Sources

- Codebase direct analysis (HIGH confidence): `esoccerdashboard/src/app/services/api.ts`,
  `routes.ts`, `SessionContext.tsx`, `package.json`
- Backend API contracts (HIGH confidence): `routers/auth.py`, `routers/precompute.py`,
  `middleware/auth.py` — read directly from codebase
- React Router v7 nested routes and Navigate: https://reactrouter.com/start/library/routing
  (HIGH confidence — library already in use at pinned version 7.13.0)
- MDN fetch credentials mode: https://developer.mozilla.org/en-US/docs/Web/API/fetch#credentials
  (HIGH confidence — browser standard)
- react-hook-form v7 useForm: https://react-hook-form.com/docs/useform
  (HIGH confidence — library already in use in the project)
