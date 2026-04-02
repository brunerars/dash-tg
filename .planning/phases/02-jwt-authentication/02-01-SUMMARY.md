---
phase: 02-jwt-authentication
plan: "01"
subsystem: auth
tags: [jwt, pyjwt, pwdlib, argon2, fastapi, redis, python]

# Dependency graph
requires: []
provides:
  - pyjwt and pwdlib[argon2] declared as project dependencies
  - JWT and auth environment variables in config/settings.py (JWT_SECRET, ALGORITHM, JWT_EXPIRE_MINUTES, APP_USERNAME, APP_PASSWORD_HASH, FRONTEND_ORIGIN, SECURE_COOKIES)
  - Startup validation: application refuses to start if JWT_SECRET is empty or shorter than 32 chars
  - middleware/auth.py exports verify_jwt_cookie (dual-mode cookie+Bearer), create_access_token, verify_password, get_password_hash
  - Old API Key auth (verify_api_key) fully removed from middleware
affects:
  - 02-02 (jwt-login-endpoint) — imports verify_jwt_cookie, create_access_token, verify_password from middleware/auth.py
  - Any future phase touching authentication

# Tech tracking
tech-stack:
  added:
    - pyjwt (JWT encoding/decoding)
    - pwdlib[argon2] (argon2id password hashing, FastAPI recommended)
  patterns:
    - Dual-mode JWT verification: HttpOnly cookie (browser sessions) + Authorization Bearer header (Swagger UI)
    - Fail-fast startup validation for security-critical env vars
    - Portuguese error messages for HTTP exceptions (consistent with codebase)

key-files:
  created: []
  modified:
    - requirements.txt
    - config/settings.py
    - middleware/auth.py
    - .env.example

key-decisions:
  - "Used argon2 (pwdlib) over bcrypt: more secure, official FastAPI recommendation, per ROADMAP.md (overrides REQUIREMENTS.md mention of bcrypt)"
  - "Dual-mode JWT verification: Cookie for browser, Bearer header for Swagger UI — both handled in single verify_jwt_cookie dependency"
  - "sys.exit(1) at module import time for missing/short JWT_SECRET — fail fast before uvicorn starts serving"

patterns-established:
  - "JWT auth dependency: async def verify_jwt_cookie(...) used as FastAPI Depends() in routes"
  - "Settings validation at import time: check env var and exit(1) with clear message if invalid"

requirements-completed:
  - AUTH-04
  - AUTH-05

# Metrics
duration: 2min
completed: 2026-04-02
---

# Phase 02 Plan 01: JWT Authentication Infrastructure Summary

**JWT auth infrastructure with pwdlib argon2id password hashing, dual-mode cookie+Bearer JWT verification, and fail-fast startup validation for JWT_SECRET**

## Performance

- **Duration:** 2 min
- **Started:** 2026-04-02T15:55:08Z
- **Completed:** 2026-04-02T15:57:00Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments
- Added pyjwt and pwdlib[argon2] to requirements.txt
- Added all JWT/auth environment variables to config/settings.py with startup validation that kills the process if JWT_SECRET is missing or too short
- Replaced entire middleware/auth.py: removed verify_api_key (API Key auth), added verify_jwt_cookie (dual-mode cookie+Bearer), create_access_token, verify_password, get_password_hash

## Task Commits

Each task was committed atomically:

1. **Task 1: Add dependencies and auth settings** - `3d80fca` (feat)
2. **Task 2: Replace middleware/auth.py with JWT cookie verification** - `3cb8c02` (feat)

**Plan metadata:** (docs commit follows)

## Files Created/Modified
- `requirements.txt` - Added pyjwt and pwdlib[argon2] dependencies
- `config/settings.py` - Added JWT_SECRET, ALGORITHM, JWT_EXPIRE_MINUTES, APP_USERNAME, APP_PASSWORD_HASH, FRONTEND_ORIGIN, SECURE_COOKIES; added startup validation
- `middleware/auth.py` - Full replacement: JWT cookie+bearer dual-mode auth replacing old API Key auth
- `.env.example` - Documented all new JWT auth environment variables

## Decisions Made
- Used argon2 (pwdlib) over bcrypt: ROADMAP.md specified argon2, which is more secure and the official FastAPI recommendation. REQUIREMENTS.md mentioned bcrypt but ROADMAP.md is more recent.
- Dual-mode verification (Cookie + Bearer header) in a single `verify_jwt_cookie` dependency makes Swagger UI testing work without browser session cookies.
- sys.exit(1) at module import rather than runtime exception ensures the process never starts serving requests without a proper JWT_SECRET configured.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

Plan 02-02 will wire verify_jwt_cookie into routes and add the /login endpoint. Before deploying, the following env vars must be set in Portainer:

- `JWT_SECRET` — generate with `openssl rand -hex 32`
- `APP_USERNAME` — desired login username (default: admin)
- `APP_PASSWORD_HASH` — argon2id hash generated via `python -c "from pwdlib import PasswordHash; print(PasswordHash.recommended().hash('your_password'))"`
- `FRONTEND_ORIGIN` — actual frontend domain for CORS
- `JWT_EXPIRE_MINUTES` — session duration in minutes (default: 720 = 12h)
- `SECURE_COOKIES` — set to `true` in production (requires HTTPS)

## Next Phase Readiness
- All building blocks ready for Plan 02-02: verify_jwt_cookie, create_access_token, verify_password, get_password_hash are exported from middleware/auth.py
- Plan 02-02 must update routers/analysis.py to swap `verify_api_key` references for `verify_jwt_cookie`, and add the /login and /logout endpoints
- Note: existing routes still reference the old `verify_api_key` — they will break until Plan 02-02 repletes wiring. This is expected — Plan 02-01 is infrastructure only.

---
*Phase: 02-jwt-authentication*
*Completed: 2026-04-02*

## Self-Check: PASSED

- FOUND: requirements.txt
- FOUND: config/settings.py
- FOUND: middleware/auth.py
- FOUND: .env.example
- FOUND: 02-01-SUMMARY.md
- FOUND: commit 3d80fca
- FOUND: commit 3cb8c02
