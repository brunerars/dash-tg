# Coding Conventions

**Analysis Date:** 2026-04-02

## Naming Patterns

**Files:**
- All Python files use `snake_case.py`: `loader.py`, `normalizer.py`, `deduplicator.py`, `metrics.py`, `cache.py`
- No suffixes or prefixes for module types (no `_service.py`, `_controller.py`)
- Test files use `test_` prefix: `test_deduplicator.py`, `test_normalizer.py`

**Functions:**
- Use `snake_case` for all functions and methods
- Private/internal functions use single underscore prefix: `_parse_date_series()`, `_detect_bet()`, `_reds_after_red()`, `_srpt()`
- Public API functions have no prefix: `normalize_dupla()`, `compute_metrics()`, `deduplicate_clusters()`

**Variables:**
- Use `snake_case` for local variables and parameters
- Module-level constants use `UPPER_SNAKE_CASE`: `SHEET_NAME`, `REQUIRED_COLUMNS`, `ESTRATEGIAS`, `CACHE_TTL_ANALYSIS`
- Private module-level constants use underscore prefix: `_REQUIRED_ALWAYS`, `_FIXED_REQUIRED`, `_COL_MAP`, `_BET_PATTERNS`

**Types/Classes:**
- `PascalCase` for dataclasses and classes: `LoadResult`, `DedupResult`, `MetricsResult`, `PlayerName`
- Private adapter classes use underscore prefix: `_UploadFileAdapter` in `routers/analysis.py`

## Language: Portuguese vs English

**Critical convention -- mixed Portuguese/English naming throughout:**

- **Portuguese** for domain/business terms:
  - Strategy config keys: `"descricao"`, `"min_jogos"`, `"min_green_pct"`, `"sistema_red_janela_horas"`
  - DataFrame columns: `"DuplaNormalizada"`, `"Torneio"`, `"Confronto"`, `"Lucro/Prej."`, `"Resultado"`, `"Horario Jogo"`
  - API response fields: `"dupla"`, `"ligas"`, `"fontes"`, `"quantidade_entradas"`, `"percentual_green"`, `"pontuacao"`, `"ultimos_6"`, `"reds_apos_red"`, `"sistema_red_pct"`, `"lucro_prej_total"`, `"sequencia_atual_g"`, `"total_jogos_brutos"`, `"total_jogos_apos_dedup"`, `"horarios_unicos"`
  - Cache function names: `gerar_cache_key()`
  - Strategy dict name: `ESTRATEGIAS`
  - Error messages: `"API Key invalida"`, `"Nenhum jogo encontrado no periodo especificado."`

- **English** for infrastructure/technical terms:
  - Function names: `compute_metrics()`, `deduplicate_clusters()`, `load_tips_enviadas()`, `get_or_compute()`
  - Parameters: `group_by`, `dedup_key`, `window_minutes`, `cache_key`
  - Internal columns: `"__source_file"`, `"__bet"`
  - API fields: `"cache_hit"`, `"cache_key"`, `"strategy"`

**Rule:** When adding new code, follow this pattern. Domain-specific names stay Portuguese. Technical/infrastructure names use English. API response keys for business data use Portuguese `snake_case`.

## Code Style

**Formatting:**
- No formatter config detected (no `pyproject.toml`, `setup.cfg`, `.flake8`, `ruff.toml`, or `.pre-commit-config.yaml`)
- Indentation: 4 spaces (standard Python)
- Line length: no enforced limit, but lines generally stay under ~120 characters
- String quotes: double quotes consistently (`"Green"`, `"Red"`, `"DuplaNormalizada"`)

**Linting:**
- No linter configuration detected
- Code uses modern Python type hints consistently

**Type Hints:**
- All functions have type annotations for parameters and return values
- Uses `from __future__ import annotations` at the top of every service module (`config/strategies.py`, `esoccer_dashboard/services/loader.py`, `normalizer.py`, `deduplicator.py`, `metrics.py`, `cache.py`)
- Union types use `X | None` syntax (Python 3.10+): `janela_horas: int | None`, `date_from: str | None`
- Collections typed with lowercase generics: `list[str]`, `dict[str, str]`, `tuple[str, ...]`, `set[str]`

## Import Organization

**Order (observed across all files):**
1. `from __future__ import annotations` (always first in service modules)
2. Standard library imports: `hashlib`, `io`, `json`, `re`, `os`, `base64`
3. Third-party imports: `pandas`, `numpy`, `redis`, `fastapi`
4. Local imports: `from config.strategies import ...`, `from esoccer_dashboard.services.cache import ...`

**Style:**
- Prefer `from X import Y` over `import X` for specific symbols
- Group multiple imports from same module on separate lines or single `from X import (A, B, C)` blocks
- Example from `routers/analysis.py`:
```python
from config.strategies import ESTRATEGIAS, get_strategy_internal
from esoccer_dashboard.services.cache import (
    delete_cache_key,
    gerar_cache_key,
    get_file_df,
    store_file_df,
    get_blueprint,
    get_cache_stats,
    get_export,
    get_or_compute,
    store_blueprint,
    store_export,
)
```

**Path Aliases:**
- None. All imports use full dotted paths from the project root.

## Error Handling

**Patterns:**

- **Validation errors** raise `HTTPException` with status `422` and Portuguese detail messages:
  ```python
  raise HTTPException(status_code=422, detail=f"Estrategia '{strategy}' nao encontrada.")
  ```

- **Not found** raises `HTTPException` with status `404`:
  ```python
  raise HTTPException(404, "Blueprint nao encontrado. Rode /analyze novamente.")
  ```

- **Auth failures** raise `HTTPException` with status `401` in `middleware/auth.py`

- **Infrastructure errors** (Redis) catch generic `Exception` and re-raise as `HTTPException(503)`:
  ```python
  except Exception as exc:
      raise HTTPException(status_code=503, detail=f"Redis indisponivel: {exc}") from exc
  ```

- **Data loading errors** raise `ValueError` with descriptive messages in `loader.py`:
  ```python
  raise ValueError(f"Arquivo '{source_name}' nao tem a aba '{SHEET_NAME}'.")
  ```
  These bubble up as unhandled 500s -- there is no global exception handler converting `ValueError` to HTTP responses.

- **No try/except** in the processing pipeline (`_analyze_with_strategy`). Errors from `compute_metrics`, `deduplicate_clusters`, `add_dupla_normalizada` propagate as 500.

## Configuration Patterns

**Environment variables:**
- Loaded via `python-dotenv` in `config/settings.py`
- Module-level constants with defaults: `REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379")`
- `.env.example` documents all required vars: `API_KEYS`, `REDIS_URL`, `CACHE_TTL_ANALYSIS`, `CACHE_TTL_EXPORT`, `DATA_DIR`

**Strategy configuration:**
- Single source of truth: `config/strategies.py` `ESTRATEGIAS` dict
- `get_strategy_internal()` translates shorthand column names ("Dupla" -> "DuplaNormalizada") via `_COL_MAP`
- Services receive config as parameters -- never import `ESTRATEGIAS` directly
- Adding a strategy: only add an entry to `ESTRATEGIAS` dict, never modify service files

## API Response Format Conventions

**All endpoints return `dict` (not Pydantic models).**

**Standard envelope for `/analyze`:**
```json
{
  "cache_hit": false,
  "cache_key": "a3f8c2...",
  "strategy": "eSoccer -- Dupla",
  "total_jogos_brutos": 16163,
  "total_jogos_apos_dedup": 12847,
  "duplas": [...]
}
```

**Optional fields added conditionally** (not null, just absent):
```python
if date_from:
    result["date_from"] = date_from
if horarios_unicos:
    result["horarios_unicos"] = horarios_unicos
```

**List endpoints** use a wrapper key matching the resource:
```json
{ "strategies": [...] }
```

**Delete/mutation endpoints** return confirmation:
```json
{ "deleted": true, "cache_key": "..." }
```

**No Pydantic response models** -- all responses are hand-built dicts. No input validation models either (uses `Form(...)` parameters directly).

## Dataclass Pattern

- All service return types use frozen dataclasses: `LoadResult`, `DedupResult`, `MetricsResult`
- Located in the same file as the function that produces them
- Pattern:
```python
@dataclass(frozen=True)
class DedupResult:
    df: pd.DataFrame
    total_jogos_apos_dedup: int
```

## Module Design

**Exports:** No `__all__` declarations. All public functions are importable by name.

**Barrel Files:** `__init__.py` files exist in `config/`, `esoccer_dashboard/`, `esoccer_dashboard/services/`, `middleware/`, `routers/` -- all empty (just for package recognition).

**Single responsibility:** Each service file has one primary public function:
- `loader.py` -> `load_tips_enviadas()`
- `normalizer.py` -> `add_dupla_normalizada()` (+ `normalize_dupla()`)
- `deduplicator.py` -> `deduplicate_clusters()`
- `metrics.py` -> `compute_metrics()`
- `cache.py` -> multiple CRUD functions (store/get per data type)

## Comments

**Section dividers** in `routers/analysis.py` use dashed lines:
```python
# ---------------------------------------------------------------------------
# POST /analyze  (upload de arquivos)
# ---------------------------------------------------------------------------
```

**Inline comments** are in Portuguese for domain logic, English for technical notes:
```python
# Cluster por: dedup_key + diferenca de horario <= janela_minutos
# entre linhas de arquivos diferentes
```

**Docstrings** use triple-quote format, present on key public functions. Written in Portuguese for domain functions.

---

*Convention analysis: 2026-04-02*
