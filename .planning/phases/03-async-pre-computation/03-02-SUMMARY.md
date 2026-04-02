---
phase: 03-async-pre-computation
plan: "02"
subsystem: api
tags: [fastapi, redis, asyncio, threadpoolexecutor, background-jobs, precompute]

# Dependency graph
requires:
  - phase: 03-01
    provides: "_build_analysis_result sync pipeline + store_job/get_job/get_or_compute in cache.py"
provides:
  - "POST /precompute endpoint: 202 Accepted, dispatches 2^N-1 background jobs for Over/HT combinations"
  - "GET /jobs/{job_id} endpoint: polls job status (pending/running/completed/failed with cache_key)"
  - "routers/precompute.py: full background dispatch module"
affects: [frontend, deploy, phase-04]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "asyncio.create_task + _background_tasks set for GC-safe background dispatch"
    - "ThreadPoolExecutor(max_workers=2) for non-blocking sync pipeline via run_in_executor"
    - "get_or_compute wraps _build_analysis_result so results land under analysis:{cache_key} in Redis"
    - "PRECOMPUTE_STRATEGY derived from ESTRATEGIAS dict at import time — fails loudly on rename"

key-files:
  created:
    - routers/precompute.py
  modified:
    - main.py
    - .env.example

key-decisions:
  - "get_or_compute wraps _build_analysis_result inside _dispatch_job — required so /analyze sees cache_hit=true on subsequent calls"
  - "PRECOMPUTE_STRATEGY sourced via next() from ESTRATEGIAS dict, never a hardcoded string literal"
  - "_background_tasks module-level set + done_callback prevents Python GC from silently killing Task mid-execution"
  - "Files eagerly read before 202 response — UploadFile objects close after Starlette sends response"

patterns-established:
  - "Strong Task references: t = asyncio.create_task(...); _background_tasks.add(t); t.add_done_callback(_background_tasks.discard)"
  - "Background job lifecycle: store_job(pending) -> create_task -> store_job(running) -> compute -> store_job(completed|failed)"

requirements-completed: [PREC-01, PREC-02, PREC-04, PREC-05]

# Metrics
duration: 3min
completed: 2026-04-02
---

# Phase 03 Plan 02: Precompute Router Summary

**POST /precompute dispatches 2^N-1 async Over/HT jobs via ThreadPoolExecutor with get_or_compute ensuring results land in Redis for cache_hit=true on /analyze**

## Performance

- **Duration:** 3 min
- **Started:** 2026-04-02T17:55:32Z
- **Completed:** 2026-04-02T17:58:41Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments

- `routers/precompute.py` created: POST /precompute (202) + GET /jobs/{job_id} with full background dispatch
- Background computation uses `get_or_compute` so results are stored under `analysis:{cache_key}` in Redis — subsequent `/analyze` calls with same files return `cache_hit=true`
- Precompute router wired into FastAPI app; endpoints visible in Swagger at `/docs`

## Task Commits

1. **Task 1: Create precompute router** - `1b034b9` (feat)
2. **Task 2: Wire router into app and update env example** - `58667a8` (feat)

## Files Created/Modified

- `routers/precompute.py` - Full precompute router: combination generator, background dispatch, job status endpoint
- `main.py` - Import and register precompute_router
- `.env.example` - Document CACHE_TTL_JOB=7200

## Decisions Made

- `get_or_compute` wraps `_build_analysis_result` inside `_dispatch_job` so the result is written to `analysis:{cache_key}` in Redis. Calling `_build_analysis_result` directly would compute the result but discard it — subsequent `/analyze` calls would miss the cache.
- `PRECOMPUTE_STRATEGY` derived at module import via `next(k for k in ESTRATEGIAS if "Over/HT" in k)` — fails loudly at import time if strategy is renamed in `strategies.py`, never silently at runtime.
- `_background_tasks` module-level set + `add_done_callback(discard)` prevents Python from garbage-collecting asyncio Task objects mid-execution.
- File bytes read eagerly inside `precompute()` before the 202 response is sent — Starlette closes UploadFile objects after response dispatch.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

Python runtime not installed outside Docker — static verification used (grep + file inspection) instead of executing `python -c` test commands. All acceptance criteria confirmed via content checks.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Phase 03 complete: all async pre-computation infrastructure is in place
- Frontend can call POST /precompute after file upload, poll GET /jobs/{job_id}, then call POST /analyze to retrieve cached results
- CACHE_TTL_JOB must be set in Portainer env vars (7200 default if not set)

---
*Phase: 03-async-pre-computation*
*Completed: 2026-04-02*
