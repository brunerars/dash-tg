# Phase 3: Async Pre-computation - Research

**Researched:** 2026-04-02
**Domain:** FastAPI background tasks, Redis job state, combination generation
**Confidence:** HIGH

---

## User Constraints (from project context)

### Locked Decisions
- Stack: FastAPI + Redis — no additional infrastructure (no Celery, no RabbitMQ, no separate worker process)
- Deploy: Docker Compose on VPS — single `api` + `redis` container topology unchanged
- No WebSocket — polling is sufficient for the ~7 jobs a 3-file upload produces
- Pre-computation applies ONLY to "Over/HT — Dupla + Linha" strategy (eSoccer — Dupla excluded)

### Claude's Discretion
- Whether to run combinations sequentially or concurrently (trade-off: throughput vs VPS RAM pressure — noted in STATE.md as open)
- Exact Redis key schema for job records
- Whether to add a new router file or extend `routers/analysis.py`

### Deferred Ideas (OUT OF SCOPE)
- PREC-V2-01: Bulk job status endpoint
- PREC-V2-02: Upload response includes combination labels + cache_keys
- Frontend changes of any kind

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| PREC-01 | Upload of N sheets triggers all 2^N-1 Over/HT combinations automatically | `itertools.combinations` powerset; `_analyze_with_strategy` reusable as synchronous compute fn |
| PREC-02 | Endpoint returns 202 Accepted with job IDs immediately (non-blocking) | `asyncio.get_event_loop().run_in_executor()` pattern; response before computation |
| PREC-03 | Each combination result saved to Redis as it completes | Existing `get_or_compute` / `store_*` functions in `cache.py` are reusable |
| PREC-04 | GET /jobs/{job_id} returns status (pending/running/completed/failed) + cache_key | Redis hash or JSON blob keyed by `job:{job_id}` with TTL |
| PREC-05 | Pipeline runs in thread pool, does not block event loop | `loop.run_in_executor(executor, fn)` with `ThreadPoolExecutor`; sync `compute()` inside `_analyze_with_strategy` already synchronous |
| PREC-06 | Job records expire from Redis via TTL — stale "in-progress" entries do not accumulate | `setex` / `expire` on job keys; must set TTL at creation, not only on completion |
</phase_requirements>

---

## Summary

Phase 3 adds a non-blocking upload endpoint (`POST /precompute`) that generates all non-empty subsets (2^N-1 combinations) of the uploaded files, enqueues a background job per combination for the Over/HT strategy, and returns a `job_ids` list immediately with HTTP 202. A polling endpoint (`GET /jobs/{job_id}`) lets the frontend track each job until it transitions from `pending` → `running` → `completed` (or `failed`).

The existing pipeline in `_analyze_with_strategy` is already a pure synchronous `compute()` function wrapped in `get_or_compute`. This is the key insight: the entire computation is sync-safe and Redis-aware. The only new code is (1) the combination generator, (2) the background dispatcher using `loop.run_in_executor`, and (3) a thin job-state layer on top of Redis.

**No new dependencies are required.** `asyncio`, `concurrent.futures.ThreadPoolExecutor`, and `itertools` are Python stdlib. Redis is already in use.

**Primary recommendation:** Use `asyncio.get_event_loop().run_in_executor(executor, sync_fn)` to offload the synchronous pipeline to a module-level `ThreadPoolExecutor`. Store job state as JSON in Redis with a `job:{job_id}` key and a TTL set at creation time (e.g., 2h). The sync pipeline already calls `get_or_compute`, so if multiple jobs share a combination (same files + strategy), only the first one actually runs compute — the rest will be cache hits.

---

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `asyncio` | stdlib | Non-blocking dispatch of sync jobs | Built into Python 3.11; native to FastAPI's async model |
| `concurrent.futures.ThreadPoolExecutor` | stdlib | Thread pool for sync pipeline execution | Standard way to offload blocking sync code from event loop in FastAPI |
| `itertools` | stdlib | Generate all non-empty subsets (combinations) of uploaded files | Idiomatic, zero-dep powerset generation |
| `redis` (redis-py) | already installed | Job state persistence and TTL-based expiry | Already in use; no new dependency |
| `uuid` | stdlib | Generate unique job IDs | Collision-free, zero-dep |

### No New Dependencies
Zero new `pip install` entries. Everything needed is already in `requirements.txt` or Python stdlib.

**Installation:** none required.

---

## Architecture Patterns

### Recommended Project Structure Changes

```
dash-tg/
├── routers/
│   ├── analysis.py          # unchanged (existing pipeline)
│   └── precompute.py        # NEW — POST /precompute, GET /jobs/{job_id}
├── esoccer_dashboard/services/
│   └── cache.py             # ADD: store_job, get_job, update_job helpers
├── config/
│   └── settings.py          # ADD: CACHE_TTL_JOB env var (default 7200 = 2h)
└── main.py                  # ADD: include_router(precompute_router)
```

Adding a new `routers/precompute.py` is cleaner than extending `analysis.py` — it keeps the pre-computation concern isolated and matches the existing pattern of one-concern-per-router.

### Pattern 1: Thread Pool Executor for Sync Pipeline

**What:** A module-level `ThreadPoolExecutor` shared across requests. The sync `compute()` function from inside `_analyze_with_strategy` is extracted and called via `loop.run_in_executor`.

**When to use:** Any time you need to offload a synchronous, potentially slow (CPU+IO) function without blocking the ASGI event loop.

**Example:**
```python
# Source: https://docs.python.org/3/library/asyncio-eventloop.html#asyncio.loop.run_in_executor
import asyncio
from concurrent.futures import ThreadPoolExecutor

_executor = ThreadPoolExecutor(max_workers=2)  # module-level, shared

async def _dispatch_job(job_id: str, files_contents: list[tuple[str, bytes]]) -> None:
    loop = asyncio.get_event_loop()
    update_job(job_id, status="running")
    try:
        result = await loop.run_in_executor(
            _executor,
            lambda: _run_pipeline(files_contents)  # sync fn
        )
        update_job(job_id, status="completed", cache_key=result["cache_key"])
    except Exception as exc:
        update_job(job_id, status="failed", error=str(exc))
```

**Why ThreadPoolExecutor, not ProcessPoolExecutor:**
The pandas pipeline holds DataFrames in-process and uses Redis for caching. Cross-process IPC overhead would dominate on a 2-3 file workload. ThreadPoolExecutor is correct here — the pipeline is I/O-bound on Redis reads/writes more than it is CPU-bound on the math. GIL contention is not a concern because the bottleneck is pandas + Redis I/O, not pure Python compute loops.

**max_workers choice:** 2 is safe for a VPS with limited RAM. 3+ concurrent pipelines each loading multiple DataFrames could cause OOM. This is the trade-off noted in STATE.md. 2 gives parallelism without memory pressure.

### Pattern 2: Powerset Combination Generator

**What:** Generate all non-empty subsets of the uploaded files list.

**When to use:** Triggered once per `POST /precompute` call to enumerate jobs.

**Example:**
```python
# Source: https://docs.python.org/3/library/itertools.html
from itertools import chain, combinations

def all_combinations(files: list) -> list[list]:
    """Returns all non-empty subsets of `files`, sorted by size ascending."""
    return [
        list(combo)
        for r in range(1, len(files) + 1)
        for combo in combinations(files, r)
    ]

# 3 files -> 7 combinations: (A,), (B,), (C,), (A,B), (A,C), (B,C), (A,B,C)
# 4 files -> 15 combinations
```

### Pattern 3: Job State in Redis

**What:** Each job is a JSON blob stored at `job:{job_id}` with a TTL set at creation.

**Why TTL at creation (not at completion):** If the worker crashes mid-run, the job stays `"running"` forever — PREC-06 explicitly requires stale in-progress entries not to accumulate. Setting TTL at creation guarantees expiry regardless of outcome.

**Example:**
```python
# Source: redis-py docs + project cache.py pattern
def store_job(job_id: str, status: str, cache_key: str | None = None,
              error: str | None = None, ttl: int = CACHE_TTL_JOB) -> None:
    r = get_redis_client()
    payload = {
        "job_id": job_id,
        "status": status,           # pending | running | completed | failed
        "cache_key": cache_key,
        "error": error,
    }
    r.setex(f"job:{job_id}", ttl, json.dumps(payload))

def get_job(job_id: str) -> dict | None:
    r = get_redis_client()
    raw = r.get(f"job:{job_id}")
    return json.loads(raw) if raw else None
```

**TTL value:** 2 hours (7200s) covers any realistic pipeline runtime plus a generous polling window. Configurable via `CACHE_TTL_JOB` env var.

### Pattern 4: POST /precompute Response (202 Accepted)

```python
@router.post("/precompute", status_code=202)
async def precompute(
    _key: AuthDep,
    files: list[UploadFile] = File(...),
    background_tasks: BackgroundTasks,
) -> dict:
    # 1. Read file bytes eagerly (UploadFile cannot be read in a thread)
    files_contents = [(uf.filename, await uf.read()) for uf in files]

    # 2. Generate all combinations
    combos = all_combinations(files_contents)  # [(name, bytes), ...]

    # 3. Create one job per combination, status=pending
    job_ids = []
    for combo in combos:
        job_id = str(uuid.uuid4())
        store_job(job_id, status="pending")
        background_tasks.add_task(_dispatch_job, job_id, combo)
        job_ids.append(job_id)

    return {"job_ids": job_ids, "total_jobs": len(job_ids)}
```

**Important:** Files MUST be read (`await uf.read()`) before returning the response. After the response is sent, `UploadFile` objects are closed by Starlette and cannot be read in a background thread.

### Anti-Patterns to Avoid

- **Reading UploadFile in a background task:** Starlette closes uploaded files after the response is sent. Read all bytes eagerly in the endpoint handler and pass raw `bytes` to the background function.
- **Blocking the event loop with sync pandas code:** Never call `_analyze_with_strategy` directly in an `async def` handler without `run_in_executor`. Pandas operations (concat, groupby, sort) release and reacquire the GIL but still block the current thread.
- **Setting TTL only on completion:** If the job runner crashes, a job stuck at `"running"` will never expire. TTL must be set at `store_job` time (PREC-06).
- **One executor per request:** Creating a new `ThreadPoolExecutor` per request spawns unbounded threads. Use a single module-level instance.
- **Using FastAPI `BackgroundTasks` for blocking sync work without `run_in_executor`:** `background_tasks.add_task(sync_fn)` runs the function in a thread pool already (Starlette's default executor), but you lose the ability to `await` it or catch exceptions cleanly. For status tracking, using `asyncio.create_task(_dispatch_job(...))` fired from within `background_tasks.add_task` is the cleaner pattern — or pass an async coroutine directly to `background_tasks.add_task`.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Combination enumeration | Custom nested loop | `itertools.combinations` + range | stdlib, handles edge cases (N=1 up to N=many), no off-by-one risk |
| Thread pool management | Manual thread creation | `ThreadPoolExecutor` | Proper lifecycle, bounded worker count, exception propagation |
| Job ID generation | Timestamp + counter | `uuid.uuid4()` | Collision-free without coordination overhead |
| Job expiry | Background cleanup cron | Redis `setex` TTL | Atomic, no second process needed, already in use |
| Pipeline execution | Duplicate the pipeline | Reuse `_analyze_with_strategy` compute closure | The existing pipeline is already sync-safe and Redis-aware |

**Key insight:** The existing synchronous `compute()` closure inside `_analyze_with_strategy` is already Redis-aware and complete. The pre-computation task is just calling that same code path with different file combinations, not rewriting it.

---

## Common Pitfalls

### Pitfall 1: UploadFile Read After Response
**What goes wrong:** Background task reads `await uf.read()` and gets empty bytes or raises `ValueError: I/O operation on closed file`.
**Why it happens:** Starlette closes `UploadFile` objects when the response is finalized. Background tasks run after the response.
**How to avoid:** Read ALL file bytes (`content = await uf.read()`) in the endpoint handler before returning. Pass `list[tuple[str, bytes]]` to the background function.
**Warning signs:** Empty DataFrames or `ValueError` in background task logs.

### Pitfall 2: Job Stuck in "running" After Crash
**What goes wrong:** A worker crash leaves a job at `status="running"` with no expiry. Future `GET /jobs/{id}` returns stale data indefinitely.
**Why it happens:** TTL was only set on `store_job` path when `status="completed"`, not at creation time.
**How to avoid:** Always call `setex` (not `set`) at job creation time. The TTL guarantees expiry even if the `update_job("completed")` call never happens (PREC-06).
**Warning signs:** `GET /jobs/{id}` returns `running` hours after upload.

### Pitfall 3: Event Loop Blocking on Pandas
**What goes wrong:** API stops responding during pre-computation even with `async def` endpoint.
**Why it happens:** `_analyze_with_strategy` contains a synchronous `compute()` that calls pandas operations. Calling a sync function directly inside `async def` blocks the event loop (the coroutine yields control only at `await` points).
**How to avoid:** Dispatch the sync pipeline via `loop.run_in_executor(_executor, compute)` — this moves it to the ThreadPoolExecutor thread pool, freeing the event loop.
**Warning signs:** `GET /health` or `GET /jobs/{id}` hangs during active computation.

### Pitfall 4: Unbounded Memory from Holding All File Bytes
**What goes wrong:** For 4 files, 15 job objects each hold references to subsets of file bytes simultaneously.
**Why it happens:** Python reference counting keeps all `bytes` objects alive as long as any combination tuple references them.
**How to avoid:** Use tuples of `(filename, bytes)` references — multiple combos referencing the same original file bytes share the same object in memory (Python interns bytes objects properly for references). Total memory = sum of unique file sizes, not N * files.
**Warning signs:** OOM kill on VPS during pre-computation of many large files.

### Pitfall 5: Cache Key Collision Between /analyze and /precompute
**What goes wrong:** Pre-computed result isn't served as a cache hit by `POST /analyze`.
**Why it happens:** `gerar_cache_key` sorts `files_bytes` by content before hashing, which makes order-independent. As long as the same bytes + strategy are used, the cache key is identical. But if `date_from`/`date_to`/`horarios` are passed to `/analyze` and not to `/precompute`, keys will differ.
**How to avoid:** Pre-computation must call `_analyze_with_strategy` with `date_from=None`, `date_to=None`, `horarios=None` (no date/time filters). This matches the most common `/analyze` call. Users applying date filters will get a cache miss (acceptable — the REQUIREMENTS don't scope date-filtered pre-computation).
**Warning signs:** User uploads the same files via `/analyze` right after `/precompute` and gets `cache_hit: false`.

---

## Code Examples

### Full Combination Generator
```python
# Source: https://docs.python.org/3/library/itertools.html
from itertools import combinations

def all_nonempty_combinations(
    files: list[tuple[str, bytes]]
) -> list[list[tuple[str, bytes]]]:
    result = []
    for r in range(1, len(files) + 1):
        for combo in combinations(files, r):
            result.append(list(combo))
    return result
```

### Async Background Dispatcher (in precompute.py)
```python
import asyncio
import uuid
from concurrent.futures import ThreadPoolExecutor
from fastapi import APIRouter, BackgroundTasks, Depends, File, UploadFile
from typing import Annotated

from middleware.auth import verify_jwt_cookie
from esoccer_dashboard.services.cache import store_job, get_job
from routers.analysis import _analyze_with_strategy  # reuse existing pipeline

router = APIRouter()
AuthDep = Annotated[str, Depends(verify_jwt_cookie)]

_executor = ThreadPoolExecutor(max_workers=2)

PRECOMPUTE_STRATEGY = "Over/HT — Dupla + Linha"


def _run_combination_sync(files_contents: list[tuple[str, bytes]]) -> dict:
    """Synchronous wrapper — runs in ThreadPoolExecutor thread."""
    import asyncio
    # _analyze_with_strategy is async; we need to run it in the thread's own event loop
    # or extract the sync compute() — the cleaner option is to extract it.
    # See Architecture note below.
    loop = asyncio.new_event_loop()
    try:
        return loop.run_until_complete(
            _analyze_with_strategy(PRECOMPUTE_STRATEGY, files_contents)
        )
    finally:
        loop.close()


async def _dispatch_job(job_id: str, files_contents: list[tuple[str, bytes]]) -> None:
    store_job(job_id, status="running")
    loop = asyncio.get_event_loop()
    try:
        result = await loop.run_in_executor(_executor, lambda: _run_combination_sync(files_contents))
        store_job(job_id, status="completed", cache_key=result["cache_key"])
    except Exception as exc:
        store_job(job_id, status="failed", error=str(exc))


@router.post("/precompute", status_code=202, tags=["pre-computation"])
async def precompute(
    _key: AuthDep,
    files: list[UploadFile] = File(...),
    background_tasks: BackgroundTasks = None,
) -> dict:
    files_contents = [(uf.filename or f"file_{i}.xlsx", await uf.read()) for i, uf in enumerate(files)]
    combos = all_nonempty_combinations(files_contents)
    job_ids = []
    for combo in combos:
        job_id = str(uuid.uuid4())
        store_job(job_id, status="pending")
        background_tasks.add_task(_dispatch_job, job_id, combo)
        job_ids.append(job_id)
    return {"job_ids": job_ids, "total_jobs": len(job_ids)}


@router.get("/jobs/{job_id}", tags=["pre-computation"])
def get_job_status(_key: AuthDep, job_id: str) -> dict:
    job = get_job(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job não encontrado ou expirado.")
    return job
```

**Architecture note on `_analyze_with_strategy` being `async def`:**
The current implementation is `async def _analyze_with_strategy(...)` with the sync `compute()` closure inside. For pre-computation, the cleanest approach is to **extract the synchronous `compute()` closure into a standalone module-level function** in `analysis.py` (or a shared service module). This avoids nested event loop issues when calling an async function from a ThreadPoolExecutor thread. The plan must account for this small refactor.

### Job State Helpers (additions to cache.py)
```python
CACHE_TTL_JOB: int = int(os.getenv("CACHE_TTL_JOB", "7200"))  # 2h default

def store_job(
    job_id: str,
    status: str,
    cache_key: str | None = None,
    error: str | None = None,
    ttl: int = CACHE_TTL_JOB,
) -> None:
    r = get_redis_client()
    payload = {"job_id": job_id, "status": status, "cache_key": cache_key, "error": error}
    r.setex(f"job:{job_id}", ttl, json.dumps(payload))


def get_job(job_id: str) -> dict | None:
    r = get_redis_client()
    raw = r.get(f"job:{job_id}")
    return json.loads(raw) if raw else None
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Celery for background tasks | `asyncio` + `run_in_executor` for simple single-process cases | 2020-present | Celery is overkill for single-VPS single-worker; FastAPI async is sufficient |
| Polling every 500ms | Polling every 2-5s for job queues of < 20 items | 2023-present | Reduces Redis reads; UI stays responsive |

**Deprecated/outdated:**
- `loop.get_event_loop()`: deprecated in Python 3.10+. Use `asyncio.get_event_loop()` inside a running async context, or `asyncio.get_running_loop()` — the latter raises `RuntimeError` if no loop is running, which is safer.

---

## Open Questions

1. **Sequential vs concurrent combination execution**
   - What we know: `ThreadPoolExecutor(max_workers=2)` allows 2 pipelines in parallel. VPS RAM is unknown. Each pipeline peak RAM = ~200MB for typical xlsx sizes.
   - What's unclear: Exact VPS RAM headroom.
   - Recommendation: Default to `max_workers=2` (safe). Make it configurable via `PRECOMPUTE_MAX_WORKERS` env var so the operator can tune it without a deploy.

2. **Whether to extract `compute()` from `_analyze_with_strategy`**
   - What we know: `_analyze_with_strategy` is `async def` with a sync `compute` closure inside. Running an async function from a non-async thread (inside ThreadPoolExecutor) requires `asyncio.new_event_loop()` per thread, which works but is inelegant.
   - What's unclear: Risk appetite for refactoring the existing working code.
   - Recommendation: Extract `_build_analysis_result(strategy_name, files_contents, ...) -> dict` as a sync function called by both `_analyze_with_strategy` and the pre-compute pipeline. Reduces coupling and eliminates nested-loop gymnastics. Low risk — it is a pure extraction.

3. **`date_from`/`date_to`/`horarios` for pre-computed results**
   - What we know: Pre-computation will run without date/time filters, matching the baseline `/analyze` call pattern.
   - What's unclear: User expectation — will they also want pre-computed date-filtered views?
   - Recommendation: Out of scope for v1. Document in API that `/precompute` does not accept filter params.

---

## Environment Availability

Step 2.6: No new external dependencies. All required tools are already present in `requirements.txt` and Python stdlib. Redis is already running as a sidecar container in `docker-compose.yml`. No audit needed.

---

## Validation Architecture

`nyquist_validation` is explicitly `false` in `.planning/config.json` — section skipped.

---

## Project Constraints (from CLAUDE.md)

| Directive | Impact on Phase 3 |
|-----------|------------------|
| Stack: FastAPI + Python 3.11 | Use `asyncio` stdlib, no ARQ, no Celery |
| Cache: Redis 7 + redis-py | Job state stored in Redis; no in-memory dict |
| No additional infrastructure | Single Docker Compose service topology unchanged |
| Pipeline parameter config in `config/strategies.py` | Pre-computation uses `ESTRATEGIAS["Over/HT — Dupla + Linha"]` via `get_strategy_internal` |
| Single source of truth in `config/strategies.py` | Do not hardcode strategy name in new code — import from `config.strategies` |
| Services receive config as parameters — never hardcode | `_run_pipeline` must call `get_strategy_internal`, not hardcode group_by/dedup_key |
| `from __future__ import annotations` at top of every service module | Add to `routers/precompute.py` and any new service functions |
| Double quotes for strings | Use throughout new code |
| `snake_case` for functions, `UPPER_SNAKE_CASE` for constants | `store_job`, `get_job`, `CACHE_TTL_JOB` |
| GSD workflow for all file changes | Execution via `/gsd:execute-phase` |

---

## Sources

### Primary (HIGH confidence)
- Python docs — `asyncio.loop.run_in_executor`: https://docs.python.org/3/library/asyncio-eventloop.html
- Python docs — `itertools.combinations`: https://docs.python.org/3/library/itertools.html
- FastAPI official — Background Tasks: https://fastapi.tiangolo.com/tutorial/background-tasks/
- Existing `routers/analysis.py` — sync `compute()` pattern verified by direct code reading
- Existing `esoccer_dashboard/services/cache.py` — `setex` pattern verified by direct code reading

### Secondary (MEDIUM confidence)
- Sentry answer — `run_in_executor` vs `run_in_threadpool`: https://sentry.io/answers/fastapi-difference-between-run-in-executor-and-run-in-threadpool/
- BetterStack — Background tasks in FastAPI: https://betterstack.com/community/guides/scaling-python/background-tasks-in-fastapi/

### Tertiary (LOW confidence)
- WebSearch synthesis on GIL + pandas: ThreadPoolExecutor is sufficient because pandas pipeline is I/O-heavy (Redis reads/writes dominate); pure Python compute loops are secondary. This claim is directionally correct but not benchmarked on this specific workload.

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all libraries are stdlib or already installed; verified by direct file reading
- Architecture: HIGH — patterns derived from official FastAPI/Python docs and direct codebase reading
- Pitfalls: HIGH for UploadFile read-after-response (official docs), MEDIUM for memory/GIL concerns (derived from known Python behavior, not benchmarked on this workload)

**Research date:** 2026-04-02
**Valid until:** 2026-05-02 (stable domain — FastAPI + stdlib patterns don't move fast)
