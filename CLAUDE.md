# CLAUDE.md v3 — Backend FastAPI + Redis — dash-tg

## Visão Geral

API backend para o dashboard de análise eSoccer multi-estratégia.
Consome planilhas `.xlsx`, processa métricas e serve resultados via HTTP com cache Redis.
O frontend (qualquer tecnologia) consome a API hospedada na VPS sem dependência da engine.

---

## Stack

| Camada | Tecnologia |
|--------|-----------|
| Backend | FastAPI + Python 3.11 |
| Processamento | pandas + openpyxl |
| Cache | Redis 7 + redis-py |
| Autenticação | API Key via header `X-API-Key` |
| Deploy | Docker Compose na VPS |
| Documentação | Swagger automático (`/docs`) |

---

## Estrutura de Pastas

```
dash-tg/
├── main.py
├── routers/
│   └── analysis.py
├── esoccer_dashboard/services/
│   ├── loader.py          # leitura dos .xlsx
│   ├── normalizer.py      # normalização de duplas
│   ├── deduplicator.py    # cluster ≤ 5 min — recebe dedup_key da estratégia
│   ├── metrics.py         # cálculo das 16 métricas — recebe config da estratégia
│   └── cache.py           # integração Redis
├── config/
│   ├── strategies.py      # fonte da verdade — parâmetros completos por estratégia
│   └── settings.py        # variáveis de ambiente
├── middleware/
│   └── auth.py            # validação API Key
├── tests/
│   └── test_deduplicator.py
├── docker-compose.yml
├── Dockerfile
├── requirements.txt
└── .env.example
```

---

## Configuração de Estratégias (`config/strategies.py`)

**Fonte da verdade única.** Cada estratégia define seu comportamento completo.
`metrics.py` e `deduplicator.py` recebem esses parâmetros — nunca têm valores hardcoded.

```python
ESTRATEGIAS = {
    "eSoccer — Dupla": {
        "group_by": ["Dupla"],
        "dedup_key": ["Dupla", "Data"],
        "min_jogos": 6,
        "min_green_pct": 35,
        "sistema_red_janela_horas": None,
        "descricao": "Analisa por confronto entre jogadores",
    },
    "Over/HT — Dupla + Linha": {
        "group_by": ["Dupla", "Linha"],
        "dedup_key": ["Dupla", "Linha", "Data"],
        "min_jogos": 4,
        "min_green_pct": 65,
        "sistema_red_janela_horas": 12,
        "descricao": "Over e HT — analisa por confronto e linha de mercado",
    },
}
# Para adicionar nova estratégia: apenas adicionar entrada aqui.
# NUNCA alterar metrics.py ou deduplicator.py para isso.
```

### Parâmetros documentados

| Parâmetro | Tipo | Descrição |
|-----------|------|-----------|
| `group_by` | `list[str]` | Colunas de agrupamento para cálculo das métricas |
| `dedup_key` | `list[str]` | Colunas usadas para identificar clusters de deduplicação |
| `min_jogos` | `int` | Mínimo de jogos para exibição após dedup |
| `min_green_pct` | `float` | Mínimo de % GREEN para exibição |
| `sistema_red_janela_horas` | `int\|None` | `None` = só mesmo dia / `12` = mesmo dia OU até 12h entre jogos |

> "Dupla" em `group_by`/`dedup_key` é shorthand de documentação.
> `get_strategy_internal()` traduz para o nome real de coluna `DuplaNormalizada`.

### Diferenças entre estratégias

| Regra | eSoccer | Over/HT |
|-------|---------|---------|
| Agrupamento | Dupla | Dupla + Linha |
| Cluster dedup | Dupla + Data | Dupla + Linha + Data |
| Mínimo de jogos | 6 | 4 |
| Mínimo % GREEN | 35% | 65% |
| Sistema Red janela | mesmo dia | mesmo dia OU até 12h |

---

## Endpoints

### `POST /analyze`

Recebe os arquivos e a estratégia, verifica cache, processa se necessário.

**Headers:**
```
X-API-Key: {chave_do_cliente}
Content-Type: multipart/form-data
```

**Body:**
```
files: [arquivo1.xlsx, arquivo2.xlsx, ...]
strategy: "eSoccer — Dupla"
```

**Lógica interna:**
```python
# 1. Validar API Key
# 2. Carregar config de ESTRATEGIAS[strategy] via get_strategy_internal()
# 3. Gerar cache_key = MD5(bytes de todos os arquivos + strategy)
# 4. Verificar Redis
#    HIT  → retornar dados do cache imediatamente
#    MISS → pipeline completo → salvar no Redis (TTL 24h) → retornar
```

**Response 200:**
```json
{
  "cache_hit": false,
  "cache_key": "a3f8c2...",
  "strategy": "Over/HT — Dupla + Linha",
  "total_jogos_brutos": 16163,
  "total_jogos_apos_dedup": 12847,
  "duplas": [
    {
      "dupla": "Agent vs Force",
      "linha": "Over 0.5 HT",
      "ligas": "Liga A / Liga B",
      "quantidade_entradas": 12,
      "quantidade_greens": 9,
      "percentual_green": 75.0,
      "pontuacao": 0,
      "ultimos_6": "G-G-R-G-G-G",
      "pct_green_10": 70.0,
      "quantidade_reds": 3,
      "max_reds": 1,
      "reds_apos_red": 1,
      "sistema_red_pct": 33.3,
      "srpt": 2.14,
      "sequencia_atual_g": 3,
      "max_greens": 4,
      "lucro_prej_total": 5.20
    }
  ]
}
```

> O campo `"linha"` só aparece quando `group_by` da estratégia inclui `"Linha"`.

---

### `GET /strategies`

Lista as estratégias disponíveis com seus parâmetros principais.

**Response 200:**
```json
{
  "strategies": [
    {
      "id": "eSoccer — Dupla",
      "descricao": "Analisa por confronto entre jogadores",
      "min_jogos": 6,
      "min_green_pct": 35
    },
    {
      "id": "Over/HT — Dupla + Linha",
      "descricao": "Over e HT — analisa por confronto e linha de mercado",
      "min_jogos": 4,
      "min_green_pct": 65
    }
  ]
}
```

---

### `GET /export/{cache_key}`

Retorna o resultado de uma análise já processada como arquivo `.xlsx` para download.
O `cache_key` é retornado no response do `/analyze`.

**Headers:**
```
X-API-Key: {chave_do_cliente}
```

**Response:** arquivo `.xlsx` como download direto.

---

### `GET /cache/status` *(admin)*

Retorna saúde e estatísticas do Redis.

**Response 200:**
```json
{
  "status": "ok",
  "total_chaves": 42,
  "memoria_usada": "3.21 MB",
  "hits": 318,
  "misses": 44,
  "hit_rate": "87.8%",
  "uptime_horas": 72
}
```

---

### `DELETE /cache/{cache_key}` *(admin)*

Invalida manualmente uma entrada do cache.

---

## Regras de Negócio (NÃO ALTERAR)

### Pipeline obrigatório (ordem inviolável)

```
1. Ler todos os arquivos → apenas aba "Tips Enviadas"
2. Validar colunas obrigatórias
3. Criar coluna DataHora (Data + Hora) — formato BR com segundos
4. Criar coluna Dupla normalizada
5. Executar deduplicação por cluster ≤ 5 minutos (usando dedup_key da estratégia)
6. CONGELAR o dataset — nenhuma linha pode ser adicionada depois
7. Calcular métricas com group_by da estratégia selecionada
8. Aplicar filtros de exibição (min_jogos e min_green_pct da estratégia)
```

### Deduplicação (`deduplicator.py`)

Recebe `dedup_key` como parâmetro da estratégia.

```python
def deduplicate_clusters(df, dedup_key: list[str], window_minutes=5) -> DedupResult:
    # Cluster por: dedup_key + diferença de horário ≤ janela_minutos
    # entre linhas de arquivos diferentes
    # Manter apenas a linha com horário mais tardio
```

Regras invariáveis:
- Diferença absoluta de horário ≤ 5 minutos
- Manter linha com horário mais tardio
- Roda antes de qualquer cálculo — sem exceções
- Proibido deduplicar apenas por DataHora exata

### Normalização de duplas (`normalizer.py`)

- Ordenar nomes alfabeticamente
- Preservar sufixos `(2x6)`, `(ECF Volta)`, `(ECF)` sem duplicar
- `"Cevuu vs Elmagico (2x6) (2x6)"` → `"Cevuu (2x6) vs Elmagico (2x6)"`

### Sistema Red

```python
def _reds_after_red(resultados, datas, datahoras, janela_horas):
    # Se janela_horas is None:
    #   contar RED seguido de RED apenas no mesmo dia (Data idêntica)
    # Se janela_horas = 12:
    #   contar RED seguido de RED se mesmo dia
    #   OU se dias diferentes mas diferença entre DataHora ≤ 12h
```

### SRPT

```python
peso = 0.5 ** (distancia / 10)   # meia-vida 10 jogos
valor = +1 if green else -3
SRPT = sum(peso * valor)
```

### Filtros de exibição

Valores lidos da estratégia — nunca hardcoded no router.

```python
df = df[df["quantidade_entradas"] >= estrategia["min_jogos"]]
df = df[df["percentual_green"] >= estrategia["min_green_pct"]]
```

---

## Colunas de Saída

17 colunas padrão + coluna `linha` quando `group_by` inclui `"Linha"`.

| Coluna | eSoccer | Over/HT |
|--------|---------|---------|
| ligas | ✓ | ✓ |
| dupla | ✓ | ✓ |
| linha | — | ✓ |
| fontes | ✓ | ✓ |
| quantidade_entradas | ✓ | ✓ |
| quantidade_greens | ✓ | ✓ |
| percentual_green | ✓ | ✓ |
| pontuacao | ✓ | ✓ |
| ultimos_6 | ✓ | ✓ |
| pct_green_10 | ✓ | ✓ |
| quantidade_reds | ✓ | ✓ |
| max_reds | ✓ | ✓ |
| reds_apos_red | ✓ | ✓ |
| sistema_red_pct | ✓ | ✓ |
| srpt | ✓ | ✓ |
| sequencia_atual_g | ✓ | ✓ |
| max_greens | ✓ | ✓ |
| lucro_prej_total | ✓ | ✓ |

---

## Cache (`services/cache.py`)

### Geração da chave
```python
def gerar_cache_key(files_bytes: list[bytes], strategy: str) -> str:
    h = hashlib.md5()
    for b in sorted(files_bytes):  # sorted para ordem não importar
        h.update(b)
    h.update(strategy.encode())
    return h.hexdigest()
```

### TTL por tipo de dado
| Dado | TTL |
|------|-----|
| Resultado de análise | 24h |
| Export `.xlsx` | 1h |
| Lista de estratégias | sem expiração (estático) |

---

## Autenticação (`middleware/auth.py`)

```python
API_KEYS = set(os.getenv("API_KEYS", "").split(","))

async def verify_api_key(x_api_key: str = Header(...)):
    if x_api_key not in API_KEYS:
        raise HTTPException(status_code=401, detail="API Key inválida")
```

---

## Docker Compose

```yaml
services:
  api:
    build: .
    ports:
      - "8000:8000"
    env_file: .env
    depends_on:
      - redis
    restart: unless-stopped

  redis:
    image: redis:7-alpine
    restart: unless-stopped
    volumes:
      - redis_data:/data

volumes:
  redis_data:
```

---

## Variáveis de Ambiente (`.env`)

```env
API_KEYS=chave_cliente1,chave_cliente2
REDIS_URL=redis://redis:6379
CACHE_TTL_ANALYSIS=86400
CACHE_TTL_EXPORT=3600
```

---

## O que NÃO muda entre estratégias

- Lógica de deduplicação (só o `dedup_key` muda)
- Normalização de nomes de duplas
- Fórmula SRPT (meia-vida 10 jogos)
- Estrutura dos endpoints e formato do response
- Para adicionar estratégia: apenas editar `config/strategies.py`

<!-- GSD:project-start source:PROJECT.md -->
## Project

**Dashboard TG — Melhorias v2**

API backend (FastAPI + Redis) para dashboard de analise eSoccer multi-estrategia. Consome planilhas `.xlsx` de diferentes casas de apostas, processa metricas (deduplicacao, normalizacao, sistema red, SRPT) e serve resultados via HTTP. O frontend consome a API hospedada na VPS.

Este milestone foca em 3 melhorias: pre-computacao assincrona de combinacoes de planilhas para Over/Under, remocao de filtros fixos do backend, e adicao de autenticacao por login/senha.

**Core Value:** O usuario sobe as planilhas e ja encontra todos os resultados computados — sem espera, sem cliques extras.

### Constraints

- **Stack**: FastAPI + Redis — manter stack existente, sem banco de dados adicional
- **Deploy**: Docker Compose na VPS — manter infraestrutura atual
- **Compatibilidade**: Frontend existente consome a API — mudancas devem ser retrocompativeis ou coordenadas
- **Performance**: Combinacoes Over/Under devem rodar em background sem bloquear o upload
<!-- GSD:project-end -->

<!-- GSD:stack-start source:codebase/STACK.md -->
## Technology Stack

## Languages
- Python 3.11 - All backend code (`main.py`, `routers/`, `esoccer_dashboard/`, `config/`, `middleware/`)
- None (pure Python backend)
## Runtime
- Python 3.11-slim (Docker base image `python:3.11-slim`)
- Uvicorn ASGI server
- pip (no pinned versions in `requirements.txt`)
- Lockfile: missing - dependencies are unpinned
## Frameworks
- FastAPI (unversioned) - HTTP API framework with automatic OpenAPI/Swagger docs at `/docs`
- Pydantic (unversioned) - Data validation (FastAPI dependency)
- Uvicorn[standard] (unversioned) - ASGI server, production entry point
- pandas (unversioned) - DataFrame operations for metrics calculation
- numpy (unversioned) - Numerical operations (SRPT formula, streak calculations)
- openpyxl (unversioned) - Excel `.xlsx` read/write engine
- pytest (unversioned) - Test runner
- Docker + Docker Compose - Container orchestration
- python-dotenv (unversioned) - `.env` file loading
## Key Dependencies
- `fastapi` - HTTP layer, routing, request validation, OpenAPI generation
- `pandas` - All data manipulation: loading, deduplication, metrics, export
- `openpyxl` - Excel engine for both reading uploaded `.xlsx` and writing export files
- `redis` - Cache client (redis-py), connects to Redis 7
- `python-multipart` - Required by FastAPI for `multipart/form-data` file uploads
- `python-dateutil` - Date parsing utilities (imported transitively by pandas)
- `python-dotenv` - Loads `.env` into `os.environ` at startup in `config/settings.py`
- `pickle` - Used in `routers/analysis.py` for caching individual file DataFrames in Redis
- `json` - Analysis results serialized as JSON in Redis
- `base64` - Export `.xlsx` bytes encoded as base64 for Redis storage
## Configuration
- All config via environment variables loaded in `config/settings.py`
- `.env` file loaded by `python-dotenv` at import time
- `.env.example` documents required variables:
- `Dockerfile` - Single-stage build from `python:3.11-slim`
- `docker-compose.yml` - Two services: `api` (port 8000) + `redis` (Redis 7 Alpine)
- `requirements.txt` - Flat dependency list, no version pins
## Platform Requirements
- Python 3.11+
- Redis 7 server (local or Docker)
- No frontend build step needed (API-only backend)
- Docker + Docker Compose
- VPS with ports: 8000 (API)
- Redis runs as sidecar container (no external Redis service)
- Data volume: `./data` mounted read-only at `/app/data`
- Persistent Redis volume: `redis_data`
- `Dockerfile`: Sets `PYTHONDONTWRITEBYTECODE=1`, `PYTHONUNBUFFERED=1`
- Exposes port 8000, runs `uvicorn main:app --host 0.0.0.0 --port 8000`
- `docker-compose.yml`: API depends on Redis, both `restart: unless-stopped`
- Data directory mounted as read-only volume: `./data:/app/data:ro`
<!-- GSD:stack-end -->

<!-- GSD:conventions-start source:CONVENTIONS.md -->
## Conventions

## Naming Patterns
- All Python files use `snake_case.py`: `loader.py`, `normalizer.py`, `deduplicator.py`, `metrics.py`, `cache.py`
- No suffixes or prefixes for module types (no `_service.py`, `_controller.py`)
- Test files use `test_` prefix: `test_deduplicator.py`, `test_normalizer.py`
- Use `snake_case` for all functions and methods
- Private/internal functions use single underscore prefix: `_parse_date_series()`, `_detect_bet()`, `_reds_after_red()`, `_srpt()`
- Public API functions have no prefix: `normalize_dupla()`, `compute_metrics()`, `deduplicate_clusters()`
- Use `snake_case` for local variables and parameters
- Module-level constants use `UPPER_SNAKE_CASE`: `SHEET_NAME`, `REQUIRED_COLUMNS`, `ESTRATEGIAS`, `CACHE_TTL_ANALYSIS`
- Private module-level constants use underscore prefix: `_REQUIRED_ALWAYS`, `_FIXED_REQUIRED`, `_COL_MAP`, `_BET_PATTERNS`
- `PascalCase` for dataclasses and classes: `LoadResult`, `DedupResult`, `MetricsResult`, `PlayerName`
- Private adapter classes use underscore prefix: `_UploadFileAdapter` in `routers/analysis.py`
## Language: Portuguese vs English
- **Portuguese** for domain/business terms:
- **English** for infrastructure/technical terms:
## Code Style
- No formatter config detected (no `pyproject.toml`, `setup.cfg`, `.flake8`, `ruff.toml`, or `.pre-commit-config.yaml`)
- Indentation: 4 spaces (standard Python)
- Line length: no enforced limit, but lines generally stay under ~120 characters
- String quotes: double quotes consistently (`"Green"`, `"Red"`, `"DuplaNormalizada"`)
- No linter configuration detected
- Code uses modern Python type hints consistently
- All functions have type annotations for parameters and return values
- Uses `from __future__ import annotations` at the top of every service module (`config/strategies.py`, `esoccer_dashboard/services/loader.py`, `normalizer.py`, `deduplicator.py`, `metrics.py`, `cache.py`)
- Union types use `X | None` syntax (Python 3.10+): `janela_horas: int | None`, `date_from: str | None`
- Collections typed with lowercase generics: `list[str]`, `dict[str, str]`, `tuple[str, ...]`, `set[str]`
## Import Organization
- Prefer `from X import Y` over `import X` for specific symbols
- Group multiple imports from same module on separate lines or single `from X import (A, B, C)` blocks
- Example from `routers/analysis.py`:
- None. All imports use full dotted paths from the project root.
## Error Handling
- **Validation errors** raise `HTTPException` with status `422` and Portuguese detail messages:
- **Not found** raises `HTTPException` with status `404`:
- **Auth failures** raise `HTTPException` with status `401` in `middleware/auth.py`
- **Infrastructure errors** (Redis) catch generic `Exception` and re-raise as `HTTPException(503)`:
- **Data loading errors** raise `ValueError` with descriptive messages in `loader.py`:
- **No try/except** in the processing pipeline (`_analyze_with_strategy`). Errors from `compute_metrics`, `deduplicate_clusters`, `add_dupla_normalizada` propagate as 500.
## Configuration Patterns
- Loaded via `python-dotenv` in `config/settings.py`
- Module-level constants with defaults: `REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379")`
- `.env.example` documents all required vars: `API_KEYS`, `REDIS_URL`, `CACHE_TTL_ANALYSIS`, `CACHE_TTL_EXPORT`, `DATA_DIR`
- Single source of truth: `config/strategies.py` `ESTRATEGIAS` dict
- `get_strategy_internal()` translates shorthand column names ("Dupla" -> "DuplaNormalizada") via `_COL_MAP`
- Services receive config as parameters -- never import `ESTRATEGIAS` directly
- Adding a strategy: only add an entry to `ESTRATEGIAS` dict, never modify service files
## API Response Format Conventions
## Dataclass Pattern
- All service return types use frozen dataclasses: `LoadResult`, `DedupResult`, `MetricsResult`
- Located in the same file as the function that produces them
- Pattern:
## Module Design
- `loader.py` -> `load_tips_enviadas()`
- `normalizer.py` -> `add_dupla_normalizada()` (+ `normalize_dupla()`)
- `deduplicator.py` -> `deduplicate_clusters()`
- `metrics.py` -> `compute_metrics()`
- `cache.py` -> multiple CRUD functions (store/get per data type)
## Comments
<!-- GSD:conventions-end -->

<!-- GSD:architecture-start source:ARCHITECTURE.md -->
## Architecture

## Pattern Overview
- Single FastAPI application with one router serving all endpoints
- Sequential data-processing pipeline: load -> normalize -> deduplicate -> compute metrics -> filter
- Redis cache layer sits between request handling and pipeline execution (cache-aside pattern)
- Strategy configuration as single source of truth in `config/strategies.py` -- pipeline components receive parameters, never hardcode them
- Stateless API -- all state lives in Redis or is computed per-request from uploaded files
## Layers
- Purpose: Request handling, validation, authentication, response serialization
- Location: `main.py`, `routers/analysis.py`
- Contains: Route definitions, input validation, file upload handling, response formatting
- Depends on: Service layer, config layer, middleware
- Used by: External HTTP clients (frontend, API consumers)
- Purpose: Cross-cutting concerns (authentication, CORS)
- Location: `middleware/auth.py`, CORS config in `main.py`
- Contains: API key validation via `X-API-Key` header
- Depends on: `config/settings.py` for `API_KEYS`
- Used by: All authenticated endpoints via `Depends(verify_api_key)`
- Purpose: Core business logic -- file parsing, normalization, deduplication, metrics
- Location: `esoccer_dashboard/services/`
- Contains: Five service modules (loader, normalizer, deduplicator, metrics, cache)
- Depends on: pandas, numpy, redis, openpyxl
- Used by: `routers/analysis.py`
- Purpose: Strategy definitions and environment settings
- Location: `config/strategies.py`, `config/settings.py`
- Contains: Strategy parameter dictionaries, env var loading
- Depends on: `python-dotenv` for env loading
- Used by: Router (strategy lookup), middleware (API keys), cache (Redis URL, TTLs)
## Data Flow
```
```
- No in-process state between requests -- fully stateless
- Redis stores: analysis results (JSON), exports (base64 xlsx), blueprints (JSON), file DataFrames (pickle)
- File data is ephemeral -- uploaded per-request, not persisted to disk
## Key Abstractions
- Purpose: Parameterizes the entire pipeline per analysis type
- Definition: `config/strategies.py` -> `ESTRATEGIAS` dict
- Pattern: `get_strategy_internal()` translates shorthand column names (e.g., "Dupla" -> "DuplaNormalizada") and returns enriched config with `group_by_internal` and `dedup_key_internal`
- All pipeline functions receive strategy parameters as arguments -- zero hardcoded values
- Purpose: Encapsulates loaded DataFrame + raw row count
- Pattern: Frozen dataclass `LoadResult(df, total_jogos_brutos)`
- Purpose: Encapsulates deduplicated DataFrame + post-dedup row count
- Pattern: Frozen dataclass `DedupResult(df, total_jogos_apos_dedup)`
- Purpose: Encapsulates metrics DataFrame (one row per group)
- Pattern: Frozen dataclass `MetricsResult(df)`
- Purpose: Abstracts file input (works with both FastAPI UploadFile and test doubles)
- Pattern: Structural typing via `Protocol` with `name: str` and `getvalue() -> bytes`
- Adapter: `_UploadFileAdapter` in `routers/analysis.py` bridges FastAPI `UploadFile` to this protocol
## Entry Points
- Location: `main.py`
- Triggers: `uvicorn main:app` (Docker CMD)
- Responsibilities: Creates FastAPI app, configures CORS (allow all origins), mounts the analysis router, defines `/health` endpoint
- Location: `routers/analysis.py`
- Triggers: HTTP requests to `/analyze`, `/strategies`, `/export/{cache_key}`, `/blueprint/{cache_key}`, `/cache/status`, `/cache/{cache_key}`
- Responsibilities: All business endpoints. Orchestrates the full pipeline via `_analyze_with_strategy()`
## Error Handling
- 401: Invalid API key (`middleware/auth.py`)
- 404: Cache key not found for export/blueprint/cache delete (`routers/analysis.py`)
- 422: Invalid strategy name, invalid date format, invalid horario format, duplicate filenames, no data in filtered period (`routers/analysis.py`)
- 503: Redis unavailable (`routers/analysis.py` -> `cache_status()`)
- `ValueError` from `loader.py`: Missing sheet "Tips Enviadas", missing required columns, invalid Data/Hora, invalid Resultado values
- `ValueError` from `deduplicator.py`: Missing required columns in DataFrame
- `ValueError` from `metrics.py`: Missing required columns in DataFrame
## Cross-Cutting Concerns
<!-- GSD:architecture-end -->

<!-- GSD:workflow-start source:GSD defaults -->
## GSD Workflow Enforcement

Before using Edit, Write, or other file-changing tools, start work through a GSD command so planning artifacts and execution context stay in sync.

Use these entry points:
- `/gsd:quick` for small fixes, doc updates, and ad-hoc tasks
- `/gsd:debug` for investigation and bug fixing
- `/gsd:execute-phase` for planned phase work

Do not make direct repo edits outside a GSD workflow unless the user explicitly asks to bypass it.
<!-- GSD:workflow-end -->

<!-- GSD:profile-start -->
## Developer Profile

> Profile not yet configured. Run `/gsd:profile-user` to generate your developer profile.
> This section is managed by `generate-claude-profile` -- do not edit manually.
<!-- GSD:profile-end -->
