# Architecture Patterns

**Domain:** Frontend JWT auth integration, route protection, and pre-compute polling
**Project:** Dashboard TG — Frontend Integration v2
**Researched:** 2026-04-02

---

## Current Architecture (Baseline)

```
App.tsx
  ThemeProvider
    SessionProvider          <- in-memory state only, no auth
      RouterProvider
        Layout (/)           <- Sidebar + Header + Outlet
          HomePage (index)
          DalePage (/dale)
          OverUnderPage (/over-under)
          BlueprintPage (/blueprint/:cacheKey)
```

All routes are unprotected. `api.ts` sends `X-API-Key` header from `VITE_API_KEY` env var. No cookie handling.

---

## Target Architecture

```
App.tsx
  ThemeProvider
    AuthProvider             <- NEW: wraps everything, owns isAuthenticated + login/logout
      SessionProvider        <- unchanged
        RouterProvider
          LoginPage (/login) <- NEW: outside Layout, no sidebar
          ProtectedRoute     <- NEW: wraps Layout, redirects to /login on 401
            Layout
              HomePage (index)
              DalePage (/dale)
              OverUnderPage (/over-under)   <- gains pre-compute polling
              BlueprintPage (/blueprint/:cacheKey)
```

---

## Component Boundaries

### New Components

| Component | File | Responsibility | Communicates With |
|-----------|------|---------------|-------------------|
| `AuthContext` | `components/AuthContext.tsx` | `isAuthenticated` bool, `isLoading` bool, `login()`, `logout()` async functions | `api.ts` (POST /auth/login, /auth/logout) |
| `LoginPage` | `components/LoginPage.tsx` | Username + password form, calls `login()`, redirects on success | `AuthContext` |
| `ProtectedRoute` | `components/ProtectedRoute.tsx` | Reads `isAuthenticated`/`isLoading`; renders `<Outlet />` or `<Navigate to="/login" />` | `AuthContext` |
| `PrecomputeStatus` | `components/PrecomputeStatus.tsx` | Displays job progress, polls `pollJob()` until all done or failed | `api.ts` (GET /jobs/:id) |

### Modified Components

| Component | Change | Why |
|-----------|--------|-----|
| `api.ts` | Remove `VITE_API_KEY` + `authHeaders`; add `credentials: "include"` to all `fetch()` calls; add `login()`, `logout()`, `precompute()`, `pollJob()` functions; add 401 dispatch via DOM event | Cookie-based auth replaces header auth |
| `routes.ts` | Add `/login` route (no Layout wrapper); wrap existing children under `ProtectedRoute` | Route protection |
| `App.tsx` | Wrap tree with `<AuthProvider>` above `<SessionProvider>` | Auth context must be available to protected routes |
| `OverUnderPage.tsx` | Add pre-compute call on file upload; render `PrecomputeStatus` while jobs run | Pre-compute integration |
| `Layout.tsx` | Add logout button in header | User can sign out |

### Unchanged Components

`DalePage`, `BlueprintPage`, `Sidebar`, `FilterBar`, `ResultsTable`, `PlayerComparisonCard`, `SessionContext`, `ThemeContext`, and all filter/modal components require no changes. The session state shape in `SessionContext.tsx` is also unchanged.

---

## Data Flow Changes

### Auth Flow

```
LoginPage
  -> calls AuthContext.login(username, password)
  -> api.ts POST /auth/login  {username, password}
  -> backend sets HttpOnly cookie "access_token"
  -> on success: AuthContext sets isAuthenticated = true
  -> ProtectedRoute now renders <Outlet />
  -> LoginPage redirects to "/"

Any protected fetch()
  -> credentials: "include" sends "access_token" cookie automatically
  -> on 401 response: api.ts dispatches window Event "auth:unauthorized"
  -> AuthContext listener sets isAuthenticated = false -> ProtectedRoute redirects /login
```

### Cookie Name and Format (confirmed from backend source)

- Cookie name: `access_token`
- HttpOnly: true
- SameSite: lax
- Secure: env-driven (`SECURE_COOKIES` setting in backend)
- The browser sends it automatically — frontend never reads the cookie value directly

### 401 Interception Pattern

`api.ts` is not a React component and cannot call `useNavigate`. The cleanest approach for this single-consumer app is a thin wrapper with a DOM event dispatch:

```typescript
async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...init,
    credentials: "include",
  });
  if (res.status === 401) {
    window.dispatchEvent(new Event("auth:unauthorized"));
  }
  return res;
}
```

`AuthContext` registers `addEventListener("auth:unauthorized", ...)` on mount and cleans it up on unmount. This decouples the API module from React navigation.

### Pre-compute Flow

```
OverUnderPage: user uploads files
  -> on file change: call api.precompute(files)
  -> backend returns { job_ids: [...], total_jobs: N }
  -> store job_ids in OverUnderPage local state (NOT SessionContext)
  -> render PrecomputeStatus with job_ids
    -> polls GET /jobs/:id every 2s until all completed or failed
    -> shows progress: X/N jobs computed
  -> user clicks Analisar (manual, at any time)
    -> calls /analyze with selected files
    -> cache_hit = true for combinations already pre-computed
```

Pre-compute state is NOT stored in `SessionContext`. Job IDs are ephemeral: a new file upload starts a new set of jobs. Keeping them in local state avoids stale polling state when user navigates away and back.

---

## Routes After Change

```typescript
export const router = createBrowserRouter([
  {
    path: "/login",
    Component: LoginPage,           // no Layout, no auth check
  },
  {
    path: "/",
    Component: ProtectedRoute,      // redirects to /login if not authenticated
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
]);
```

`ProtectedRoute` is a layout route (no `path` of its own) that wraps `Layout` so both receive the same `<Outlet />` chain.

---

## AuthContext Design

```typescript
interface AuthContextValue {
  isAuthenticated: boolean;
  isLoading: boolean;          // true during initial session probe on mount
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}
```

On mount, `AuthProvider` calls `GET /strategies` with `credentials: "include"`. If the response is 200, the cookie is valid and `isAuthenticated = true`. If 401, `isAuthenticated = false`. This avoids storing any token in `localStorage`.

The `/strategies` endpoint is already used by both analysis pages on load. It is a safe probe with no side effects. Use it as the session check until backend exposes a dedicated `/auth/me`.

`isLoading = true` during this probe. `ProtectedRoute` renders a blank (or minimal spinner) while `isLoading` is true to prevent a flash of redirect to `/login` on page refresh.

---

## api.ts Migration

### What Changes

```typescript
// REMOVE
const API_KEY = import.meta.env.VITE_API_KEY as string;
const authHeaders = { "X-API-Key": API_KEY };
```

```typescript
// ADD — central fetch wrapper with cookie + 401 dispatch
async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...init,
    credentials: "include",
  });
  if (res.status === 401) {
    window.dispatchEvent(new Event("auth:unauthorized"));
  }
  return res;
}

export async function login(username: string, password: string): Promise<void> {
  const res = await fetch(`${BASE_URL}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ username, password }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.detail ?? "Credenciais invalidas");
  }
}

export async function logout(): Promise<void> {
  await fetch(`${BASE_URL}/auth/logout`, {
    method: "POST",
    credentials: "include",
  });
}

export async function precompute(files: File[]): Promise<string[]> {
  const form = new FormData();
  files.forEach((f) => form.append("files", f));
  const res = await apiFetch("/precompute", { method: "POST", body: form });
  if (!res.ok) throw new Error("Erro ao iniciar pre-computacao");
  const data = await res.json();
  return data.job_ids as string[];
}

export async function pollJob(
  jobId: string
): Promise<{ status: string; cache_key?: string; error?: string }> {
  const res = await apiFetch(`/jobs/${jobId}`);
  if (!res.ok) throw new Error(`Job ${jobId} nao encontrado`);
  return res.json();
}
```

All existing functions (`fetchStrategies`, `analyzeFiles`, `exportResults`, `fetchBlueprint`) swap `{ headers: authHeaders }` for calls to `apiFetch(...)`. The pure utilities (`detectBet`, `exportFilteredResults`, `normalizeResult`, `extractHorariosFromFiles`) are untouched — they have no HTTP calls.

---

## Build Order (Dependency-First)

| Step | Work | Dependencies |
|------|------|-------------|
| 1 | Migrate `api.ts` — remove API key, add `apiFetch`, add `login`/`logout`/`precompute`/`pollJob` | None |
| 2 | Build `AuthContext.tsx` — state, session probe on mount, `auth:unauthorized` listener | `api.ts` step 1 |
| 3 | Build `LoginPage.tsx` — form UI, calls `AuthContext.login()`, redirects on success | `AuthContext` step 2 |
| 4 | Build `ProtectedRoute.tsx` — reads `isAuthenticated`/`isLoading`, redirects or renders `<Outlet />` | `AuthContext` step 2 |
| 5 | Update `routes.ts` — add `/login`, wrap children with `ProtectedRoute` | Steps 3 + 4 |
| 6 | Update `App.tsx` — add `<AuthProvider>` above `<SessionProvider>` | Step 2 |
| 7 | Add logout button to `Layout.tsx` — calls `AuthContext.logout()` | Step 2 |
| 8 | Build `PrecomputeStatus.tsx` — polling interval, progress display, cleanup on unmount | `api.ts` step 1 |
| 9 | Update `OverUnderPage.tsx` — call `precompute()` on file change, render `PrecomputeStatus` | Steps 1 + 8 |

Steps 1-7 are the auth chain and must run serially. Step 8 can begin after step 1. Step 9 requires steps 1 and 8 to be done.

---

## Patterns to Follow

### Session Probe (not localStorage)

The backend uses HttpOnly cookies — the frontend cannot read the token value. On page refresh, the only way to know if the session is valid is to call a protected endpoint and observe the response code. Use `GET /strategies` as the probe (no side effects, needed anyway). Store `isAuthenticated` in React state only, not `localStorage`.

### Event-Based 401 Interception

`api.ts` is a plain module with no React context. Use a custom DOM event (`auth:unauthorized`) dispatched from `apiFetch` when a 401 is received. `AuthContext` listens for this event and sets `isAuthenticated = false`, which causes `ProtectedRoute` to redirect to `/login`. This avoids importing React hooks or navigation into the API module.

### Pre-compute as Fire-and-Forget with Visible Progress

`POST /precompute` returns immediately with `job_ids`. `OverUnderPage` stores these IDs in local state (`useState`, not `SessionContext`). `PrecomputeStatus` polls every 2 seconds using `setInterval` cleared in a `useEffect` cleanup. Polling stops when all jobs reach `completed` or `failed`. The user can trigger `handleAnalyze` manually at any time regardless of polling state — if the job is done, `/analyze` returns a cache hit instantly.

---

## Anti-Patterns to Avoid

### Storing JWT in localStorage

The backend sets an HttpOnly cookie. Frontend must never extract or store the token value. `credentials: "include"` on every `fetch()` is sufficient — the browser handles cookie transmission automatically. Mirroring the token in `localStorage` creates a security downgrade and is unnecessary.

### Passing navigate() into api.ts

`api.ts` is a plain module, not a React component. Importing `useNavigate` or passing a `navigate` reference into it creates lifecycle coupling. Use the DOM event pattern to decouple 401 handling from the API layer.

### Storing Pre-compute Job IDs in SessionContext

Job IDs expire in Redis on the backend and become meaningless after a new file upload triggers new jobs. Keeping them in `SessionContext` would show stale polling state when the user navigates away and back. Keep them in `OverUnderPage` local state with a reset on file change.

### Polling Without useEffect Cleanup

Pre-compute polling must clear its `setInterval` when the component unmounts or when the file set changes (which resets jobs). Failing to do so causes `setOverUnder` calls on an unmounted component and stale closures reading old job IDs.

---

## Scalability Considerations

| Concern | Current State | After Change |
|---------|--------------|--------------|
| Auth | API key in env var, no expiry | JWT cookie with `JWT_EXPIRE_MINUTES` expiry; user sees login form again after expiry |
| Pre-compute scale | N/A | 2^N-1 jobs for N files; 5 files = 31 jobs. Polling 31 job IDs every 2s is fine for single-user |
| Session state on refresh | In-memory only, lost on refresh | Auth probe restores `isAuthenticated`; page state (files, results) still lost on refresh — acceptable per current architecture |

---

## Sources

- `esoccerdashboard/src/app/services/api.ts` — confirmed `X-API-Key` header pattern, all endpoint call sites
- `esoccerdashboard/src/app/components/SessionContext.tsx` — confirmed no auth state, PageState shape
- `esoccerdashboard/src/app/routes.ts` — confirmed all routes under single Layout, no protection
- `esoccerdashboard/src/app/App.tsx` — confirmed provider tree order (ThemeProvider > SessionProvider > RouterProvider)
- `esoccerdashboard/src/app/components/Layout.tsx` — confirmed header is the correct location for logout button
- `esoccerdashboard/src/app/components/OverUnderPage.tsx` — confirmed file change + analyze flow, local state usage pattern
- `routers/auth.py` — confirmed cookie name `access_token`, httponly, samesite=lax, POST /auth/login returns `{ access_token, token_type }`
- `routers/precompute.py` — confirmed POST /precompute returns `{ job_ids, total_jobs }`, GET /jobs/:id returns `{ status, cache_key?, error? }`
- `middleware/auth.py` — confirmed dual-mode JWT (cookie OR Bearer header), 401 detail "Nao autenticado"
- Confidence: HIGH — all conclusions drawn from reading actual source files, no training-data assumptions
