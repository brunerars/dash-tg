# External Integrations

**Analysis Date:** 2026-04-02

## APIs & External Services

**None** - This is a self-contained API backend. It does not call any external APIs or third-party services. All data comes from uploaded `.xlsx` files.

## Data Storage

**Redis 7 (cache layer):**
- Connection: `REDIS_URL` env var (default `redis://localhost:6379`)
- Client: `redis-py` via `redis.from_url()` with singleton pattern
- Implementation: `esoccer_dashboard/services/cache.py`
- Connection mode: `decode_responses=False` (binary mode for pickle/base64 data)

**Redis Key Namespaces:**
| Prefix | Purpose | TTL | Data Format |
|--------|---------|-----|-------------|
| `analysis:{cache_key}` | Full analysis results | 24h (`CACHE_TTL_ANALYSIS`) | JSON string |
| `export:{cache_key}` | Generated `.xlsx` files | 1h (`CACHE_TTL_EXPORT`) | Base64-encoded bytes |
| `blueprint:{cache_key}` | Raw deduped DataFrame for audit | 24h (`CACHE_TTL_ANALYSIS`) | JSON (pandas `to_json`) |
| `filedf:{file_hash}` | Per-file parsed DataFrame | 24h (`CACHE_TTL_ANALYSIS`) | Pickled bytes |

**Cache Key Generation** (`esoccer_dashboard/services/cache.py` `gerar_cache_key()`):
- MD5 hash of: sorted file bytes + strategy name + optional date_from + date_to + horarios
- Deterministic: same files + same parameters = same key regardless of upload order

**File Storage:**
- Upload: Files received via `multipart/form-data` in memory (no disk persistence)
- Data directory: `DATA_DIR` env var (`/app/data`) mounted read-only in Docker
- Export: Generated `.xlsx` stored in Redis (not filesystem)

**Caching:** Redis only (no in-memory application cache)

## Authentication & Identity

**API Key (custom header-based):**
- Implementation: `middleware/auth.py` `verify_api_key()`
- Header: `X-API-Key`
- Keys stored in: `API_KEYS` env var (comma-separated)
- Parsed at startup: `config/settings.py` splits into `set[str]`
- Applied as: FastAPI `Depends()` on all protected endpoints
- Error: HTTP 401 `"API Key inválida"`

**Protected endpoints:**
- `POST /analyze` - requires `X-API-Key`
- `GET /export/{cache_key}` - requires `X-API-Key`
- `GET /blueprint/{cache_key}` - requires `X-API-Key`
- `GET /cache/status` - requires `X-API-Key`
- `DELETE /cache/{cache_key}` - requires `X-API-Key`

**Unprotected endpoints:**
- `GET /strategies` - public (no auth)
- `GET /health` - public (no auth)

## Monitoring & Observability

**Error Tracking:** None (no Sentry, Datadog, etc.)

**Logs:** Default Uvicorn stdout logging. No structured logging framework.

**Health Check:** `GET /health` returns `{"status": "ok"}` - defined in `main.py`

**Cache Monitoring:** `GET /cache/status` returns Redis stats (keys, memory, hit rate, uptime) - implemented in `esoccer_dashboard/services/cache.py` `get_cache_stats()`

## CI/CD & Deployment

**Hosting:** VPS via Docker Compose

**CI Pipeline:** None detected (no `.github/workflows/`, no `Jenkinsfile`, no CI config)

**Deployment:**
- `docker-compose.yml` defines two services: `api` + `redis`
- API builds from local `Dockerfile`
- Redis uses `redis:7-alpine` image
- Data volume mounted read-only: `./data:/app/data:ro`
- Redis data persisted via named volume `redis_data`

## CORS Configuration

**Defined in:** `main.py`
- `allow_origins=["*"]` - all origins allowed
- `allow_methods=["*"]` - all HTTP methods
- `allow_headers=["*"]` - all headers
- Wide-open CORS suitable for any frontend client

## File I/O

**Input (xlsx reading):**
- Engine: openpyxl (explicit `engine="openpyxl"` in `pd.read_excel()`)
- Sheet: Only reads tab named `"Tips Enviadas"` (`esoccer_dashboard/services/loader.py`)
- Required columns: `Torneio`, `Confronto`, `Data`, `Hora`, `Resultado`, `Lucro/Prej.`
- Optional columns: `Linha`, `Horario Jogo`
- Date format: Brazilian `DD/MM/YYYY` with fallback
- Time format: `HH:MM:SS` with `HH:MM` fallback
- Profit format: Brazilian number format (`.` as thousands, `,` as decimal)

**Output (xlsx writing):**
- Engine: openpyxl (explicit `engine="openpyxl"` in `pd.ExcelWriter()`)
- Generated in `routers/analysis.py` `_store_xlsx()`, stored in Redis
- Downloaded via `GET /export/{cache_key}` as `StreamingResponse`

**Bet source detection** (`esoccer_dashboard/services/loader.py` `_detect_bet()`):
- Extracts betting platform name from upload filename
- Patterns: BETANO, NOVIBET, 365, SUPER + short codes (B, 3, S, N)

## API Contract Summary

**Base URL:** `http://{host}:8000`

| Method | Path | Auth | Content-Type | Purpose |
|--------|------|------|-------------|---------|
| GET | `/health` | No | - | Health check |
| GET | `/strategies` | No | - | List available strategies |
| POST | `/analyze` | Yes | `multipart/form-data` | Upload files + run analysis |
| GET | `/blueprint/{cache_key}` | Yes | - | Audit trail for a dupla |
| GET | `/export/{cache_key}` | Yes | - | Download `.xlsx` result |
| GET | `/cache/status` | Yes | - | Redis stats |
| DELETE | `/cache/{cache_key}` | Yes | - | Invalidate cache entry |

**POST /analyze form fields:**
- `files` (required): Multiple `.xlsx` file uploads
- `strategy` (required): Strategy name string (from `/strategies`)
- `date_from` (optional): `YYYY-MM-DD` date filter start
- `date_to` (optional): `YYYY-MM-DD` date filter end
- `horarios` (optional): Comma-separated game minute filter

**Swagger UI:** Available at `/docs` with `persistAuthorization: true`

## Environment Configuration

**Required env vars:**
- `API_KEYS` - Comma-separated API keys for client authentication

**Optional env vars (have defaults):**
- `REDIS_URL` - Default: `redis://localhost:6379`
- `CACHE_TTL_ANALYSIS` - Default: `86400` (24 hours)
- `CACHE_TTL_EXPORT` - Default: `3600` (1 hour)
- `DATA_DIR` - Default: `/app/data`

**Env files present:**
- `.env.example` - Template with placeholder values
- `.env` - Active config (not committed)
- `.env.prod` - Production config (not committed)

## Webhooks & Callbacks

**Incoming:** None

**Outgoing:** None

## Docker Networking

- `api` and `redis` services on same Docker Compose network (default bridge)
- API reaches Redis at hostname `redis` on port 6379 (via `REDIS_URL=redis://redis:6379`)
- Only API port 8000 exposed to host
- Redis not exposed externally (no `ports` mapping)

---

*Integration audit: 2026-04-02*
