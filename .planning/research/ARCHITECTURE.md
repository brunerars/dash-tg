# Architecture Patterns

**Domain:** eSoccer dashboard backend — async pre-computation milestone
**Researched:** 2026-04-02
**Mode:** Architecture dimension for existing brownfield FastAPI + Redis project

---

## Current Architecture (Baseline)

The existing system is a synchronous, request-scoped pipeline inside a single FastAPI process.

```
Client
  │
  ▼
[HTTP Layer]  routers/analysis.py
  │  verify_api_key (X-API-Key header)
  │
  ▼
[Cache Check]  Redis: analysis:{cache_key}
  │  HIT  ──────────────────────────────► Response (immediate)
  │  MISS
  │
  ▼
[Pipeline — runs synchronously inside request handler]
  load → normalize → deduplicate → metrics → filter → serialize
  │
  ▼
[Cache Write]  Redis: analysis:{cache_key}, export:{cache_key}, blueprint:{cache_key}
  │
  ▼
Response
```

**Critical problem for this milestone:** With N files, the Over/HT strategy requires 2^N - 1 combination runs. For N=3 files at ~150k rows each, this is 7 pipeline executions totalling minutes of CPU work — all synchronous inside the request handler, blocking the entire uvicorn event loop.

---

## Recommended Architecture (Target)

### Overview

Introduce a **job layer** that sits between the HTTP layer and the pipeline. The upload endpoint triggers background computation and returns a job ID immediately. The frontend polls a status endpoint until all combinations are ready.

```
Client
  │
  ├── POST /precompute  (upload N files)
  │       │
  │       ▼
  │   [HTTP Layer]  validate files, generate job_id
  │       │
  │       ▼
  │   [Job Registry]  Redis: job:{job_id}  ← write status=pending, combinations list
  │       │
  │       ▼
  │   [Background Dispatcher]  asyncio.create_task → ThreadPoolExecutor
  │       │  (one task per combination, runs pipeline in thread)
  │       │
  │       ▼
  │   [Pipeline — per combination, in thread]
  │       load (uses filedf: cache) → normalize → dedup → metrics → serialize
  │       │
  │       ▼
  │   [Cache Write per combination]  Redis: analysis:{combo_cache_key}
  │       │
  │       ▼
  │   [Job Registry Update]  mark combination done, update progress
  │
  ├── GET /jobs/{job_id}/status  (poll)
  │       │
  │       ▼
  │   [Job Registry Read]  Redis: job:{job_id}
  │       │
  │       ▼
  │   Response: { status, progress, combinations: [{cache_key, files, done}] }
  │
  └── POST /analyze (existing — unchanged, still serves single-combination on-demand)
```

---

## Component Boundaries

### Existing Components (unchanged)

| Component | Responsibility | Communicates With |
|-----------|---------------|-------------------|
| `routers/analysis.py` | HTTP handling, pipeline orchestration for `/analyze` | service layer, Redis, middleware |
| `esoccer_dashboard/services/loader.py` | Read `.xlsx`, cache individual file DataFrames | Redis (`filedf:` prefix) |
| `esoccer_dashboard/services/normalizer.py` | Add `DuplaNormalizada` column | none (pure transform) |
| `esoccer_dashboard/services/deduplicator.py` | Cluster dedup within 5-min window | none (pure transform) |
| `esoccer_dashboard/services/metrics.py` | Compute 16 metrics per group | none (pure transform) |
| `esoccer_dashboard/services/cache.py` | Redis get/set with TTL | Redis |
| `config/strategies.py` | Single source of truth for strategy params | all pipeline components |
| `middleware/auth.py` | API Key validation dependency | all endpoints |

### New Components (to build)

| Component | Responsibility | Communicates With |
|-----------|---------------|-------------------|
| `routers/precompute.py` | `POST /precompute`, `GET /jobs/{id}/status` endpoints | job_registry, dispatcher |
| `services/job_registry.py` | Read/write job state in Redis (`job:` prefix) | Redis |
| `services/dispatcher.py` | Generate combinations (itertools.combinations), submit tasks to thread pool | ThreadPoolExecutor, pipeline services, job_registry |
| `middleware/auth.py` (modified) | Replace X-API-Key with JWT Bearer token validation | `config/settings.py` for secret |
| `routers/auth.py` | `POST /token` login endpoint | settings (credentials), PyJWT |

### Modified Components

| Component | Change | Why |
|-----------|--------|-----|
| `middleware/auth.py` | Replace `API_KEYS` env check with JWT `Bearer` token decode | New auth requirement |
| `config/settings.py` | Add `USERNAME`, `HASHED_PASSWORD`, `JWT_SECRET`, `JWT_EXPIRE_MINUTES` | New auth config |
| `main.py` | Mount new routers (`precompute`, `auth`); initialize thread pool executor | New endpoints |
| `routers/analysis.py` | Remove `min_jogos` and `min_green_pct` filter step | Filters move to frontend |

---

## Data Flow: Async Pre-Computation

### Step-by-step

```
1. Client POSTs N xlsx files to /precompute
   Headers: Authorization: Bearer {jwt_token}
   Body: multipart/form-data, files=[A.xlsx, B.xlsx, C.xlsx], strategy="Over/HT — Dupla + Linha"

2. Router validates JWT, validates strategy, reads all file bytes into memory

3. Router generates:
   - job_id = uuid4()
   - For N=3 files: 7 combinations = [(A,), (B,), (C,), (A,B), (A,C), (B,C), (A,B,C)]
   - For each combination: combo_cache_key = MD5(sorted file bytes + strategy)

4. Router writes to Redis:
   job:{job_id} = {
     status: "running",
     strategy: "Over/HT — Dupla + Linha",
     total: 7,
     completed: 0,
     combinations: [
       {files: ["A.xlsx"], cache_key: "abc123", done: false},
       ...
     ],
     created_at: "ISO timestamp",
     ttl: 24h
   }

5. Router responds immediately:
   { job_id: "uuid", total_combinations: 7, status: "running" }

6. Background dispatcher (asyncio.create_task):
   - For each combination: loop.run_in_executor(thread_pool, run_pipeline, combo_args)
   - Combinations run concurrently up to thread pool size (recommended: min(4, cpu_count))
   - Each thread runs the full synchronous pipeline (load → normalize → dedup → metrics)
   - On completion: update job:{job_id} progress in Redis (HINCRBY completed)
   - On all done: set job status = "done"
   - On error: set combination error field, mark job status = "partial" or "failed"

7. Client polls GET /jobs/{job_id}/status every 2-3 seconds
   Response: { status, completed, total, combinations: [{cache_key, done, files}] }

8. When status = "done", client uses individual cache_keys to call existing /analyze
   (cache hit, returns instantly — pipeline already ran)
```

### Redis Key Space (additions)

| Key Pattern | Data | TTL |
|-------------|------|-----|
| `job:{job_id}` | JSON: status, progress, combination list | 24h |
| `analysis:{cache_key}` | JSON: analysis result (existing) | 24h |
| `filedf:{md5}` | pickled DataFrame (existing) | 24h |

---

## Data Flow: JWT Authentication

### Login

```
1. POST /token
   Body: form-data { username, password }

2. Router:
   - Compare username against USERNAME env var
   - Verify password against HASHED_PASSWORD (bcrypt via pwdlib)
   - On match: create JWT (sub=username, exp=now+expire_minutes)
   - Return { access_token, token_type: "bearer" }

3. Client stores token; sends as Authorization: Bearer {token} on all subsequent requests
```

### Request validation (replaces X-API-Key)

```
Current:  verify_api_key(x_api_key: str = Header(...)) → checks API_KEYS set
Target:   verify_token(credentials = Depends(HTTPBearer())) → PyJWT.decode() → raises 401 if invalid/expired
```

No token revocation list needed for single-user scenario. Token expiry + re-login is sufficient.

---

## Background Processing: Technology Decision

**Decision: asyncio.create_task + ThreadPoolExecutor (no ARQ, no Celery)**

Rationale:

| Option | Fit | Why |
|--------|-----|-----|
| FastAPI `BackgroundTasks` | Poor | No status tracking, CPU work blocks event loop, lost on restart |
| `asyncio.create_task + run_in_executor(ThreadPoolExecutor)` | Good | Status in Redis survives, no new infrastructure, works with synchronous pandas, controlled concurrency |
| ARQ worker | Overkill | Requires separate Docker service, supervisord for same-container deployment, adds operational complexity for a single-user VPS app |
| Celery | Overkill | Designed for distributed multi-process; adds broker config, worker management, not worth it here |

**Why ThreadPoolExecutor and not ProcessPoolExecutor:**

The pipeline's bottleneck is pandas I/O and computation, not Python GIL-bound pure CPU. Each thread calls `run_pipeline()` which is synchronous and pandas-heavy — threads release the GIL during numpy/pandas operations. ThreadPoolExecutor avoids the serialization overhead of ProcessPoolExecutor (pickling large DataFrames across process boundaries is expensive). The `filedf:` cache in Redis already handles cross-combination file reuse, so threads share nothing except the Redis client.

**Concurrency budget:** `max_workers = min(4, os.cpu_count())`. At 7 combinations for 3 files, 4 concurrent pipeline threads is appropriate for a VPS with 2-4 cores.

---

## Anti-Patterns to Avoid

### Anti-Pattern 1: Running pandas pipeline as an async coroutine directly

**What:** `async def run_combination(...)` calling pandas operations directly in the coroutine.
**Why bad:** pandas operations are synchronous and CPU/IO-bound. Calling them from an async function without `run_in_executor` blocks the entire event loop, making all API endpoints unresponsive during computation.
**Instead:** Wrap in `await loop.run_in_executor(executor, sync_pipeline_fn, args)`.

### Anti-Pattern 2: Storing job status in process memory (dict)

**What:** `jobs_in_memory: dict[str, JobStatus]` as a module-level variable in the router.
**Why bad:** Lost on container restart. Breaks if two uvicorn workers are ever spawned. The job_id returned to the client becomes permanently unresolvable.
**Instead:** All job state in Redis with TTL.

### Anti-Pattern 3: Blocking the upload endpoint waiting for combinations to finish

**What:** `await asyncio.gather(*combination_tasks)` inside the `POST /precompute` handler.
**Why bad:** Client waits for all combinations (potentially minutes) before getting a response. Defeats the purpose of async pre-computation.
**Instead:** `asyncio.create_task(dispatch_combinations(...))` then `return {job_id, status: "running"}` immediately.

### Anti-Pattern 4: Generating N×M combinations including strategy variants at once

**What:** Pre-computing all file combinations for all strategies in one job.
**Why bad:** Exponential explosion. Requirements explicitly scope pre-computation to Over/HT only.
**Instead:** Strategy is a parameter of `/precompute`. One endpoint call = one strategy.

### Anti-Pattern 5: Keeping python-jose for JWT

**What:** Using `python-jose` as JWT library (was previously recommended in older FastAPI docs).
**Why bad:** Last release in 2021, known CVEs, effectively abandoned. FastAPI docs have migrated away.
**Instead:** Use `PyJWT` (actively maintained, minimal dependencies) with `pwdlib[bcrypt]` for password hashing.

---

## Scalability Considerations

| Concern | Current (single-user VPS) | If load increases |
|---------|--------------------------|-------------------|
| Concurrent job submissions | 1 at a time, single user | Add job queue depth limit in job_registry |
| Thread pool exhaustion | 7 combinations, 4 threads — fine | Tune max_workers or add ARQ then |
| Redis memory | Job metadata is tiny JSON, TTL 24h | No issue for this scale |
| File upload size | N xlsx files in memory per request | Add file size validation |
| Token expiry | Set to 8-24h for single user (convenience) | Shorter expiry + refresh tokens for multi-user |

---

## Build Order (Phase Dependencies)

The three features have clean dependency ordering:

```
Phase 1: Remove backend filters (min_jogos, min_green_pct)
  │  Prerequisite for: nothing — independent, simplest change
  │  Risk: none (additive removal)
  │
  ▼
Phase 2: JWT authentication (replace X-API-Key)
  │  Prerequisite for: pre-computation (new endpoints need auth)
  │  Dependencies: PyJWT, pwdlib — new packages
  │  Risk: low — well-understood pattern, single user
  │
  ▼
Phase 3: Async pre-computation
     Prerequisite: phases 1 and 2 complete
     Dependencies: job_registry, dispatcher, ThreadPoolExecutor, new router
     Risk: medium — concurrency, Redis data structures, polling contract
```

**Why this order:**

Phase 1 is a clean subtraction (remove filter lines from `_analyze_with_strategy`). No new code, no risk. Gets it out of the way.

Phase 2 changes the auth contract for all endpoints. It must be stable before Phase 3 adds new protected endpoints. New packages (`PyJWT`, `pwdlib`) are isolated to new middleware and one new router.

Phase 3 builds on the stable auth surface. The `filedf:` cache (already built) is the critical optimization that makes concurrent combinations fast — files are loaded once per job, not once per combination. This dependency is already satisfied by the current codebase.

---

## Component Communication Summary

```
[auth.py router]
    │ POST /token
    ▼
[middleware/auth.py]  ←── used by all authenticated endpoints
    │
    ├── [routers/precompute.py]
    │       │
    │       ├── [services/job_registry.py]  ──► Redis job:{job_id}
    │       │
    │       └── [services/dispatcher.py]
    │               │
    │               ├── itertools.combinations (stdlib)
    │               │
    │               └── ThreadPoolExecutor
    │                       │
    │                       ▼ (one thread per combination)
    │                   [existing pipeline]
    │                   loader → normalizer → deduplicator → metrics
    │                       │
    │                       ▼
    │                   Redis filedf:{md5}, analysis:{key}, export:{key}, blueprint:{key}
    │                       │
    │                       ▼
    │                   job_registry.update_progress()  ──► Redis job:{job_id}
    │
    └── [routers/analysis.py]  (existing, unchanged for /analyze)
```

---

## Sources

- [FastAPI BackgroundTasks official docs](https://fastapi.tiangolo.com/tutorial/background-tasks/) — HIGH confidence
- [FastAPI OAuth2 + JWT official tutorial](https://fastapi.tiangolo.com/tutorial/security/oauth2-jwt/) — HIGH confidence (PyJWT + pwdlib[argon2] now recommended over python-jose + passlib)
- [Managing Background Tasks: BackgroundTasks vs ARQ](https://davidmuraya.com/blog/fastapi-background-tasks-arq-vs-built-in/) — MEDIUM confidence (external blog, consistent with official docs)
- [python-jose abandonment discussion](https://github.com/fastapi/fastapi/discussions/11345) — HIGH confidence (FastAPI maintainer discussion confirming migration to PyJWT)
- [FastAPI run_in_executor vs run_in_threadpool](https://sentry.io/answers/fastapi-difference-between-run-in-executor-and-run-in-threadpool/) — MEDIUM confidence
- [Leapcell: Managing Long-Running Operations in FastAPI](https://leapcell.io/blog/managing-background-tasks-and-long-running-operations-in-fastapi) — MEDIUM confidence

---

*Architecture research: 2026-04-02*
