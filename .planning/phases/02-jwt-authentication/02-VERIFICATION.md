---
phase: 02-jwt-authentication
verified: 2026-04-02T16:30:00Z
status: passed
score: 5/5 must-haves verified
re_verification: false
---

# Phase 02: JWT Authentication Verification Report

**Phase Goal:** Users authenticate with username + password and receive a JWT; all protected endpoints validate the token instead of the API Key header
**Verified:** 2026-04-02T16:30:00Z
**Status:** PASSED
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | User can POST /auth/login with username + password and receive a JWT in an HttpOnly cookie and in the JSON response body (for Swagger) | VERIFIED | `routers/auth.py` L22-39: `@router.post("/login")` calls `response.set_cookie(key="access_token", httponly=True)` and returns `{"access_token": token, "token_type": "bearer"}` |
| 2 | Any request to a protected endpoint without a valid JWT receives 401 Unauthorized | VERIFIED | `routers/analysis.py` L31-35: `AuthDep = Annotated[str, Depends(verify_jwt_cookie)]` applied to all 5 protected endpoints. `middleware/auth.py` L38-39: raises `HTTPException(status_code=401)` when token absent or invalid |
| 3 | User can POST /auth/logout and the session cookie is cleared | VERIFIED | `routers/auth.py` L42-49: `@router.post("/logout")` calls `response.delete_cookie(key="access_token", httponly=True, samesite="lax")` |
| 4 | The password stored in the environment is an argon2 hash — never plaintext | VERIFIED | `requirements.txt` L13: `pwdlib[argon2]`. `middleware/auth.py` L12: `password_hash = PasswordHash.recommended()`. `config/settings.py` L22: `APP_PASSWORD_HASH: str = os.getenv("APP_PASSWORD_HASH", "")`. Password is always compared via `password_hash.verify()`, never in plaintext |
| 5 | CORS allow_origins is locked to the frontend domain (not wildcard) before cookie auth is active | VERIFIED | `main.py` L20: `allow_origins=[FRONTEND_ORIGIN]`, L23: `allow_credentials=True`. No wildcard present |

**Score:** 5/5 truths verified

---

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `requirements.txt` | pyjwt and pwdlib[argon2] declared | VERIFIED | L12: `pyjwt`, L13: `pwdlib[argon2]` |
| `config/settings.py` | JWT and auth environment variables | VERIFIED | L18-24: JWT_SECRET, ALGORITHM, JWT_EXPIRE_MINUTES, APP_USERNAME, APP_PASSWORD_HASH, FRONTEND_ORIGIN, SECURE_COOKIES. L27-30: startup validation `sys.exit(1)` if JWT_SECRET missing or < 32 chars |
| `middleware/auth.py` | JWT cookie verification dependency + password utilities | VERIFIED | Exports `verify_jwt_cookie` (dual-mode cookie+Bearer), `create_access_token`, `verify_password`, `get_password_hash`. Old `verify_api_key` fully removed |
| `.env.example` | Documentation of all required env vars | VERIFIED | All new vars documented: JWT_SECRET, APP_USERNAME, APP_PASSWORD_HASH, JWT_EXPIRE_MINUTES, FRONTEND_ORIGIN, SECURE_COOKIES |
| `routers/auth.py` | Login and logout endpoints | VERIFIED | 50 lines. `@router.post("/login")` + `@router.post("/logout")` with timing-safe credential check |
| `routers/analysis.py` | Protected endpoints using JWT instead of API Key | VERIFIED | L31: `from middleware.auth import verify_jwt_cookie`. L35: `AuthDep = Annotated[str, Depends(verify_jwt_cookie)]`. Applied to `/analyze`, `/blueprint/{cache_key}`, `/export/{cache_key}`, `/cache/status`, `/cache/{cache_key}` |
| `main.py` | App with auth router mounted and CORS locked | VERIFIED | L5: imports FRONTEND_ORIGIN. L7: imports `auth_router`. L20: `allow_origins=[FRONTEND_ORIGIN]`. L26: `app.include_router(auth_router)` |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `routers/auth.py` | `middleware/auth.py` | `from middleware.auth import create_access_token, verify_password` | WIRED | L6 in routers/auth.py |
| `routers/auth.py` | `config/settings.py` | `from config.settings import APP_USERNAME, APP_PASSWORD_HASH, JWT_EXPIRE_MINUTES, SECURE_COOKIES` | WIRED | L7-12 in routers/auth.py |
| `routers/analysis.py` | `middleware/auth.py` | `from middleware.auth import verify_jwt_cookie` | WIRED | L31 in routers/analysis.py; `verify_api_key` completely absent from all runtime source files |
| `main.py` | `config/settings.py` | `from config.settings import FRONTEND_ORIGIN` | WIRED | L5 in main.py |
| `main.py` | `routers/auth.py` | `app.include_router(auth_router)` | WIRED | L7 (import), L26 (include) in main.py |
| `middleware/auth.py` | `config/settings.py` | `from config.settings import JWT_SECRET, ALGORITHM, JWT_EXPIRE_MINUTES` | WIRED | L10 in middleware/auth.py |

---

### Data-Flow Trace (Level 4)

Not applicable — this phase produces auth infrastructure (middleware, endpoints), not data-rendering components. The login endpoint sets a cookie and returns a token; the data flow is synchronous request-response with no dynamic data rendering.

---

### Behavioral Spot-Checks

Step 7b: SKIPPED — requires a running server with JWT_SECRET configured (startup validation in `config/settings.py` calls `sys.exit(1)` if JWT_SECRET is absent, preventing the app from starting without a properly configured environment).

---

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| AUTH-01 | 02-02-PLAN.md | User can login with username + password via POST /auth/login | SATISFIED | `routers/auth.py` POST /auth/login endpoint fully implemented |
| AUTH-02 | 02-02-PLAN.md | Protected endpoints reject requests without valid token with 401 | SATISFIED | All 5 analysis endpoints use `AuthDep`; `verify_jwt_cookie` raises 401 on missing/invalid token |
| AUTH-03 | 02-02-PLAN.md | User can logout via POST /auth/logout | SATISFIED | `routers/auth.py` POST /auth/logout clears cookie |
| AUTH-04 | 02-01-PLAN.md | Password stored as hash (bcrypt in REQUIREMENTS.md, argon2 in ROADMAP.md) | SATISFIED (with documented deviation) | Uses argon2id via pwdlib — more secure than bcrypt. Plan 02-01 explicitly documented this decision: ROADMAP.md (more recent) specified argon2; bcrypt in REQUIREMENTS.md was treated as superseded |
| AUTH-05 | 02-01-PLAN.md, 02-02-PLAN.md | CORS restricted to frontend domain before enabling cookie auth | SATISFIED | `main.py` L20: `allow_origins=[FRONTEND_ORIGIN]` with `allow_credentials=True`; wildcard fully removed |

**Note on AUTH-04:** REQUIREMENTS.md says "bcrypt" but ROADMAP.md says "argon2". The implementation uses argon2id (stricter, more secure). This deviation is explicitly documented in both SUMMARY files and exceeds the security intent of the requirement. No gap.

---

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `config/settings.py` | 6-8 | `API_KEYS` variable still defined but unused in runtime | Info | Dead code — `API_KEYS` is loaded from env but never imported or used by any runtime file post-migration. Not a security issue (not checked against anything), just unused legacy state |
| `config/settings.py` | 22 | `APP_PASSWORD_HASH` defaults to empty string `""` | Info | If env var not set, `verify_password` will always fail (argon2 will reject an empty hash). The startup validation only checks `JWT_SECRET`, not `APP_PASSWORD_HASH`. A missing hash produces a runtime 500 rather than a clear startup error, but this is a deploy-time config concern, not a code defect |

No blockers found. Both items are informational.

---

### Human Verification Required

#### 1. Cookie HttpOnly flag in real browser

**Test:** POST to `/auth/login` with valid credentials from a browser. Open DevTools > Application > Cookies.
**Expected:** `access_token` cookie present with HttpOnly flag set, not readable via `document.cookie`.
**Why human:** Cannot verify browser cookie flags programmatically without a running server.

#### 2. Cross-origin cookie delivery

**Test:** Make a fetch request from the configured `FRONTEND_ORIGIN` domain to the API. Confirm the `access_token` cookie is sent automatically on subsequent requests.
**Expected:** Browser attaches the cookie without JavaScript code accessing it; CORS preflight succeeds.
**Why human:** Requires browser + two running services (frontend + API) to verify `SameSite=lax` + `allow_credentials=True` interaction.

#### 3. JWT expiry enforcement

**Test:** Set `JWT_EXPIRE_MINUTES=1` in env. Login, wait 2 minutes, make a request to `/analyze`.
**Expected:** 401 Unauthorized with detail "Token inválido ou expirado".
**Why human:** Requires waiting for real time to pass with a running server.

#### 4. Startup validation enforcement

**Test:** Start the API container without `JWT_SECRET` set (or with a value shorter than 32 chars).
**Expected:** Process exits immediately with the FATAL message on stderr, never accepts any requests.
**Why human:** Requires running the container and observing stdout/stderr.

---

### Gaps Summary

No gaps. All 5 observable truths verified. All 7 artifacts exist and are substantively implemented. All 6 key links are wired. All 5 requirements (AUTH-01 through AUTH-05) are satisfied. The `verify_api_key` function is fully removed from all runtime source files (`middleware/auth.py`, `routers/analysis.py`, `main.py`).

The only open item is AUTH-04's bcrypt vs argon2 terminology in REQUIREMENTS.md, which is an intentional upgrade (not a gap) documented in both plan summaries.

---

_Verified: 2026-04-02T16:30:00Z_
_Verifier: Claude (gsd-verifier)_
