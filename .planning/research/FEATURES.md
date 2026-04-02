# Feature Landscape

**Domain:** Async task processing + auth for a single-user analytics API dashboard (FastAPI + Redis + pandas)
**Researched:** 2026-04-02
**Milestone scope:** 3 targeted improvements — async pre-computation of spreadsheet combinations, removal of backend filters, single-user login/password authentication

---

## Table Stakes

Features users expect. Missing = product feels incomplete or broken.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Job status endpoint (`GET /jobs/{job_id}`) | User submits N files and walks away. Without status, they have no idea if computation is running, done, or crashed. | Medium | Must return: `pending`, `running`, `completed`, `failed` + error message on failure. Stores state in Redis under `job:{job_id}`. |
| All combinations auto-triggered on upload | The stated core value is "user uploads files and already finds all results computed." If combinations require separate manual calls, the value prop breaks. | Medium | Upload endpoint enqueues all 2^N-1 combinations immediately. Returns `job_ids` list. |
| Non-blocking upload response | Upload must return immediately (< 200ms). Computation at 150k rows × 7 combinations takes seconds to minutes. Blocking upload means timeouts and broken UX. | Low | `POST /analyze` returns `202 Accepted` with job IDs, not the result. |
| Combination results retrievable by cache key | Once a job completes, frontend needs to retrieve results the same way it does today — by `cache_key`. API must be backward-compatible. | Low | On completion, job stores result under existing `analysis:{cache_key}` prefix. `GET /jobs/{job_id}` returns `cache_key` when status is `completed`. |
| Password login endpoint (`POST /auth/login`) | Replacing API Key auth means a login endpoint is required. Without it there is no way to get a token. | Low | Returns a short-lived token (JWT or opaque session token stored in Redis). |
| Token validation on protected endpoints | Every protected endpoint must reject requests with invalid or expired tokens. Behavior users expect from any login-protected API. | Low | FastAPI `Depends()` dependency, same pattern as the existing `verify_api_key`. |
| Logout endpoint (`POST /auth/logout`) | Single-user system — user must be able to invalidate their session. Without this, the only option is token expiry. | Low | For JWT: blacklist token in Redis. For opaque token: delete key from Redis. |
| Filters removed from backend response | Explicitly in project scope. Frontend cannot filter data that was never sent. All rows above 0 entries must be returned. | Low | Remove `min_jogos` and `min_green_pct` filter step from pipeline. Return full metrics DataFrame. |
| Password stored as bcrypt hash | Storing plaintext password in `.env` is a security gap. Even for single-user. | Low | Use `pwdlib` (passlib is unmaintained as of 2025) with bcrypt. Hash stored in env or config at startup. |

---

## Differentiators

Features that go beyond the minimum and add real value for this specific product.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Bulk job status endpoint (`GET /jobs/status?ids=id1,id2,...`) | When N=3 files produce 7 jobs, polling 7 endpoints separately is wasteful. A single bulk check reduces frontend round-trips and simplifies progress rendering. | Low | Returns a map of `{job_id: status}`. Reads from Redis with pipeline for efficiency. |
| Per-combination progress in upload response | Upload response includes which specific combinations were enqueued (`[A], [B], [C], [A,B], [A,C], [B,C], [A,B,C]`) with their `job_id` and pre-computed `cache_key`. Frontend can immediately attempt cache hits for combinations already computed in a prior session. | Low-Medium | `cache_key` for each combination is deterministic (MD5 of sorted file bytes + strategy). Frontend can poll or skip if already cached. |
| Job queue bounded by Redis TTL | Jobs that never get picked up (worker crash, deploy) auto-expire from Redis instead of accumulating stale state forever. | Low | Set `job:{job_id}` with TTL equal to longest expected computation time + buffer (e.g., 2h). |
| Configurable token expiry via env var | `TOKEN_TTL_SECONDS=3600` in `.env`. Allows tuning session lifetime without code change. Consistent with existing `CACHE_TTL_ANALYSIS` pattern in the project. | Low | Aligns with project constraint "keep infrastructure simple." |

---

## Anti-Features

Features to explicitly NOT build in this milestone.

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| Multi-user / registration system | Out of scope per PROJECT.md. Single client. Adding user management means a database, password reset flows, and role management — weeks of scope creep. | Hard-code one username/password hash in env config. |
| OAuth2 / social login | Unnecessary for a single internal user. OAuth requires callback URLs, external provider dependencies, and redirect flows that don't fit a backend-only API. | Simple `POST /auth/login` with username+password form. |
| Pre-computation for eSoccer — Dupla strategy | PROJECT.md explicitly excludes this. The performance problem is specific to Over/Under with ~150k rows. Adding DALE would double scope for no identified need. | Only enqueue combinations for `Over/HT — Dupla + Linha`. |
| Celery / RabbitMQ for task queue | Celery requires a broker (RabbitMQ or separate Redis database), a separate worker process, and Celery beat for scheduling. This project's constraint is "maintain existing Docker Compose with api + redis." A simpler solution (FastAPI BackgroundTasks + asyncio + ProcessPoolExecutor, OR ARQ with Redis) achieves the same outcome. | Use FastAPI `BackgroundTasks` with `ProcessPoolExecutor` for CPU-bound pandas work, or ARQ if retry/persistence is needed. Both run against the existing Redis instance. |
| Real-time WebSocket job updates | Adds socket management complexity, connection state, reconnection logic. For 7 background jobs that complete in under 30 seconds, polling every 2-3 seconds is sufficient and simpler. | Polling pattern: frontend polls `GET /jobs/{job_id}` until `completed` or `failed`. |
| Persistent job history / audit log | Storing every job result beyond the analysis TTL (24h) requires a database or growing Redis memory. The product has no requirement to review historical computation runs. | Jobs expire from Redis along with their results per existing TTL policy. |
| Refresh tokens | Single-user system. If the session expires, logging in again costs one HTTP call. Refresh token rotation adds implementation complexity (rotation, revocation, replay detection) with no benefit at this scale. | Short-lived access token. User logs in again when it expires. |
| Password reset / recovery flow | No second user to notify. No email infrastructure. The operator changes the `.env` variable directly. | Document env var name in README. |

---

## Feature Dependencies

```
Password login (POST /auth/login)
  --> Token validation dependency
       --> All protected endpoints (replaces verify_api_key)

Upload files (POST /analyze or new POST /precompute)
  --> Combination enumeration (powerset of N files)
       --> Per-combination cache_key generation (deterministic MD5)
            --> Background job enqueue (one job per combination)
                 --> Job status storage in Redis (job:{job_id})
                      --> Job status endpoint (GET /jobs/{job_id})
                           --> Result retrieval by cache_key (existing GET /export/{cache_key})

Backend filter removal (min_jogos, min_green_pct)
  --> No dependencies — standalone change to pipeline Step 5
  --> BLOCKS frontend filter implementation (frontend work, out of scope for this milestone)
```

---

## MVP Recommendation

For this milestone, prioritize in this order:

1. **Backend filter removal** — No dependencies, zero risk, immediate. Unblocks frontend.
2. **Single-user login/password auth** — Self-contained. Replaces existing `verify_api_key`. Requires: `POST /auth/login`, `POST /auth/logout`, updated dependency on protected endpoints. No external dependencies beyond `pwdlib` and a `.env` entry.
3. **Async pre-computation** — Most complex, most impactful. Requires: combination enumeration logic, background task execution with ProcessPoolExecutor (pandas is CPU-bound — event loop must not be blocked), job status storage in Redis, `GET /jobs/{job_id}` endpoint.

Defer (not in this milestone):
- Bulk job status endpoint: nice-to-have, can be added after core job polling works.
- Per-combination label in upload response: add after basic job IDs work correctly.

---

## Complexity Notes

### Async pre-computation: why CPU-bound matters

The pipeline (load → normalize → deduplicate → metrics) is dominated by pandas operations on ~150k rows per combination. pandas releases and re-acquires the GIL inconsistently. The safe assumption is CPU-bound.

**FastAPI `BackgroundTasks` limitation:** Runs in the same event loop as request handling. A long pandas computation will starve the event loop, making health checks and other endpoints unresponsive during computation.

**Correct approach:** Wrap the pipeline computation in `asyncio.get_event_loop().run_in_executor(ProcessPoolExecutor(...), ...)` inside the background task. This offloads CPU work to a separate OS process, bypassing the GIL and keeping the event loop free.

**Alternative:** ARQ (async task queue built on Redis). Adds a separate worker process and job persistence with retries. More robust but increases operational complexity (second process in Docker Compose). Warranted if the computation is unreliable or needs retry semantics.

**Recommendation:** Start with `BackgroundTasks` + `ProcessPoolExecutor`. The existing Redis instance handles job state. Migrate to ARQ only if retry requirements emerge.

### Auth: pwdlib over passlib

passlib is unmaintained as of 2025 (confirmed by FastAPI's own GitHub discussion #11773). FastAPI's current documentation examples have moved to `pwdlib`. Use `pwdlib[argon2]` or `pwdlib[bcrypt]` — bcrypt is the safer bet for compatibility.

For single-user with no database: store `USERNAME` and `HASHED_PASSWORD` in `.env`. Hash is computed once (CLI script or startup check) and stored. No database, no migration, no ORM.

---

## Sources

- [FastAPI BackgroundTasks official docs](https://fastapi.tiangolo.com/tutorial/background-tasks/)
- [Managing Background Tasks in FastAPI: BackgroundTasks vs ARQ + Redis](https://davidmuraya.com/blog/fastapi-background-tasks-arq-vs-built-in/)
- [FastAPI BackgroundTasks vs Celery vs ARQ](https://medium.com/@komalbaparmar007/fastapi-background-tasks-vs-celery-vs-arq-picking-the-right-asynchronous-workhorse-b6e0478ecf4a) — MEDIUM confidence (WebSearch, not verified with official docs)
- [FastAPI OAuth2 with Password and JWT — official docs](https://fastapi.tiangolo.com/tutorial/security/oauth2-jwt/)
- [passlib maintenance concern — FastAPI GitHub discussion #11773](https://github.com/fastapi/fastapi/discussions/11773) — HIGH confidence (official GitHub)
- [ARQ documentation](https://arq-docs.helpmanual.io/)
- [FastAPI asyncio run_in_executor for CPU-bound tasks — Sentry](https://sentry.io/answers/fastapi-difference-between-run-in-executor-and-run-in-threadpool/) — MEDIUM confidence
- [Celery vs ARQ for Python task queues — Leapcell](https://leapcell.io/blog/celery-versus-arq-choosing-the-right-task-queue-for-python-applications) — MEDIUM confidence (WebSearch)
