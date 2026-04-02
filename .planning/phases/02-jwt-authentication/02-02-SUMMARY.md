---
phase: 02-jwt-authentication
plan: "02"
subsystem: auth
tags: [jwt, fastapi, cookie, cors, httponly, python]

# Dependency graph
requires:
  - phase: 02-01
    provides: "JWT utility functions (create_access_token, verify_jwt_cookie, verify_password) and env var definitions in settings.py"
provides:
  - "POST /auth/login endpoint: validates credentials, sets HttpOnly cookie + returns token in JSON body"
  - "POST /auth/logout endpoint: clears access_token cookie"
  - "All analysis endpoints protected by JWT cookie (verify_jwt_cookie replaces verify_api_key)"
  - "CORS locked to FRONTEND_ORIGIN with allow_credentials=True"
  - "Swagger UI Bearer auth support via HTTPBearer scheme"
affects:
  - frontend-integration
  - phase-03-precompute

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Timing-safe auth: verify_password runs even on wrong username to prevent side-channel"
    - "Dual-mode JWT: HttpOnly cookie for browser, Bearer header for Swagger UI"
    - "CORS with allow_credentials=True required for cross-origin cookie delivery"

key-files:
  created:
    - routers/auth.py
  modified:
    - routers/analysis.py
    - main.py

key-decisions:
  - "Timing-safe login: verify_password always called, even on wrong username, to prevent timing oracle attacks"
  - "samesite=lax chosen over strict: allows normal browser navigation while protecting against CSRF"
  - "version bumped to 2.0.0: auth mechanism fully replaced (breaking change)"

patterns-established:
  - "Auth router pattern: prefix=/auth, tags=[auth], imports from middleware.auth"
  - "CORS locked pattern: allow_origins=[FRONTEND_ORIGIN], allow_credentials=True — never wildcard with credentials"

requirements-completed:
  - AUTH-01
  - AUTH-02
  - AUTH-03
  - AUTH-05

# Metrics
duration: 2min
completed: 2026-04-02
---

# Phase 02 Plan 02: JWT Auth Router + CORS Lockdown Summary

**Login/logout endpoints with HttpOnly JWT cookie, all protected routes migrated from X-API-Key to JWT verification, and CORS locked to FRONTEND_ORIGIN**

## Performance

- **Duration:** ~2 min
- **Started:** 2026-04-02T15:58:18Z
- **Completed:** 2026-04-02T15:59:08Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments

- Created `routers/auth.py` with POST /auth/login (HttpOnly cookie + JSON body) and POST /auth/logout (cookie clear)
- Replaced `verify_api_key` with `verify_jwt_cookie` in all analysis endpoints — X-API-Key auth fully removed
- Locked CORS to `FRONTEND_ORIGIN` with `allow_credentials=True` and mounted auth router in main.py

## Task Commits

Each task was committed atomically:

1. **Task 1: Create auth router with login and logout** - `ec7d5d3` (feat)
2. **Task 2: Wire JWT auth into analysis router and update main.py CORS** - `3ee3f9f` (feat)

**Plan metadata:** (docs commit follows)

## Files Created/Modified

- `routers/auth.py` - New auth router: login (set HttpOnly cookie + return token) and logout (clear cookie)
- `routers/analysis.py` - Changed AuthDep from verify_api_key to verify_jwt_cookie
- `main.py` - Mounted auth router, CORS locked to FRONTEND_ORIGIN, added HTTPBearer for Swagger, bumped to v2.0.0

## Decisions Made

- Timing-safe login: `verify_password` is always called even when username doesn't match to prevent timing oracle attacks
- `samesite="lax"` chosen (not `strict`) to allow normal navigation/deep-links while protecting against CSRF
- Version bumped to 2.0.0 since the auth mechanism is a breaking change (X-API-Key clients will get 401)

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

The following environment variables must be configured in Portainer before deploying:

| Variable | How to get value |
|----------|-----------------|
| `JWT_SECRET` | `openssl rand -hex 32` |
| `APP_USERNAME` | Choose a username (default: admin) |
| `APP_PASSWORD_HASH` | `python -c "from pwdlib import PasswordHash; print(PasswordHash.recommended().hash('YOUR_PASSWORD'))"` |
| `FRONTEND_ORIGIN` | Frontend URL, e.g. `https://dashboard.seudominio.com.br` |
| `JWT_EXPIRE_MINUTES` | Token expiry in minutes (default: 720 = 12h) |
| `SECURE_COOKIES` | `true` for production (HTTPS), `false` for local dev |

## Next Phase Readiness

- Phase 2 (JWT auth) is complete: login/logout endpoints live, all protected routes require valid JWT
- Phase 3 (async pre-computation of Over/Under combinations) can proceed — auth layer is now stable
- Blocker note: FRONTEND_ORIGIN must be configured before deploying to production; default `http://localhost:3000` is dev-only

---
*Phase: 02-jwt-authentication*
*Completed: 2026-04-02*
