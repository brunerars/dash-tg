# Technology Stack

**Project:** dash-tg — Melhorias v2 (async pre-computation, auth migration, filter removal)
**Researched:** 2026-04-02
**Scope:** Additive libraries only — existing FastAPI + Redis + pandas stack unchanged

---

## Context

This is a brownfield FastAPI + Redis project. Three features are being added:

1. **Async pre-computation** of all 2^n-1 file combinations for Over/Under strategy
2. **Filter removal** from backend (min_jogos, min_green_pct move to frontend) — no new library needed
3. **Single-user login/password auth** replacing API Key header auth

The existing stack (FastAPI, pandas, openpyxl, redis-py, uvicorn) stays intact. Only net-new dependencies are introduced.

---

## Recommended Stack

### Feature 1: Async Background Task Queue

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| SAQ | 0.26.3 | Async task queue backed by Redis | Actively maintained (Mar 2026), built on asyncio, uses Redis as sole broker — no new infra. Worker runs as second process in Docker Compose. Sub-5ms job pickup via BLMOVE (no polling). Includes optional web UI. |

**Why SAQ over alternatives:**

- **vs FastAPI BackgroundTasks (built-in):** Built-in tasks run in-process and have no persistence. If the API container restarts mid-computation, all enqueued combinations are lost. For 150k-row datasets and up to 7 combinations per upload, this is unacceptable. Rule out.
- **vs ARQ 0.27.0:** ARQ is in explicit "maintenance-only" mode (confirmed GitHub issue #437). The ARQ maintainer moved it under `python-arq` org and stated no new features. SAQ is ARQ's spiritual successor — same Redis-only broker model, same asyncio-native design, actively developed, lower latency, built-in job status API, and an optional monitoring UI. SAQ's comparison docs explicitly list improvements over ARQ. Prefer SAQ.
- **vs Celery:** Celery is synchronous at its core — async support is bolted on. Requires a second broker (Redis or RabbitMQ) AND a result backend. Heavy for a single-VPS single-user app. Adds broker/worker operational complexity that is not justified here. Rule out.
- **vs RQ:** Synchronous, no asyncio support. Rule out.

**Installation:**

```bash
pip install "saq[redis]"
```

**Worker deployment pattern (Docker Compose):**

Add a `worker` service to `docker-compose.yml` that runs `python -m saq worker_settings.WorkerSettings`. The worker shares the same Redis service — no extra infra.

**Job status tracking pattern:**

SAQ enqueue returns a `Job` object with an `.id`. The API stores `precompute:{upload_id}` metadata in Redis (JSON hash: `{status, combinations_total, combinations_done, results_keys[]}`). The frontend polls `GET /precompute/status/{upload_id}`. Worker updates the Redis hash after each combination completes.

This pattern avoids coupling the status store to SAQ internals — the frontend gets deterministic progress without depending on SAQ's internal job model.

**Confidence:** MEDIUM-HIGH — SAQ version and features verified via PyPI (0.26.3, Mar 2026) and official docs. ARQ maintenance-only status verified via GitHub. The specific "store progress metadata directly in Redis" pattern is inferred from common FastAPI + Redis patterns, not a specific authoritative source for this project's use case.

---

### Feature 3: Single-User Login/Password Auth

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| PyJWT | 2.12.1 | JWT token generation and verification | FastAPI officially migrated docs from python-jose to PyJWT (PR #11589). python-jose is abandoned (last release 2021, 8 security warnings). PyJWT is production/stable, actively maintained (2.12.1 released Mar 2026), focuses on exactly what is needed. |
| pwdlib | 0.3.0 | Password hashing | FastAPI docs migrated from passlib to pwdlib. passlib breaks on Python 3.13+. pwdlib wraps battle-tested argon2-cffi/bcrypt implementations, actively maintained (0.3.0 released Oct 2025). Use argon2 algorithm (current OWASP recommended). |
| starsessions | 2.2.1 | Redis-backed server-side sessions | Stores session ID in httponly cookie, session data in Redis. Supports Redis backend natively. The session ID in cookie = opaque token; all state stays server-side. Last release Oct 2024. |

**Auth architecture decision — JWT vs sessions:**

Two viable patterns exist for single-user FastAPI auth without a database:

- **JWT in httponly cookie:** Login endpoint issues a signed JWT (PyJWT), stored in httponly+Secure+SameSite=Lax cookie. No server-side state. Logout is client-side (cookie deletion). Cannot revoke a token server-side without a Redis blocklist.
- **Session ID in cookie + Redis session store:** Login stores session data in Redis with TTL; cookie holds an opaque UUID. Logout deletes the Redis key — true server-side invalidation. Requires starsessions or equivalent.

**Recommendation: JWT in httponly cookie (no starsessions needed).**

Rationale: Single-user system with no revocation requirement. If the user logs out, they delete the cookie. Redis blocklist adds complexity for zero benefit here. PyJWT alone is sufficient — no starsessions dependency. The existing Redis instance is not needed for sessions.

Drop starsessions from the dependencies unless revocation becomes a requirement.

**Revised minimal auth stack:**

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| PyJWT | 2.12.1 | JWT sign/verify | See above |
| pwdlib[argon2] | 0.3.0 | Hash stored password | See above |

**Implementation pattern:**

```python
# config/settings.py — add:
AUTH_USERNAME = os.getenv("AUTH_USERNAME")
AUTH_PASSWORD_HASH = os.getenv("AUTH_PASSWORD_HASH")  # pre-hashed with pwdlib
JWT_SECRET = os.getenv("JWT_SECRET")  # random 32+ byte hex
JWT_ALGORITHM = "HS256"
JWT_EXPIRE_HOURS = 24

# POST /auth/login — verifies password, returns JWT in httponly cookie
# GET /auth/logout — clears cookie
# Dependency: verify_session() replaces verify_api_key() on protected routes
#   reads JWT from cookie, validates signature and expiry
```

The existing `verify_api_key` dependency in `middleware/auth.py` is replaced by `verify_session`. Backward-compat: keep API Key auth on routes that the existing frontend calls until the frontend migrates. Both dependencies can coexist during transition.

**Confidence:** HIGH — PyJWT version confirmed via PyPI (2.12.1, Mar 2026). pwdlib version confirmed via PyPI (0.3.0, Oct 2025). FastAPI doc migration to both confirmed via official PRs. JWT-in-httponly-cookie pattern is well-documented in FastAPI ecosystem.

---

### Feature 2: Filter Removal (no new library)

Moving `min_jogos` and `min_green_pct` filters from `routers/analysis.py` to the frontend requires no new backend dependency. The pipeline already computes metrics for all groups — the filter is a single `df[df[...] >= threshold]` call that gets removed. The response payload grows (more rows returned), but the serialization path is unchanged.

**Confidence:** HIGH — this is a code deletion, not an addition.

---

## Alternatives Considered

| Category | Recommended | Alternative | Why Not |
|----------|-------------|-------------|---------|
| Task queue | SAQ 0.26.3 | ARQ 0.27.0 | ARQ is maintenance-only; SAQ is its active successor |
| Task queue | SAQ 0.26.3 | Celery | Synchronous core, requires extra broker, overengineered for single-VPS single-user |
| Task queue | SAQ 0.26.3 | FastAPI BackgroundTasks | No persistence, lost on restart, no status tracking |
| JWT library | PyJWT 2.12.1 | python-jose | Abandoned since 2021, 8 CVEs, FastAPI removed from docs |
| Password hashing | pwdlib 0.3.0 | passlib | Breaks Python 3.13+, unmaintained |
| Session store | (none) | starsessions | Unnecessary complexity for single-user JWT auth |
| Session store | (none) | fastapi-users | Full multi-user framework — overkill for one hardcoded user |

---

## Full Dependency Delta

Only these packages are added to `requirements.txt`:

```
# Async task queue (pre-computation feature)
saq[redis]>=0.26.3

# Auth (login/password feature)
PyJWT>=2.12.1
pwdlib[argon2]>=0.3.0
```

All other existing dependencies (fastapi, pandas, openpyxl, redis, uvicorn, python-multipart, python-dotenv) remain unchanged.

---

## Environment Variable Delta

```env
# Auth — add to .env
AUTH_USERNAME=admin
AUTH_PASSWORD_HASH=<generated with pwdlib at setup>
JWT_SECRET=<random 64-char hex>
JWT_EXPIRE_HOURS=24

# Pre-computation worker — no new vars; uses existing REDIS_URL
# Optional: PRECOMPUTE_TTL=86400  (default same as CACHE_TTL_ANALYSIS)
```

---

## Docker Compose Delta

```yaml
services:
  api:
    # ... unchanged

  worker:
    build: .
    command: python -m saq worker_settings.WorkerSettings
    env_file: .env
    depends_on:
      - redis
    restart: unless-stopped

  redis:
    # ... unchanged
```

The worker service uses the same Docker image as the API — no new Dockerfile needed. It shares the Redis instance via `REDIS_URL`.

---

## Sources

- ARQ PyPI (0.27.0, Feb 2026): https://pypi.org/project/arq/
- ARQ maintenance-only discussion: https://github.com/python-arq/arq/issues/437
- SAQ PyPI (0.26.3, Mar 2026): https://pypi.org/project/saq/
- SAQ docs: https://saq-py.readthedocs.io/en/latest/
- SAQ GitHub (tobymao/saq): https://github.com/tobymao/saq
- SAQ vs ARQ comparison: https://davidmuraya.com/blog/fastapi-background-tasks-arq-vs-built-in/
- PyJWT PyPI (2.12.1, Mar 2026): https://pypi.org/project/PyJWT/
- FastAPI JWT migration to PyJWT: https://github.com/fastapi/fastapi/pull/11589
- python-jose abandonment discussion: https://github.com/fastapi/fastapi/discussions/11345
- pwdlib PyPI (0.3.0, Oct 2025): https://pypi.org/project/pwdlib/
- pwdlib introduction: https://www.francoisvoron.com/blog/introducing-pwdlib-a-modern-password-hash-helper-for-python
- passlib/pwdlib FastAPI discussion: https://github.com/fastapi/fastapi/discussions/11773
- starsessions PyPI (2.2.1, Oct 2024): https://pypi.org/project/starsessions/
- FastAPI official security docs: https://fastapi.tiangolo.com/tutorial/security/oauth2-jwt/
- ARQ docs: https://arq-docs.helpmanual.io/
