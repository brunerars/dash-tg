---
phase: 03-async-pre-computation
verified: 2026-04-02T18:30:00Z
status: passed
score: 6/6 must-haves verified
re_verification: false
---

# Phase 3: Async Pre-computation Verification Report

**Phase Goal:** Uploading N spreadsheets automatically triggers computation of all 2^N-1 Over/HT combinations in background; user finds results ready without waiting
**Verified:** 2026-04-02
**Status:** PASSED
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | POST /precompute with N files returns 202 immediately with job_ids list of length 2^N-1 | VERIFIED | `routers/precompute.py:72-115` — `status_code=202`, `_all_nonempty_combinations` generates 2^N-1 subsets via `range(1, len+1)` + `combinations`, returns `{"job_ids": [...], "total_jobs": N}` |
| 2 | GET /jobs/{job_id} returns status pending/running/completed/failed and cache_key when complete | VERIFIED | `routers/precompute.py:118-128` — delegates to `get_job(job_id)`, returns 404 on None, otherwise full job dict with `status` + `cache_key` fields |
| 3 | Background computation runs in ThreadPoolExecutor without blocking event loop | VERIFIED | `routers/precompute.py:23,60` — module-level `ThreadPoolExecutor(max_workers=2)`; pipeline called via `await loop.run_in_executor(_executor, lambda: get_or_compute(...))` using `asyncio.get_running_loop()` |
| 4 | After jobs complete, POST /analyze with same files returns cache_hit true | VERIFIED | `routers/precompute.py:62-65` — `_dispatch_job` uses `get_or_compute(cache_key, lambda: _build_analysis_result(...))` which stores result under `analysis:{cache_key}` in Redis (same key `_analyze_with_strategy` checks); subsequent `/analyze` calls with same files will hit cache |
| 5 | Jobs stored in Redis expire via TTL — stale "running" entries do not accumulate after crash | VERIFIED | `esoccer_dashboard/services/cache.py:110` — `store_job` always uses `r.setex(f"job:{job_id}", ttl, ...)`, TTL set at every write (pending, running, completed, failed); default `CACHE_TTL_JOB=7200` |
| 6 | Strategy name is sourced from config/strategies.py ESTRATEGIAS dict, not a hardcoded string | VERIFIED | `routers/precompute.py:21` — `PRECOMPUTE_STRATEGY: str = next(k for k in ESTRATEGIAS if "Over/HT" in k)`; fails loudly at import time if strategy is renamed |

**Score:** 6/6 truths verified

---

## Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `routers/analysis.py` | Extracted sync `_build_analysis_result()` + refactored `_analyze_with_strategy` | VERIFIED | 359 lines; `def _build_analysis_result(` at line 53 (not async); `_analyze_with_strategy` calls it at line 184 inside `compute()` closure passed to `get_or_compute` |
| `routers/precompute.py` | POST /precompute and GET /jobs/{job_id} endpoints | VERIFIED | 128 lines (exceeds min_lines:60); contains `router = APIRouter()`, both endpoints, combination generator, `_dispatch_job`, `_background_tasks` set |
| `esoccer_dashboard/services/cache.py` | `store_job` and `get_job` helpers with setex TTL | VERIFIED | 154 lines; `store_job` at line 100, `get_job` at line 113; `r.setex(f"job:{job_id}", ttl, ...)` confirmed at line 110 |
| `config/settings.py` | `CACHE_TTL_JOB` env variable | VERIFIED | Line 14: `CACHE_TTL_JOB: int = int(os.getenv("CACHE_TTL_JOB", "7200"))` |
| `main.py` | Precompute router mounted on the app | VERIFIED | Line 8: `from routers.precompute import router as precompute_router`; line 29: `app.include_router(precompute_router, tags=["pre-computation"])` |

---

## Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `routers/precompute.py` | `routers/analysis.py` | `from routers.analysis import _build_analysis_result` | WIRED | Line 14 of precompute.py; function called at line 64 |
| `routers/precompute.py` | `esoccer_dashboard/services/cache.py` | `from esoccer_dashboard.services.cache import store_job, get_job, gerar_cache_key, get_or_compute` | WIRED | Line 12 of precompute.py; all four symbols used: `store_job` at lines 49/67/68, `get_job` at line 125, `gerar_cache_key` at line 54, `get_or_compute` at line 62 |
| `routers/precompute.py (_dispatch_job)` | `esoccer_dashboard/services/cache.py (get_or_compute)` | `get_or_compute(cache_key, ...)` stores analysis result in Redis | WIRED | `get_or_compute` called at line 62 inside `run_in_executor` lambda; stores `analysis:{cache_key}` in Redis — same key `/analyze` checks |
| `routers/precompute.py` | `config.strategies` | `from config.strategies import ESTRATEGIAS` | WIRED | Line 11 of precompute.py; `PRECOMPUTE_STRATEGY` derived from `ESTRATEGIAS` at module load |
| `routers/precompute.py` | `concurrent.futures.ThreadPoolExecutor` | module-level `_executor` | WIRED | Line 23: `_executor = ThreadPoolExecutor(max_workers=2)`; used at line 60 in `run_in_executor` |
| `main.py` | `routers/precompute.py` | `app.include_router(precompute_router, ...)` | WIRED | Line 29 of main.py |
| `esoccer_dashboard/services/cache.py` | `config/settings.py` | `from config.settings import ... CACHE_TTL_JOB` | WIRED | Line 9 of cache.py; `CACHE_TTL_JOB` used as default TTL in `store_job` |

---

## Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| `routers/precompute.py` (`_dispatch_job`) | `_result` from pipeline | `get_or_compute -> _build_analysis_result -> compute_metrics` (full pandas pipeline) | Yes — same pipeline as `/analyze` which processes real `.xlsx` data via `load_tips_enviadas` | FLOWING |
| `esoccer_dashboard/services/cache.py` (`store_job`) | `payload` dict with status | Caller writes status transitions: pending -> running -> completed/failed | Yes — lifecycle states are real job state, not hardcoded | FLOWING |

---

## Behavioral Spot-Checks

Step 7b is partially applicable. Python is not available outside Docker on this machine (Windows Store Python fails). Static verification substituted.

| Behavior | Check Method | Result | Status |
|----------|-------------|--------|--------|
| `_all_nonempty_combinations` returns 2^N-1 for N=3 | Code inspection: `range(1, 4)` gives r=1,2,3; `C(3,1)+C(3,2)+C(3,3) = 3+3+1 = 7 = 2^3-1` | 7 combinations confirmed mathematically | PASS |
| `store_job` always uses `setex` (not `set`) | `grep setex cache.py` | Line 110: `r.setex(f"job:{job_id}", ttl, ...)` | PASS |
| `_build_analysis_result` is a plain sync function | `grep "def _build_analysis_result"` — no `async` prefix | Line 53: `def _build_analysis_result(` | PASS |
| precompute router mounted in app | Code inspection `main.py:29` | `app.include_router(precompute_router, ...)` present | PASS |

---

## Requirements Coverage

All six requirements explicitly mapped to this phase:

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| PREC-01 | 03-02-PLAN.md | Upload de N planilhas dispara 2^N-1 combinacoes para Over/Under | SATISFIED | `_all_nonempty_combinations` in precompute.py; POST /precompute dispatches `len(combos)` background jobs |
| PREC-02 | 03-02-PLAN.md | Endpoint retorna 202 Accepted com job IDs imediatamente | SATISFIED | `@router.post("/precompute", status_code=202)`; returns before jobs complete |
| PREC-03 | 03-01-PLAN.md | Resultados salvos no Redis conforme ficam prontos | SATISFIED | `get_or_compute` in `_dispatch_job` writes `analysis:{cache_key}` to Redis on completion |
| PREC-04 | 03-02-PLAN.md | GET /jobs/{job_id} retorna status + cache_key | SATISFIED | `@router.get("/jobs/{job_id}")` returns full job dict with `status`, `cache_key`, `error` fields |
| PREC-05 | 03-01-PLAN.md + 03-02-PLAN.md | Pipeline roda em thread/process pool sem bloquear event loop | SATISFIED | `run_in_executor(_executor, ...)` with `ThreadPoolExecutor(max_workers=2)` |
| PREC-06 | 03-01-PLAN.md | Jobs expiram do Redis com TTL | SATISFIED | `store_job` uses `setex` at every status update; `CACHE_TTL_JOB=7200` default |

**No orphaned requirements.** All 6 PREC-* requirements from REQUIREMENTS.md for Phase 3 are accounted for and implemented.

---

## Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| None | — | — | — | No anti-patterns found |

Specific checks run:
- No `TODO/FIXME/HACK` comments in precompute.py or analysis.py pipeline section
- No `return null/return []` stubs in endpoints
- `store_job` writes real status strings, not empty values
- No hardcoded strategy string literals (uses `next(k for k in ESTRATEGIAS ...)`)
- `_build_analysis_result` has full pipeline body (lines 53-167), not a placeholder

---

## Human Verification Required

### 1. End-to-End Cache Hit Confirmation

**Test:** POST /precompute with 2 xlsx files, poll GET /jobs/{job_id} until all 3 jobs show "completed", then POST /analyze with same 2 files and "Over/HT — Dupla + Linha" strategy
**Expected:** `/analyze` response includes `"cache_hit": true`
**Why human:** Requires running Docker stack with Redis + real xlsx files; cannot test without executing the app

### 2. Non-Blocking Behavior Under Load

**Test:** Upload 3 files to POST /precompute (7 jobs), immediately call GET /health or GET /strategies
**Expected:** Health endpoint responds in <100ms while background jobs are computing
**Why human:** Requires running app and concurrent request timing; cannot verify statically

### 3. Task GC Safety

**Test:** Upload 3 files, observe logs — all 7 jobs should reach "completed" or "failed" status, none should disappear mid-execution
**Why human:** Python GC behavior requires runtime observation; the `_background_tasks` pattern prevents it but can only be confirmed live

---

## Gaps Summary

No gaps found. All automated verifications passed:

- `_build_analysis_result` exists as a sync (non-async) module-level function callable from any thread
- `store_job` / `get_job` are implemented with `setex` TTL-at-creation
- `CACHE_TTL_JOB` is configurable via environment variable with default 7200
- `routers/precompute.py` is fully substantive (128 lines), not a stub
- All key links are wired: precompute.py imports and uses `_build_analysis_result`, `get_or_compute`, `store_job`, `get_job`, `gerar_cache_key`, `ESTRATEGIAS`
- `get_or_compute` wraps `_build_analysis_result` inside `_dispatch_job`, ensuring results land under `analysis:{cache_key}` in Redis — the exact key `/analyze` checks for cache hits
- `_background_tasks` set with `add_done_callback(discard)` prevents GC of running asyncio Tasks
- Precompute router is mounted in `main.py` via `app.include_router(precompute_router, ...)`
- `.env.example` documents `CACHE_TTL_JOB=7200`
- `PRECOMPUTE_STRATEGY` derived from `ESTRATEGIAS` dict, not a hardcoded string literal
- All 6 PREC-* requirements are satisfied with direct code evidence

---

_Verified: 2026-04-02T18:30:00Z_
_Verifier: Claude (gsd-verifier)_
