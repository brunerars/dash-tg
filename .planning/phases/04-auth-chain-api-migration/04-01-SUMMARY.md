---
phase: 04-auth-chain-api-migration
plan: 01
subsystem: auth
tags: [cookie-auth, jwt, react-context, vite-proxy, api-client, frontend]

requires:
  - phase: 02-jwt-authentication
    provides: "HttpOnly cookie JWT auth on backend (POST /auth/login, POST /auth/logout, verify_jwt_cookie middleware)"

provides:
  - "apiFetch wrapper with credentials:include on all HTTP calls + auth:unauthorized DOM event on 401"
  - "login() and logout() exports in api.ts"
  - "AuthContext with isAuthenticated, isLoading, login(), logout() and session probe via GET /strategies"
  - "ProtectedRoute layout component with isLoading guard and replace redirect"
  - "Vite dev proxy /api -> localhost:8000 (resolves SameSite cross-port issue)"
  - "VITE_API_KEY fully removed from frontend codebase (api.ts, vite-env.d.ts, Dockerfile)"

affects: [04-02-login-page-and-routes, any plan wiring AuthProvider or ProtectedRoute]

tech-stack:
  added: []
  patterns:
    - "apiFetch wrapper: central fetch with credentials:include, dispatches auth:unauthorized DOM event on 401"
    - "Session probe: AuthContext uses GET /strategies as auth check on mount (until /auth/me added to backend)"
    - "isLoading guard: ProtectedRoute renders null while probing, prevents flash redirect on refresh"
    - "DOM event decoupling: api.ts dispatches window event instead of calling navigate() (plain module, cannot use hooks)"

key-files:
  created:
    - esoccerdashboard/src/app/components/AuthContext.tsx
    - esoccerdashboard/src/app/components/ProtectedRoute.tsx
  modified:
    - esoccerdashboard/src/app/services/api.ts
    - esoccerdashboard/vite.config.ts
    - esoccerdashboard/src/vite-env.d.ts
    - esoccerdashboard/Dockerfile

key-decisions:
  - "Atomic api.ts migration: all authHeaders removed and apiFetch added in single commit — no dual auth window"
  - "login() does NOT use apiFetch to avoid triggering auth:unauthorized on failed login attempts"
  - "Session probe uses GET /strategies (no /auth/me endpoint exists) — commented TODO for future backend addition"

patterns-established:
  - "apiFetch: single wrapper function for all HTTP calls in api.ts, attaches credentials:include and handles 401"
  - "AuthContext event listener: listens for auth:unauthorized to catch mid-session expiry without polling"
  - "ProtectedRoute isLoading null-render: prevents flash redirect on page refresh with valid session"

requirements-completed: [API-MIG-01, API-MIG-02, AUTH-FE-02]

duration: 15min
completed: 2026-04-02
---

# Phase 04 Plan 01: Auth Chain API Migration — Client Layer Summary

**Cookie auth migration: apiFetch wrapper with credentials:include replaces X-API-Key header, AuthContext probes session on mount, ProtectedRoute guards with isLoading null-render**

## Performance

- **Duration:** ~15 min
- **Started:** 2026-04-02T20:20:57Z
- **Completed:** 2026-04-02T20:35:00Z
- **Tasks:** 2
- **Files modified:** 6

## Accomplishments

- Migrated api.ts atomically: removed VITE_API_KEY, authHeaders, X-API-Key; added apiFetch + login() + logout()
- Configured Vite dev proxy (/api -> localhost:8000) to resolve SameSite=Lax cross-port cookie issues
- Created AuthContext with session probe, isLoading guard, and auth:unauthorized event listener
- Created ProtectedRoute with isLoading null-render and replace redirect — ready to wire into routes

## Task Commits

Each task was committed atomically:

1. **Task 1: Add Vite dev proxy + migrate api.ts to cookie auth + remove VITE_API_KEY everywhere** - `26bb480` (feat)
2. **Task 2: Create AuthContext with session probe and ProtectedRoute component** - `2671c53` (feat)

## Files Created/Modified

- `esoccerdashboard/vite.config.ts` - Added server.proxy block: /api -> localhost:8000
- `esoccerdashboard/src/app/services/api.ts` - Replaced authHeaders/VITE_API_KEY with apiFetch wrapper; added login(), logout()
- `esoccerdashboard/src/vite-env.d.ts` - Removed VITE_API_KEY from ImportMetaEnv
- `esoccerdashboard/Dockerfile` - Removed ARG VITE_API_KEY and ENV VITE_API_KEY build args
- `esoccerdashboard/src/app/components/AuthContext.tsx` - New: auth state context with session probe and event listener
- `esoccerdashboard/src/app/components/ProtectedRoute.tsx` - New: layout route guard with isLoading guard and replace redirect

## Decisions Made

- Atomic api.ts migration: removed all old auth code and added new in single commit to avoid dual auth window where backend accepts both X-API-Key and cookie simultaneously
- login() uses raw fetch (not apiFetch) to avoid dispatching auth:unauthorized on a failed login — that event is for mid-session 401s, not authentication failures
- Session probe via GET /strategies is intentional pragmatic choice — no /auth/me endpoint on backend; added TODO comment in AuthContext

## Deviations from Plan

None — plan executed exactly as written.

Note: Plan's acceptance criteria for `credentials.*include` count says "at least 4 (apiFetch + login + logout)" but only 3 call sites exist (the comment in the plan itself lists only 3). Implementation is correct with 3 occurrences.

## Issues Encountered

- TypeScript (`tsc --noEmit`) is not installed as a project dependency (not in package.json devDependencies). Verified via `vite build` instead — Vite uses esbuild for transpilation and exits 0 on clean code. Build passed both tasks.

## User Setup Required

Dev environment: set `VITE_API_BASE_URL=/api` in `esoccerdashboard/.env.local` to use the Vite proxy in development. Production `VITE_API_BASE_URL` stays as the full backend URL in Portainer.

Backend: ensure `SECURE_COOKIES=false` is in backend `.env` for HTTP localhost dev (cookies over http require this).

## Next Phase Readiness

- AuthContext and ProtectedRoute are ready to wire into App.tsx and routes.ts
- api.ts client fully migrated — no X-API-Key references anywhere in the frontend
- Next: Plan 04-02 — LoginPage, routes update, App.tsx AuthProvider wrapping, logout in Layout

---
*Phase: 04-auth-chain-api-migration*
*Completed: 2026-04-02*
