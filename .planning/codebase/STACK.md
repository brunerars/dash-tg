# Technology Stack

**Analysis Date:** 2026-04-02

## Languages

**Primary:**
- Python 3.11 - All backend code (`main.py`, `routers/`, `esoccer_dashboard/`, `config/`, `middleware/`)

**Secondary:**
- None (pure Python backend)

## Runtime

**Environment:**
- Python 3.11-slim (Docker base image `python:3.11-slim`)
- Uvicorn ASGI server

**Package Manager:**
- pip (no pinned versions in `requirements.txt`)
- Lockfile: missing - dependencies are unpinned

## Frameworks

**Core:**
- FastAPI (unversioned) - HTTP API framework with automatic OpenAPI/Swagger docs at `/docs`
- Pydantic (unversioned) - Data validation (FastAPI dependency)
- Uvicorn[standard] (unversioned) - ASGI server, production entry point

**Data Processing:**
- pandas (unversioned) - DataFrame operations for metrics calculation
- numpy (unversioned) - Numerical operations (SRPT formula, streak calculations)
- openpyxl (unversioned) - Excel `.xlsx` read/write engine

**Testing:**
- pytest (unversioned) - Test runner

**Build/Dev:**
- Docker + Docker Compose - Container orchestration
- python-dotenv (unversioned) - `.env` file loading

## Key Dependencies

**Critical (core pipeline):**
- `fastapi` - HTTP layer, routing, request validation, OpenAPI generation
- `pandas` - All data manipulation: loading, deduplication, metrics, export
- `openpyxl` - Excel engine for both reading uploaded `.xlsx` and writing export files
- `redis` - Cache client (redis-py), connects to Redis 7

**Infrastructure:**
- `python-multipart` - Required by FastAPI for `multipart/form-data` file uploads
- `python-dateutil` - Date parsing utilities (imported transitively by pandas)
- `python-dotenv` - Loads `.env` into `os.environ` at startup in `config/settings.py`

**Serialization:**
- `pickle` - Used in `routers/analysis.py` for caching individual file DataFrames in Redis
- `json` - Analysis results serialized as JSON in Redis
- `base64` - Export `.xlsx` bytes encoded as base64 for Redis storage

## Configuration

**Environment:**
- All config via environment variables loaded in `config/settings.py`
- `.env` file loaded by `python-dotenv` at import time
- `.env.example` documents required variables:
  - `API_KEYS` - Comma-separated client API keys
  - `REDIS_URL` - Redis connection string (default: `redis://localhost:6379`)
  - `CACHE_TTL_ANALYSIS` - Analysis cache TTL in seconds (default: `86400` = 24h)
  - `CACHE_TTL_EXPORT` - Export cache TTL in seconds (default: `3600` = 1h)
  - `DATA_DIR` - Data directory path (default: `/app/data`)

**Build:**
- `Dockerfile` - Single-stage build from `python:3.11-slim`
- `docker-compose.yml` - Two services: `api` (port 8000) + `redis` (Redis 7 Alpine)
- `requirements.txt` - Flat dependency list, no version pins

## Platform Requirements

**Development:**
- Python 3.11+
- Redis 7 server (local or Docker)
- No frontend build step needed (API-only backend)

**Production:**
- Docker + Docker Compose
- VPS with ports: 8000 (API)
- Redis runs as sidecar container (no external Redis service)
- Data volume: `./data` mounted read-only at `/app/data`
- Persistent Redis volume: `redis_data`

**Docker Configuration:**
- `Dockerfile`: Sets `PYTHONDONTWRITEBYTECODE=1`, `PYTHONUNBUFFERED=1`
- Exposes port 8000, runs `uvicorn main:app --host 0.0.0.0 --port 8000`
- `docker-compose.yml`: API depends on Redis, both `restart: unless-stopped`
- Data directory mounted as read-only volume: `./data:/app/data:ro`

---

*Stack analysis: 2026-04-02*
