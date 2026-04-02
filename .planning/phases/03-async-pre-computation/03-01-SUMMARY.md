---
phase: 03-async-pre-computation
plan: 01
subsystem: api
tags: [fastapi, redis, cache, async, pipeline]

requires:
  - phase: 02-jwt-authentication
    provides: verify_jwt_cookie dependency used by analysis router

provides:
  - "_build_analysis_result() sync function callable from any thread (ThreadPoolExecutor)"
  - "store_job/get_job Redis helpers with setex TTL-at-creation"
  - "CACHE_TTL_JOB env-configurable setting (default 7200s)"

affects:
  - 03-02-precompute-router
  - any future plan that needs to call the pipeline from a background thread

tech-stack:
  added: []
  patterns:
    - "Sync pipeline extraction: nested compute() closure promoted to module-level function"
    - "Job state TTL-at-creation: setex on store_job ensures stale running jobs expire on worker crash"

key-files:
  created: []
  modified:
    - routers/analysis.py
    - esoccer_dashboard/services/cache.py
    - config/settings.py

key-decisions:
  - "_build_analysis_result is NOT async — enables direct call from ThreadPoolExecutor in Plan 02 without event loop bridging"
  - "store_job always uses setex (never set) — TTL must be set at creation, not only on completion, so crashed workers don't leave stale 'running' jobs"

patterns-established:
  - "job:{job_id} Redis key format for pre-computation job tracking (mirrors analysis:, export:, blueprint: prefixes)"

requirements-completed:
  - PREC-03
  - PREC-05
  - PREC-06

duration: 15min
completed: 2026-04-02
---

# Phase 03 Plan 01: Extract Sync Pipeline and Job State Infrastructure Summary

**Extracted synchronous compute pipeline into standalone `_build_analysis_result()` and added Redis job-state helpers (`store_job`/`get_job`) with TTL-at-creation for pre-computation tracking.**

## Performance

- **Duration:** ~15 min
- **Started:** 2026-04-02T17:50:00Z
- **Completed:** 2026-04-02T18:05:00Z
- **Tasks:** 1
- **Files modified:** 3

## Accomplishments

- `_build_analysis_result()` is now a module-level sync function callable from any thread (ThreadPoolExecutor-safe), containing the full pipeline: load per-file cache, date/horario filter, normalize, dedup, blueprint store, metrics, xlsx export
- `_analyze_with_strategy` refactored to thin async wrapper: computes cache_key, delegates to `_build_analysis_result` via `get_or_compute`, adds `cache_hit` field
- `store_job`/`get_job` helpers added to `cache.py` using `setex` for TTL-at-creation — ensures crashed workers don't leave stale "running" state in Redis (PREC-06)
- `CACHE_TTL_JOB = 7200` added to `config/settings.py` (overridable via env var)

## Task Commits

Each task was committed atomically:

1. **Task 1: Extract sync pipeline and add job state infrastructure** - `b4f5aa4` (feat)

**Plan metadata:** (final commit pending)

## Files Created/Modified

- `routers/analysis.py` - Extracted `_build_analysis_result()` as standalone sync function; `_analyze_with_strategy` now delegates to it
- `esoccer_dashboard/services/cache.py` - Added `store_job` and `get_job` helpers; updated import to include `CACHE_TTL_JOB`
- `config/settings.py` - Added `CACHE_TTL_JOB: int = int(os.getenv("CACHE_TTL_JOB", "7200"))`

## Decisions Made

- `_build_analysis_result` must be a plain sync function — avoids event loop bridging complexity when called from `ThreadPoolExecutor` in the precompute router (Plan 02)
- `store_job` always uses `setex` (never `set`) — TTL set at creation so even a "running" job record expires if the worker process crashes before updating status

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

Python 3.11 executable not available outside Docker on this machine (Windows Store Python fails to launch). Verified syntax with Python 3.10 AST parser and grep-based artifact checks. Runtime behavior is unchanged — `_analyze_with_strategy` still calls the same logic via the same `get_or_compute` mechanism.

## User Setup Required

None - no external service configuration required. `CACHE_TTL_JOB` can optionally be added to `.env` (defaults to 7200 seconds).

## Next Phase Readiness

- `_build_analysis_result` is importable from `routers.analysis` and callable from any thread — ready for Plan 02 precompute router
- `store_job`/`get_job` are importable from `esoccer_dashboard.services.cache` — ready for job lifecycle management
- `CACHE_TTL_JOB` is available from `config.settings`
- All existing `/analyze`, `/export`, `/blueprint`, `/strategies`, `/cache` endpoints are fully unchanged

## Self-Check: PASSED

- FOUND: routers/analysis.py
- FOUND: esoccer_dashboard/services/cache.py
- FOUND: config/settings.py
- FOUND: .planning/phases/03-async-pre-computation/03-01-SUMMARY.md
- FOUND: commit b4f5aa4

---
*Phase: 03-async-pre-computation*
*Completed: 2026-04-02*
