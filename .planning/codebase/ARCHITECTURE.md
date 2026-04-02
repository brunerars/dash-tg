# Architecture

**Analysis Date:** 2026-04-02

## Pattern Overview

**Overall:** Layered API with strategy-driven pipeline processing

**Key Characteristics:**
- Single FastAPI application with one router serving all endpoints
- Sequential data-processing pipeline: load -> normalize -> deduplicate -> compute metrics -> filter
- Redis cache layer sits between request handling and pipeline execution (cache-aside pattern)
- Strategy configuration as single source of truth in `config/strategies.py` -- pipeline components receive parameters, never hardcode them
- Stateless API -- all state lives in Redis or is computed per-request from uploaded files

## Layers

**HTTP Layer (FastAPI):**
- Purpose: Request handling, validation, authentication, response serialization
- Location: `main.py`, `routers/analysis.py`
- Contains: Route definitions, input validation, file upload handling, response formatting
- Depends on: Service layer, config layer, middleware
- Used by: External HTTP clients (frontend, API consumers)

**Middleware Layer:**
- Purpose: Cross-cutting concerns (authentication, CORS)
- Location: `middleware/auth.py`, CORS config in `main.py`
- Contains: API key validation via `X-API-Key` header
- Depends on: `config/settings.py` for `API_KEYS`
- Used by: All authenticated endpoints via `Depends(verify_api_key)`

**Service Layer:**
- Purpose: Core business logic -- file parsing, normalization, deduplication, metrics
- Location: `esoccer_dashboard/services/`
- Contains: Five service modules (loader, normalizer, deduplicator, metrics, cache)
- Depends on: pandas, numpy, redis, openpyxl
- Used by: `routers/analysis.py`

**Config Layer:**
- Purpose: Strategy definitions and environment settings
- Location: `config/strategies.py`, `config/settings.py`
- Contains: Strategy parameter dictionaries, env var loading
- Depends on: `python-dotenv` for env loading
- Used by: Router (strategy lookup), middleware (API keys), cache (Redis URL, TTLs)

## Data Flow

**POST /analyze (primary flow):**

1. Client sends multipart form with `.xlsx` files + strategy name + optional filters (date_from, date_to, horarios)
2. `verify_api_key` dependency validates `X-API-Key` header against `config.settings.API_KEYS`
3. `analyze()` in `routers/analysis.py` validates strategy name via `get_strategy_internal()`
4. Validates date format and horario format if provided
5. Reads all file bytes into memory as `list[tuple[str, bytes]]`
6. Calls `_analyze_with_strategy()` which:
   a. Generates `cache_key` = MD5(sorted file bytes + strategy + date_from + date_to + horarios)
   b. Calls `get_or_compute(cache_key, compute_fn)` -- returns cached result if exists
   c. On cache MISS, `compute_fn` executes the full pipeline:

**Processing Pipeline (inside compute_fn):**

```
Step 1: LOAD
  Per-file: check Redis for filedf:{md5(content)} -> hit: unpickle DataFrame
                                                   -> miss: load_tips_enviadas() -> pickle & store
  Concatenate all DataFrames

Step 1b: DATE FILTER (optional)
  Filter df by Data column if date_from/date_to provided

Step 1c: EXTRACT HORARIOS
  Capture unique "Horario Jogo" minute values for frontend filter dropdown

Step 1d: HORARIO FILTER (optional)
  Filter df by Horario Jogo minutes if horarios list provided

Step 2: NORMALIZE
  add_dupla_normalizada(df) -> adds "DuplaNormalizada" column
  Alphabetically sorts player names, handles suffixes like (2x6)

Step 3: DEDUPLICATE
  deduplicate_clusters(df, dedup_key=estrategia["dedup_key_internal"])
  Groups by dedup_key, clusters rows within 5-min window across different source files
  Keeps latest timestamp per cluster

Step 3b: STORE BLUEPRINT
  Stores full dedup'd DataFrame as JSON in Redis (blueprint:{cache_key})

Step 4: COMPUTE METRICS
  compute_metrics(df, group_by=estrategia["group_by_internal"], sistema_red_janela_horas=...)
  Groups by strategy's group_by columns, calculates 16 metrics per group

Step 5: FILTER
  Apply min_jogos and min_green_pct thresholds from strategy config

Step 6: SERIALIZE
  Convert numpy types to Python natives for JSON serialization

Step 7: STORE EXPORT
  Generate .xlsx from filtered metrics DataFrame, store in Redis (export:{cache_key})
```

**State Management:**
- No in-process state between requests -- fully stateless
- Redis stores: analysis results (JSON), exports (base64 xlsx), blueprints (JSON), file DataFrames (pickle)
- File data is ephemeral -- uploaded per-request, not persisted to disk

## Key Abstractions

**Strategy Config:**
- Purpose: Parameterizes the entire pipeline per analysis type
- Definition: `config/strategies.py` -> `ESTRATEGIAS` dict
- Pattern: `get_strategy_internal()` translates shorthand column names (e.g., "Dupla" -> "DuplaNormalizada") and returns enriched config with `group_by_internal` and `dedup_key_internal`
- All pipeline functions receive strategy parameters as arguments -- zero hardcoded values

**LoadResult (`esoccer_dashboard/services/loader.py`):**
- Purpose: Encapsulates loaded DataFrame + raw row count
- Pattern: Frozen dataclass `LoadResult(df, total_jogos_brutos)`

**DedupResult (`esoccer_dashboard/services/deduplicator.py`):**
- Purpose: Encapsulates deduplicated DataFrame + post-dedup row count
- Pattern: Frozen dataclass `DedupResult(df, total_jogos_apos_dedup)`

**MetricsResult (`esoccer_dashboard/services/metrics.py`):**
- Purpose: Encapsulates metrics DataFrame (one row per group)
- Pattern: Frozen dataclass `MetricsResult(df)`

**UploadedLike Protocol (`esoccer_dashboard/services/loader.py`):**
- Purpose: Abstracts file input (works with both FastAPI UploadFile and test doubles)
- Pattern: Structural typing via `Protocol` with `name: str` and `getvalue() -> bytes`
- Adapter: `_UploadFileAdapter` in `routers/analysis.py` bridges FastAPI `UploadFile` to this protocol

## Entry Points

**Application Entry (`main.py`):**
- Location: `main.py`
- Triggers: `uvicorn main:app` (Docker CMD)
- Responsibilities: Creates FastAPI app, configures CORS (allow all origins), mounts the analysis router, defines `/health` endpoint

**Analysis Router (`routers/analysis.py`):**
- Location: `routers/analysis.py`
- Triggers: HTTP requests to `/analyze`, `/strategies`, `/export/{cache_key}`, `/blueprint/{cache_key}`, `/cache/status`, `/cache/{cache_key}`
- Responsibilities: All business endpoints. Orchestrates the full pipeline via `_analyze_with_strategy()`

## Error Handling

**Strategy:** Raise `HTTPException` with specific status codes at the router level. Services raise `ValueError` for data issues.

**Patterns:**
- 401: Invalid API key (`middleware/auth.py`)
- 404: Cache key not found for export/blueprint/cache delete (`routers/analysis.py`)
- 422: Invalid strategy name, invalid date format, invalid horario format, duplicate filenames, no data in filtered period (`routers/analysis.py`)
- 503: Redis unavailable (`routers/analysis.py` -> `cache_status()`)
- `ValueError` from `loader.py`: Missing sheet "Tips Enviadas", missing required columns, invalid Data/Hora, invalid Resultado values
- `ValueError` from `deduplicator.py`: Missing required columns in DataFrame
- `ValueError` from `metrics.py`: Missing required columns in DataFrame

**Note:** Service-layer `ValueError` exceptions are NOT caught by the router -- they propagate as 500 Internal Server Error. Only cache/strategy/validation errors have explicit HTTP error handling.

## Cross-Cutting Concerns

**Logging:** No structured logging framework. No logging statements in any service or router code. Relies on uvicorn default access logs only.

**Validation:** Input validation in `analyze()` endpoint: strategy existence, date format (ISO), horario format (integer minutes), duplicate filename detection. Column validation in each service module via explicit checks against required column lists.

**Authentication:** API key via `X-API-Key` header. Keys loaded from `API_KEYS` env var (comma-separated). Implemented as FastAPI dependency `verify_api_key` in `middleware/auth.py`. Applied to all endpoints except `GET /strategies` and `GET /health`.

**Caching:** Redis cache-aside pattern. Four key prefixes: `analysis:`, `export:`, `blueprint:`, `filedf:`. Analysis TTL: 24h. Export TTL: 1h. File DataFrame TTL: 24h. Cache key = MD5 of sorted file bytes + strategy + optional filters.

---

*Architecture analysis: 2026-04-02*
