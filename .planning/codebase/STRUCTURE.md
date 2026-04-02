# Codebase Structure

**Analysis Date:** 2026-04-02

## Directory Layout

```
dash-tg/
├── main.py                          # FastAPI app entry point
├── requirements.txt                 # Python dependencies (unpinned)
├── Dockerfile                       # Python 3.11-slim + uvicorn
├── docker-compose.yml               # API + Redis (dev)
├── docker-compose.prod.yml          # Production compose
├── CLAUDE.md                        # Project instructions / spec
├── .env.example                     # (exists, not read)
├── config/
│   ├── __init__.py
│   ├── settings.py                  # Env var loading (API_KEYS, REDIS_URL, TTLs)
│   └── strategies.py                # Strategy definitions (source of truth)
├── middleware/
│   ├── __init__.py
│   └── auth.py                      # API key validation dependency
├── routers/
│   ├── __init__.py
│   └── analysis.py                  # All API endpoints + pipeline orchestration
├── esoccer_dashboard/
│   ├── __init__.py
│   └── services/
│       ├── __init__.py
│       ├── loader.py                # xlsx file parsing (Tips Enviadas sheet)
│       ├── normalizer.py            # Dupla name normalization
│       ├── deduplicator.py          # Cluster-based deduplication
│       ├── metrics.py               # 16 metrics calculation per group
│       └── cache.py                 # Redis operations (get/set/delete)
├── tests/
│   ├── test_deduplicator.py         # Deduplication unit tests
│   └── test_normalizer.py           # Normalizer unit tests
├── test_api.py                      # API-level test (root level)
├── test_api2.py                     # API-level test (root level)
├── esoccerdashboard/                # Frontend app (React/Vite) -- separate concern
│   ├── src/
│   ├── package.json
│   ├── Dockerfile
│   └── ...
├── .github/
│   └── workflows/
│       └── deploy.yml               # CI/CD pipeline
└── docs/
    └── frontend-guide.md
```

## Directory Purposes

**`config/`:**
- Purpose: Application configuration and strategy definitions
- Contains: Two Python modules
- Key files:
  - `config/strategies.py`: The single source of truth for strategy parameters. `ESTRATEGIAS` dict defines `group_by`, `dedup_key`, `min_jogos`, `min_green_pct`, `sistema_red_janela_horas` per strategy. `get_strategy_internal()` translates shorthand column names to real DataFrame column names.
  - `config/settings.py`: Loads env vars via `python-dotenv`. Exports `API_KEYS`, `REDIS_URL`, `CACHE_TTL_ANALYSIS`, `CACHE_TTL_EXPORT`, `DATA_DIR`.

**`middleware/`:**
- Purpose: HTTP middleware / FastAPI dependencies
- Contains: Single auth module
- Key files:
  - `middleware/auth.py`: `verify_api_key()` async dependency. Checks `X-API-Key` header against `config.settings.API_KEYS` set.

**`routers/`:**
- Purpose: FastAPI route definitions
- Contains: Single router module
- Key files:
  - `routers/analysis.py`: All endpoints. Contains `_analyze_with_strategy()` which orchestrates the full processing pipeline. Also contains `_UploadFileAdapter` class and `_store_xlsx()` helper.

**`esoccer_dashboard/services/`:**
- Purpose: Core business logic -- data processing pipeline components
- Contains: Five service modules, each with a single responsibility
- Key files:
  - `esoccer_dashboard/services/loader.py`: Reads `.xlsx` files, validates "Tips Enviadas" sheet, parses dates/times/results/lucro, detects bet source from filename
  - `esoccer_dashboard/services/normalizer.py`: Normalizes "Confronto" column into "DuplaNormalizada" -- alphabetical sort, suffix handling
  - `esoccer_dashboard/services/deduplicator.py`: Removes duplicate entries across files within 5-min time window clusters
  - `esoccer_dashboard/services/metrics.py`: Computes 16 metrics per group (green%, SRPT, streaks, sistema red, etc.)
  - `esoccer_dashboard/services/cache.py`: All Redis operations -- key generation, get/set with TTL, stats, per-file caching

**`tests/`:**
- Purpose: Unit tests
- Contains: Tests for deduplicator and normalizer
- Key files: `tests/test_deduplicator.py`, `tests/test_normalizer.py`

**`esoccerdashboard/`:**
- Purpose: Frontend React/Vite application (separate deployable)
- Contains: Full React SPA with TypeScript, TailwindCSS, shadcn/ui components
- Note: This is a separate app within the same repo. Has its own `Dockerfile`, `package.json`, `vite.config.ts`. Consumes the API.

## Key File Locations

**Entry Points:**
- `main.py`: FastAPI application creation, CORS setup, router mounting, `/health` endpoint
- `Dockerfile`: `CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]`

**Configuration:**
- `config/strategies.py`: Strategy parameter definitions (add new strategies here only)
- `config/settings.py`: Environment variable loading
- `docker-compose.yml`: Service orchestration (api + redis)
- `.env.example`: Required env var template (exists, contents not read)

**Core Logic (pipeline order):**
- `esoccer_dashboard/services/loader.py`: Step 1 -- file loading and parsing
- `esoccer_dashboard/services/normalizer.py`: Step 2 -- dupla normalization
- `esoccer_dashboard/services/deduplicator.py`: Step 3 -- cluster deduplication
- `esoccer_dashboard/services/metrics.py`: Step 4 -- metrics calculation
- `esoccer_dashboard/services/cache.py`: Cache layer used throughout

**Pipeline Orchestration:**
- `routers/analysis.py` -> `_analyze_with_strategy()`: Calls all services in order, handles caching

**Testing:**
- `tests/test_deduplicator.py`: Deduplication logic tests
- `tests/test_normalizer.py`: Normalization logic tests
- `test_api.py`, `test_api2.py`: API-level tests (root level, outside tests/ dir)

## Module Dependencies

**Import graph (backend only):**

```
main.py
  └── routers.analysis (router)

routers/analysis.py
  ├── config.strategies (ESTRATEGIAS, get_strategy_internal)
  ├── esoccer_dashboard.services.cache (all cache functions)
  ├── esoccer_dashboard.services.deduplicator (deduplicate_clusters)
  ├── esoccer_dashboard.services.loader (LoadResult, load_tips_enviadas)
  ├── esoccer_dashboard.services.metrics (compute_metrics)
  ├── esoccer_dashboard.services.normalizer (add_dupla_normalizada)
  └── middleware.auth (verify_api_key)

middleware/auth.py
  └── config.settings (API_KEYS)

esoccer_dashboard/services/cache.py
  └── config.settings (REDIS_URL, CACHE_TTL_ANALYSIS, CACHE_TTL_EXPORT)

esoccer_dashboard/services/loader.py
  └── pandas, openpyxl (external only)

esoccer_dashboard/services/normalizer.py
  └── pandas, re (external/stdlib only)

esoccer_dashboard/services/deduplicator.py
  └── pandas (external only)

esoccer_dashboard/services/metrics.py
  └── pandas, numpy (external only)

config/strategies.py
  └── (no internal deps)

config/settings.py
  └── python-dotenv (external only)
```

**Key observation:** Service modules (`loader`, `normalizer`, `deduplicator`, `metrics`) have zero internal cross-dependencies. They only depend on external libraries (pandas, numpy). All orchestration happens in `routers/analysis.py`.

## Naming Conventions

**Files:**
- Python modules: `snake_case.py` (e.g., `loader.py`, `strategies.py`)
- Config files: lowercase (e.g., `requirements.txt`, `docker-compose.yml`)

**Directories:**
- All lowercase, no hyphens in Python packages (e.g., `esoccer_dashboard/`, `config/`, `routers/`)
- Exception: `esoccerdashboard/` (frontend, no underscore)

**Functions:**
- Public: `snake_case` (e.g., `load_tips_enviadas`, `compute_metrics`, `deduplicate_clusters`)
- Private: `_snake_case` with leading underscore (e.g., `_analyze_with_strategy`, `_store_xlsx`, `_reds_after_red`)

**Data classes:**
- PascalCase: `LoadResult`, `DedupResult`, `MetricsResult`, `PlayerName`
- All frozen dataclasses

## Where to Add New Code

**New Strategy:**
- Only edit `config/strategies.py` -> add entry to `ESTRATEGIAS` dict
- Never modify `metrics.py`, `deduplicator.py`, or `loader.py`

**New Endpoint:**
- Add to `routers/analysis.py`
- Use `AuthDep` type alias for authenticated endpoints: `_key: AuthDep`
- Follow existing pattern: function with type hints, docstring, HTTPException for errors

**New Service Module:**
- Add to `esoccer_dashboard/services/`
- Follow pattern: frozen dataclass for result, pure function taking DataFrame + config params
- Import and call from `routers/analysis.py`

**New Pipeline Step:**
- Add service in `esoccer_dashboard/services/`
- Wire into `_analyze_with_strategy()` in `routers/analysis.py`
- Respect pipeline order: load -> normalize -> deduplicate -> FREEZE -> metrics -> filter

**New Middleware:**
- Add to `middleware/`
- Register as FastAPI dependency or middleware in `main.py`

**New Tests:**
- Unit tests: `tests/test_{module}.py`
- Follow existing pattern in `tests/test_deduplicator.py`

**Utilities:**
- No shared utils directory exists. Helpers are currently private functions within their respective modules (e.g., `_parse_date_series` in `loader.py`, `_max_streak` in `metrics.py`).
- If cross-module utilities are needed, create `esoccer_dashboard/services/utils.py`

## Special Directories

**`esoccerdashboard/`:**
- Purpose: Frontend React application (separate deployable)
- Generated: Build output in `dist/` (not committed)
- Committed: Source code is committed
- Note: Has its own Dockerfile, deployed independently

**`data/`:**
- Purpose: Mounted volume for xlsx data files (Docker)
- Generated: No
- Committed: No (volume mount, `.dockerignore`d)
- Referenced by: `config/settings.py` -> `DATA_DIR`

**`.github/workflows/`:**
- Purpose: CI/CD deployment pipeline
- Contains: `deploy.yml`

---

*Structure analysis: 2026-04-02*
