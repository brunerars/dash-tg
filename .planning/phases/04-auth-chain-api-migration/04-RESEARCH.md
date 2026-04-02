# Phase 4: Auth Chain + API Migration - Research

**Researched:** 2026-04-02
**Domain:** React SPA — JWT HttpOnly cookie auth migration, route protection, API client refactor
**Confidence:** HIGH

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| AUTH-FE-01 | Usuario pode fazer login com username + senha via pagina de login que chama POST /auth/login | Backend contract confirmed from `routers/auth.py`: POST /auth/login accepts `{username, password}`, sets HttpOnly cookie `access_token`, returns `{access_token, token_type}` |
| AUTH-FE-02 | Qualquer resposta 401 da API redireciona o usuario para /login | Central `apiFetch` wrapper dispatches DOM event `auth:unauthorized` on 401; `AuthContext` listener triggers redirect |
| AUTH-FE-03 | Usuario pode fazer logout via botao no layout que chama POST /auth/logout e redireciona para /login | Backend contract confirmed: POST /auth/logout deletes cookie, returns `{message}`; logout button goes in `Layout.tsx` header (existing header has only theme toggle) |
| API-MIG-01 | Todas as chamadas fetch usam credentials: "include" em vez de header X-API-Key | `api.ts` has 4 fetch call sites using `authHeaders`; central `apiFetch` wrapper replaces all of them in one commit |
| API-MIG-02 | VITE_API_KEY removido de env vars, Dockerfile build args, e vite-env.d.ts | `Dockerfile` has `ARG VITE_API_KEY` + `ENV VITE_API_KEY`; `vite-env.d.ts` has `VITE_API_KEY` in `ImportMetaEnv`; `api.ts` has `const API_KEY` + `console.log` |
</phase_requirements>

---

## Summary

Phase 4 is a pure frontend change. The backend (FastAPI + JWT cookie auth) is fully built and deployed. The goal is to replace the `X-API-Key` header pattern in `api.ts` with cookie-based auth, add a login page and route guards, wire in logout, and remove all traces of `VITE_API_KEY` from the codebase.

Zero new libraries are required. Every capability needed exists in the current dependency tree: `react-hook-form` for the login form, `fetch()` with `credentials: "include"` for cookie transmission, `react-router` nested layout routes for the route guard, and React Context for auth state. The only infrastructure change is a Vite dev proxy to resolve SameSite=Lax cross-port cookie issues in development.

The critical path is: (1) add Vite proxy, (2) migrate `api.ts` atomically removing `X-API-Key`, (3) build `AuthContext`, (4) build `LoginPage` + `ProtectedRoute`, (5) update `routes.ts` and `App.tsx`, (6) add logout to `Layout.tsx`. All steps are serial — each depends on the prior.

**Primary recommendation:** Migrate `api.ts` first (atomic commit that removes all `authHeaders` references and `VITE_API_KEY`), then build AuthContext, then UI components. Never run dual auth modes simultaneously.

---

## Standard Stack

### Core (zero new installs needed)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| react-router | 7.13.0 | Nested layout route for `ProtectedRoute`, `/login` outside guard | Already in use, pinned version |
| react-hook-form | 7.55.0 | Login form state + validation | Already in use in the project |
| native fetch() | browser | `credentials: "include"` cookie transmission | No wrapper library needed |
| React Context | 18.3.1 | `AuthContext` — `isAuthenticated`, `isLoading`, `login()`, `logout()` | Already used for `SessionContext`, `ThemeContext` |
| sonner | 2.0.3 | Toast notification for session expiry (optional polish) | Already installed |

### No New Dependencies Required

All capabilities are covered by the current dependency tree. The `package.json` already has `react-hook-form`, `@radix-ui/react-progress`, `lucide-react` (for logout icon), and `sonner` (for optional expiry toast).

**Installation:** None required.

---

## Architecture Patterns

### Current vs Target Structure

**Current:**
```
App.tsx
  ThemeProvider
    SessionProvider
      RouterProvider
        Layout (/)         <- all routes, no auth check
          HomePage (index)
          DalePage (/dale)
          OverUnderPage (/over-under)
          BlueprintPage (/blueprint/:cacheKey)
```

**Target:**
```
App.tsx
  ThemeProvider
    AuthProvider           <- NEW: owns isAuthenticated, isLoading, login(), logout()
      SessionProvider      <- unchanged
        RouterProvider
          LoginPage (/login)  <- NEW: outside Layout, no sidebar
          ProtectedRoute      <- NEW: layout route, redirects to /login
            Layout
              HomePage (index)
              DalePage (/dale)
              OverUnderPage (/over-under)
              BlueprintPage (/blueprint/:cacheKey)
```

### Pattern 1: AuthContext with isLoading Guard

**What:** React context owning auth state. Probes `GET /strategies` on mount to check cookie validity (no `/auth/me` endpoint exists on backend). `isLoading = true` until probe resolves.

**When to use:** Any component that needs to know auth state (ProtectedRoute, LoginPage, Layout logout button).

**Example:**
```typescript
// Source: architecture research + React docs
interface AuthContextValue {
  isAuthenticated: boolean;
  isLoading: boolean;        // true during initial session probe on mount
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

// On mount: probe GET /strategies with credentials: "include"
// 200 → isAuthenticated = true; 401 → isAuthenticated = false
// isLoading = false after probe resolves either way
```

### Pattern 2: ProtectedRoute as Layout Route

**What:** A layout route component (no `path`) that wraps `Layout`. Renders `null` while `isLoading`, redirects with `replace` to `/login` when `isLoading === false && isAuthenticated === false`.

**When to use:** Wrapping all routes that require authentication.

**Example:**
```typescript
// Source: react-router v7 nested route patterns
export function ProtectedRoute() {
  const { isAuthenticated, isLoading } = useAuth();
  if (isLoading) return null;   // wait — never redirect while probing
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  return <Outlet />;
}

// In routes.ts:
{
  path: "/",
  Component: ProtectedRoute,
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
}
```

### Pattern 3: Central apiFetch with DOM Event 401 Dispatch

**What:** A single `apiFetch` wrapper that attaches `credentials: "include"` to every request and dispatches `window.dispatchEvent(new Event("auth:unauthorized"))` on 401. `AuthContext` registers an event listener on mount. This decouples the API module from React navigation (api.ts is a plain module, cannot call `useNavigate`).

**When to use:** All HTTP calls in api.ts.

**Example:**
```typescript
// Source: architecture research — event-based decoupling pattern
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

### Pattern 4: Vite Dev Proxy

**What:** Proxy `/api/*` requests from Vite port 5173 to FastAPI port 8000. Makes all API calls same-origin from the browser's perspective, eliminating SameSite=Lax cookie cross-port issues in dev.

**When to use:** First action before writing any auth code.

**Example:**
```typescript
// vite.config.ts — add to existing defineConfig
server: {
  proxy: {
    "/api": {
      target: "http://localhost:8000",
      changeOrigin: true,
      rewrite: (path) => path.replace(/^\/api/, ""),
    },
  },
},
```

Set `VITE_API_BASE_URL=/api` in `.env.local` (dev only). Production `VITE_API_BASE_URL` stays as the full backend URL in Portainer.

### Recommended Project Structure (new files only)

```
esoccerdashboard/src/app/
├── components/
│   ├── AuthContext.tsx       # NEW — ~30 lines
│   ├── LoginPage.tsx         # NEW — ~60 lines
│   └── ProtectedRoute.tsx    # NEW — ~15 lines
├── services/
│   └── api.ts                # EDIT — remove authHeaders, add apiFetch + login/logout
├── routes.ts                 # EDIT — add /login, wrap with ProtectedRoute
└── App.tsx                   # EDIT — add <AuthProvider>
```

### Anti-Patterns to Avoid

- **Dual auth in flight:** Never add `credentials: "include"` without simultaneously removing `authHeaders`. Backend accepts both (API key still in env), masking broken cookie path until production.
- **localStorage for token:** Backend sets HttpOnly cookie. Frontend must never read or store the token value. Ignore `access_token` in the login response body — it is only there for Swagger.
- **Redirect while isLoading:** ProtectedRoute must render `null` (not `<Navigate>`) while `isLoading === true`. Redirecting before the probe completes kicks valid sessions to `/login` on every refresh.
- **navigate() in api.ts:** api.ts is a plain module. Pass the navigation intent via DOM event, not by importing `useNavigate` or passing a navigate reference.
- **Multiple setInterval per job:** Phase 5 concern, not Phase 4 — but pre-empt by knowing the pattern: single interval polling all job IDs per tick, not N intervals.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Login form state + validation | Custom controlled inputs + error state | `react-hook-form` (already installed) | Handles validation, error messages, submit state out of the box |
| Route protection | Manual `useEffect` redirect in each page | `ProtectedRoute` layout route component | Single place, handles isLoading guard, react-router idiom |
| Toast notifications | Custom toast component | `sonner` (already installed) | Zero setup, already used in project |
| Cookie transmission | Manual cookie reading/setting | `credentials: "include"` on fetch | Browser handles HttpOnly cookies automatically; JS cannot read them |

**Key insight:** Every primitive needed (cookie auth, route guarding, form handling) is handled by native browser APIs or already-installed libraries. The auth chain is wiring, not building.

---

## Common Pitfalls

### Pitfall 1: Residual X-API-Key After Migration — Silent Dual Auth
**What goes wrong:** Adding `credentials: "include"` without removing `authHeaders`. Backend accepts both, so everything works in dev — bug only surfaces in production after API key is removed from Portainer.
**Why it happens:** The codebase has 4 `authHeaders` call sites in `api.ts` (`fetchStrategies`, `analyzeFiles`, `exportResults`, `fetchBlueprint`). Easy to miss one.
**How to avoid:** Single atomic commit: remove `const API_KEY`, `const authHeaders`, `console.log("[API] API_KEY definida:", !!API_KEY)`, all 4 `authHeaders` references, `VITE_API_KEY` from `.env`, `Dockerfile`, and `vite-env.d.ts`.
**Warning signs:** DevTools Network shows `X-API-Key` header on any request after migration commit.

### Pitfall 2: Flash Redirect on Page Refresh
**What goes wrong:** `isAuthenticated` starts as `false`. ProtectedRoute redirects to `/login` before the `GET /strategies` probe completes.
**Why it happens:** Missing `isLoading` state in auth context.
**How to avoid:** `isLoading` starts `true`. `ProtectedRoute` renders `null` while `isLoading`. Only redirect when `isLoading === false && isAuthenticated === false`.
**Warning signs:** Hard refresh on `/dale` redirects to `/login` even with a valid session.

### Pitfall 3: SameSite=Lax Cross-Port Cookie Failure in Dev
**What goes wrong:** Vite on port 5173, FastAPI on port 8000. Login sets cookie but subsequent calls to port 8000 may not include it (browser SameSite enforcement is inconsistent cross-port).
**Why it happens:** SameSite=Lax is correct for production (same domain) but problematic for localhost cross-port dev.
**How to avoid:** Add Vite proxy (`/api` → port 8000) BEFORE writing any auth code. Update `VITE_API_BASE_URL=/api` in `.env.local`.
**Warning signs:** Login returns 200, cookie appears in DevTools Application, but next API call returns 401.

### Pitfall 4: Logout Does Not Clear Client State
**What goes wrong:** `POST /auth/logout` removes server-side cookie. If client auth state is not updated, UI stays accessible until next refresh.
**Why it happens:** HttpOnly cookies are invisible to JS — frontend cannot observe the deletion.
**How to avoid:** Await `POST /auth/logout` response. On success (2xx), set `isAuthenticated = false` and call `navigate("/login", { replace: true })`. Also reset `SessionContext` state (`dale` and `overUnder` back to `defaultPageState`) to prevent stale analysis data on next login.
**Warning signs:** Clicking logout keeps user on current page with full dashboard access.

### Pitfall 5: Back Button Loop After Auth Redirect
**What goes wrong:** `<Navigate to="/login" />` without `replace` pushes a history entry. After login, pressing back returns to the protected route redirect — which sends user to `/login` again.
**How to avoid:** Always use `<Navigate to="/login" replace />` in ProtectedRoute and `navigate("/login", { replace: true })` in logout handler.

### Pitfall 6: Login Response Token Stored in JS State
**What goes wrong:** `routers/auth.py` returns `{"access_token": token, "token_type": "bearer"}` in response body for Swagger compatibility. If the frontend stores this in React state or localStorage, XSS can steal it.
**How to avoid:** Login handler calls `POST /auth/login` and ignores the response body. The cookie is set automatically by the browser. Never `localStorage.setItem("token", ...)`.

---

## Code Examples

Verified patterns from direct backend source inspection:

### Backend Cookie Contract (from routers/auth.py)
```python
# Cookie name: "access_token"
# httponly: True
# samesite: "lax"
# secure: driven by SECURE_COOKIES env var (must be False in dev)
# max_age: JWT_EXPIRE_MINUTES * 60

response.set_cookie(
    key="access_token",
    value=token,
    httponly=True,
    secure=SECURE_COOKIES,
    samesite="lax",
    max_age=JWT_EXPIRE_MINUTES * 60,
)
```

### Backend JWT Verification (from middleware/auth.py)
```python
# Dual-mode: Cookie for browser, Bearer header for Swagger
async def verify_jwt_cookie(
    access_token: str | None = Cookie(None),
    authorization: str | None = Header(None),
) -> str:
    token = access_token
    if token is None and authorization and authorization.startswith("Bearer "):
        token = authorization.removeprefix("Bearer ")
    if token is None:
        raise HTTPException(status_code=401, detail="Não autenticado")
```

### api.ts Migration Pattern
```typescript
// REMOVE these lines:
const API_KEY = import.meta.env.VITE_API_KEY as string;
console.log("[API] API_KEY definida:", !!API_KEY);
const authHeaders = { "X-API-Key": API_KEY };

// ADD central wrapper:
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

// login does NOT use apiFetch (no 401 expected on login itself):
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
  // Do NOT read or store data.access_token — ignore response body
}

export async function logout(): Promise<void> {
  await fetch(`${BASE_URL}/auth/logout`, {
    method: "POST",
    credentials: "include",
  });
}
```

### Existing Call Sites to Migrate in api.ts
```typescript
// fetchStrategies — change { headers: authHeaders } → use apiFetch
// analyzeFiles    — change fetch(url, { method: "POST", headers: authHeaders, body: form })
//                   → apiFetch("/analyze", { method: "POST", body: form })
// exportResults   — change fetch(url, { headers: authHeaders }) → apiFetch(...)
// fetchBlueprint  — change fetch(url, { headers: authHeaders }) → apiFetch(...)
// (4 call sites total — all in api.ts, no other files have fetch calls)
```

### AuthContext with isLoading Guard
```typescript
export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    // Probe session validity — GET /strategies is the auth-protected endpoint
    // used by both analysis pages anyway; safe to call with no side effects
    fetchStrategies()
      .then(() => setIsAuthenticated(true))
      .catch(() => setIsAuthenticated(false))
      .finally(() => setIsLoading(false));

    const handleUnauthorized = () => {
      setIsAuthenticated(false);
    };
    window.addEventListener("auth:unauthorized", handleUnauthorized);
    return () => window.removeEventListener("auth:unauthorized", handleUnauthorized);
  }, []);

  const login = async (username: string, password: string) => {
    await apiLogin(username, password); // throws on failure
    setIsAuthenticated(true);
  };

  const logout = async () => {
    await apiLogout();
    setIsAuthenticated(false);
  };

  return (
    <AuthContext.Provider value={{ isAuthenticated, isLoading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}
```

### Routes After Change
```typescript
export const router = createBrowserRouter([
  {
    path: "/login",
    Component: LoginPage,        // outside ProtectedRoute, no Layout
  },
  {
    path: "/",
    Component: ProtectedRoute,   // redirects to /login if not authenticated
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

### App.tsx Change
```typescript
// Add AuthProvider above SessionProvider:
export default function App() {
  return (
    <ThemeProvider>
      <AuthProvider>           {/* NEW */}
        <SessionProvider>
          <RouterProvider router={router} />
        </SessionProvider>
      </AuthProvider>
    </ThemeProvider>
  );
}
```

---

## Files to Change: Complete Inventory

| File | Change Type | What Changes |
|------|-------------|--------------|
| `esoccerdashboard/vite.config.ts` | Edit | Add `server.proxy` block |
| `esoccerdashboard/.env.local` | Create | `VITE_API_BASE_URL=/api` (dev only, gitignored) |
| `esoccerdashboard/src/app/services/api.ts` | Edit | Remove `API_KEY`, `authHeaders`, all console.logs; add `apiFetch`, `login()`, `logout()` |
| `esoccerdashboard/src/vite-env.d.ts` | Edit | Remove `VITE_API_KEY` from `ImportMetaEnv` |
| `esoccerdashboard/Dockerfile` | Edit | Remove `ARG VITE_API_KEY` and `ENV VITE_API_KEY` |
| `esoccerdashboard/src/app/components/AuthContext.tsx` | Create | New — auth state, session probe, event listener |
| `esoccerdashboard/src/app/components/LoginPage.tsx` | Create | New — login form using react-hook-form |
| `esoccerdashboard/src/app/components/ProtectedRoute.tsx` | Create | New — isLoading guard + Navigate redirect |
| `esoccerdashboard/src/app/routes.ts` | Edit | Add `/login`, wrap with `ProtectedRoute` |
| `esoccerdashboard/src/app/App.tsx` | Edit | Add `<AuthProvider>` above `<SessionProvider>` |
| `esoccerdashboard/src/app/components/Layout.tsx` | Edit | Add logout button to header (alongside existing theme toggle) |

**Unchanged files:** `SessionContext.tsx`, `DalePage.tsx`, `BlueprintPage.tsx`, `OverUnderPage.tsx`, all filter/table components, `Sidebar.tsx`. `OverUnderPage.tsx` changes only in Phase 5.

---

## Environment Availability

Phase 4 is frontend-only. External dependencies are Vite (dev) and the backend API (already deployed).

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | Vite build | Check at execution time | — | — |
| Backend API (port 8000) | Auth probe on mount | Running (Phase 3 complete) | — | SECURE_COOKIES=false must be set in dev .env |
| React 18 | AuthContext, components | Confirmed in package.json (peerDependencies) | 18.3.1 | — |
| react-hook-form | LoginPage | Confirmed in package.json | 7.55.0 | — |
| react-router | ProtectedRoute | Confirmed in package.json | 7.13.0 | — |

**Pre-flight checklist for dev environment:**
- Backend `.env` must have `SECURE_COOKIES=false` — required for cookies over `http://` in local dev
- Vite proxy must be added before first cookie test — SameSite cross-port issue will make auth appear broken otherwise

---

## Build Order (Dependency-First)

| Step | Work | Dependencies | Files |
|------|------|-------------|-------|
| 1 | Add Vite proxy | None | `vite.config.ts`, `.env.local` |
| 2 | Migrate `api.ts` + remove VITE_API_KEY everywhere | Step 1 proxy active | `api.ts`, `vite-env.d.ts`, `Dockerfile` |
| 3 | Build `AuthContext.tsx` | Step 2 (`apiFetch`, `login`, `logout` exported) | `AuthContext.tsx` |
| 4 | Build `LoginPage.tsx` | Step 3 (`useAuth()` available) | `LoginPage.tsx` |
| 5 | Build `ProtectedRoute.tsx` | Step 3 (`useAuth()` available) | `ProtectedRoute.tsx` |
| 6 | Update `routes.ts` | Steps 4 + 5 | `routes.ts` |
| 7 | Update `App.tsx` | Step 3 | `App.tsx` |
| 8 | Add logout to `Layout.tsx` | Step 3 | `Layout.tsx` |

Steps 4 and 5 can run in parallel after Step 3 is complete. Steps 6, 7, 8 require Step 3 and their respective UI components.

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| X-API-Key header | HttpOnly cookie + JWT | Phase 2 (backend) | Frontend must switch from header to `credentials: "include"` |
| Wildcard CORS | Origin-restricted CORS with `allow_credentials=True` | Phase 2 (backend) | `FRONTEND_ORIGIN` must be set correctly in Portainer |
| All routes unprotected | ProtectedRoute layout wrapper | Phase 4 (this phase) | New login page required |

**Deprecated/removed in this phase:**
- `VITE_API_KEY` env var: remove from `.env`, `.env.example` (if exists), `Dockerfile`, `vite-env.d.ts`
- `authHeaders` object: remove from `api.ts`
- `console.log("[API] API_KEY definida:", !!API_KEY)`: remove from `api.ts`

---

## Open Questions

1. **No `/auth/me` endpoint**
   - What we know: Backend has no dedicated auth-check endpoint. `GET /strategies` is used as probe (confirmed in STATE.md and ARCHITECTURE.md).
   - What's unclear: If backend adds `/auth/me` later, probe should be updated.
   - Recommendation: Use `GET /strategies` as probe. Comment in `AuthContext.tsx` that this is a temporary probe until `/auth/me` is added. Non-blocking.

2. **SECURE_COOKIES value in dev**
   - What we know: `SECURE_COOKIES` is read from env in `config/settings.py`. Must be `false` for HTTP localhost dev.
   - What's unclear: Whether the backend dev `.env` currently has this set.
   - Recommendation: Verify `SECURE_COOKIES=false` is in backend `.env` before first cookie test. Document in plan as a pre-execution checklist item.

3. **SessionContext reset on logout**
   - What we know: `SessionContext` holds `dale` and `overUnder` `PageState` (files, results, filters). These are in-memory only.
   - What's unclear: Product decision — should analysis state persist for the user between logout/login within the same browser session?
   - Recommendation: Reset `dale` and `overUnder` to `defaultPageState` on logout. Single-user app, no identified need to preserve state across sessions.

---

## Project Constraints (from CLAUDE.md)

| Directive | Impact on Phase 4 |
|-----------|-------------------|
| Stack: FastAPI + Redis — manter stack existente | Phase 4 is frontend only — no backend changes |
| Deploy: Docker Compose na VPS | Dockerfile must have `VITE_API_KEY` removed; `VITE_API_BASE_URL` stays as build arg |
| Compatibilidade: Frontend existente consome API | Auth migration replaces X-API-Key with cookie — must be done atomically (no period where both are required) |
| GSD Workflow Enforcement | Phase 4 is a planned phase — use `/gsd:execute-phase` |

---

## Sources

### Primary (HIGH confidence)
- `esoccerdashboard/src/app/services/api.ts` — confirmed 4 fetch call sites using `authHeaders`, `VITE_API_KEY` usage pattern
- `esoccerdashboard/src/app/routes.ts` — confirmed all routes under single `Layout`, no protection
- `esoccerdashboard/src/app/App.tsx` — confirmed provider tree: `ThemeProvider > SessionProvider > RouterProvider`
- `esoccerdashboard/src/app/components/Layout.tsx` — confirmed header structure (theme toggle only; logout goes alongside it)
- `esoccerdashboard/src/app/components/SessionContext.tsx` — confirmed `PageState` shape, `defaultPageState` for reset on logout
- `esoccerdashboard/src/vite-env.d.ts` — confirmed `VITE_API_KEY` in `ImportMetaEnv`
- `esoccerdashboard/Dockerfile` — confirmed `ARG VITE_API_KEY` + `ENV VITE_API_KEY` to remove
- `esoccerdashboard/vite.config.ts` — confirmed no proxy config exists yet
- `esoccerdashboard/package.json` — confirmed all required libraries present at pinned versions
- `routers/auth.py` — confirmed cookie name `access_token`, `httponly=True`, `samesite="lax"`, `POST /auth/logout` deletes cookie
- `middleware/auth.py` — confirmed dual-mode JWT (cookie OR Bearer), 401 detail "Não autenticado"
- `main.py` — confirmed CORS `allow_origins=[FRONTEND_ORIGIN]`, `allow_credentials=True`
- `.planning/research/ARCHITECTURE.md` — full component boundary map, data flow, build order
- `.planning/research/PITFALLS.md` — 14 catalogued pitfalls with prevention strategies
- `.planning/research/SUMMARY.md` — executive summary of frontend integration approach

### Secondary (MEDIUM confidence)
- React Router v7 nested route protection pattern — consistent with v6 docs, verified against react-router 7.13.0 API
- SameSite=Lax cross-port behavior — documented in browser specs, Vite proxy as universal mitigation
- Auth context `isLoading` guard pattern — documented in auth0-react issue tracker and React community guides

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all libraries confirmed from `package.json` at pinned versions; zero training-data assumptions
- Architecture: HIGH — all conclusions from reading actual source files; target architecture derived from current state + backend contracts
- Pitfalls: HIGH — critical pitfalls verified against codebase (4 fetch call sites confirmed, cross-port issue confirmed by absence of Vite proxy, etc.)
- Backend contracts: HIGH — read directly from `routers/auth.py`, `middleware/auth.py`, `main.py`

**Research date:** 2026-04-02
**Valid until:** 2026-05-02 (stable stack — react-router, react-hook-form are pinned versions)
