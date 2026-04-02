# Testing Patterns

**Analysis Date:** 2026-04-02

## Summary

The project has minimal automated testing. There are 2 proper unit test files in `tests/` using pytest, and 2 manual integration test scripts at the project root that require a running server and real `.xlsx` files. No test configuration file exists (no `pytest.ini`, `conftest.py`, or `pyproject.toml` with pytest settings). pytest is listed in `requirements.txt`.

## Test Framework

**Runner:**
- pytest (version not pinned in `requirements.txt`)
- No config file (`pytest.ini`, `conftest.py`, `pyproject.toml` all absent)

**Assertion Library:**
- Built-in `assert` statements (pytest native)

**Run Commands:**
```bash
pytest                    # Run all unit tests in tests/
pytest tests/ -v          # Verbose output
pytest tests/test_deduplicator.py  # Run specific file
```

**Manual integration tests (require running server + Redis + real data files):**
```bash
python test_api.py        # Tests eSoccer strategy against localhost:8000
python test_api2.py       # Tests Over/HT strategy against localhost:8000
```

## Test File Organization

**Location:** Two patterns coexist:
1. `tests/` directory for proper unit tests (pytest-compatible)
2. Project root for manual integration scripts (`test_api.py`, `test_api2.py`)

**Naming:**
- Unit tests: `test_{module}.py` inside `tests/`
- Integration scripts: `test_api.py`, `test_api2.py` at root

**Structure:**
```
dash-tg/
├── tests/
│   ├── test_deduplicator.py    # 3 unit tests
│   └── test_normalizer.py      # 3 unit tests
├── test_api.py                 # Manual integration (eSoccer strategy)
└── test_api2.py                # Manual integration (Over/HT strategy)
```

## Unit Tests (tests/)

### `tests/test_deduplicator.py` -- 3 tests

Tests the `deduplicate_clusters()` function from `esoccer_dashboard/services/deduplicator.py`.

**Pattern:** Build a small DataFrame inline, call the function, assert on result length and values.

```python
def test_dedup_keeps_latest_when_multiple_sources_in_cluster():
    df = pd.DataFrame([
        {"DuplaNormalizada": "A vs B", "Data": "2026-01-20",
         "DataHora": pd.Timestamp("2026-01-20 10:00:00"), "__source_file": "botA.xlsx"},
        {"DuplaNormalizada": "A vs B", "Data": "2026-01-20",
         "DataHora": pd.Timestamp("2026-01-20 10:03:00"), "__source_file": "botB.xlsx"},
        {"DuplaNormalizada": "A vs B", "Data": "2026-01-20",
         "DataHora": pd.Timestamp("2026-01-20 10:12:00"), "__source_file": "botA.xlsx"},
    ])
    res = deduplicate_clusters(df, dedup_key=["DuplaNormalizada", "Data"], window_minutes=5)
    assert len(res.df) == 2
    assert res.df["DataHora"].tolist() == [
        pd.Timestamp("2026-01-20 10:03:00"),
        pd.Timestamp("2026-01-20 10:12:00"),
    ]
```

**Cases covered:**
1. Multi-source cluster keeps latest timestamp
2. Single-source cluster preserves all rows
3. Gap greater than window does not cluster

### `tests/test_normalizer.py` -- 3 tests

Tests the `normalize_dupla()` function from `esoccer_dashboard/services/normalizer.py`.

**Pattern:** Simple input/output assertions.

```python
def test_normalize_orders_alphabetically():
    assert normalize_dupla("Force vs Agent") == "Agent vs Force"

def test_normalize_dedup_suffix_distribution():
    assert normalize_dupla("Cevuu vs Elmagico (2x6) (2x6)") == "Cevuu (2x6) vs Elmagico (2x6)"
```

**Cases covered:**
1. Alphabetical ordering of player names
2. Suffix redistribution (duplicated suffix split between players)
3. Suffix preservation per player

## Manual Integration Tests (root)

### `test_api.py` -- eSoccer strategy

**Requires:** Running server at `localhost:8000`, Redis, API key `"123"`, real `.xlsx` file at hardcoded Windows path.

**Tests (sequential, script-style `if __name__ == "__main__"`):**
1. `test_strategies()` -- GET /strategies returns expected strategy
2. `test_analyze()` -- POST /analyze with real file, validates all 17 response fields, checks filters
3. `test_cache_hit()` -- Second POST /analyze returns `cache_hit: true`
4. `test_export()` -- GET /export/{cache_key} downloads valid xlsx
5. `test_cache_status()` -- GET /cache/status has all expected fields
6. `test_auth_rejected()` -- Invalid API key returns 401
7. `test_invalid_strategy()` -- Bad strategy name returns 422

### `test_api2.py` -- Over/HT strategy

**Same structure as `test_api.py`** but targets `"Over/HT -- Dupla + Linha"` strategy. Validates the `"linha"` field is present (18 fields vs 17). Does NOT test auth rejection or invalid strategy (those are only in `test_api.py`).

**Neither script uses pytest fixtures, TestClient, or mocking.** They use `requests` library against a live server.

## Mocking

**No mocking framework used.** No mocks, patches, or fakes anywhere in the codebase.

**What should be mocked but is not:**
- Redis client in `cache.py` -- all cache tests require live Redis
- File I/O in `loader.py` -- integration tests use real `.xlsx` files
- `pandas.read_excel` -- no unit tests for loader at all

## Fixtures and Factories

**No fixtures or factories.** Test data is constructed inline as DataFrames or relies on real files on disk.

**Pattern for unit tests:** Inline `pd.DataFrame([{...}, {...}])` construction:
```python
df = pd.DataFrame([
    {"DuplaNormalizada": "A vs B", "Data": "2026-01-20",
     "DataHora": pd.Timestamp("2026-01-20 10:00:00"),
     "__source_file": "botA.xlsx"},
])
```

## Coverage

**Requirements:** None enforced. No coverage tool configured.

**Estimated coverage by module:**

| Module | Unit Tests | Integration Tests | Coverage |
|--------|-----------|-------------------|----------|
| `esoccer_dashboard/services/deduplicator.py` | 3 tests | Indirect | Partial -- only basic clustering tested |
| `esoccer_dashboard/services/normalizer.py` | 3 tests | None | Partial -- 3 edge cases |
| `esoccer_dashboard/services/loader.py` | None | Indirect via `test_api.py` | None (unit) |
| `esoccer_dashboard/services/metrics.py` | None | Indirect via `test_api.py` | None (unit) |
| `esoccer_dashboard/services/cache.py` | None | Indirect via `test_api.py` | None (unit) |
| `routers/analysis.py` | None | `test_api.py`, `test_api2.py` | None (unit) |
| `middleware/auth.py` | None | `test_api.py` only | None (unit) |
| `config/strategies.py` | None | Indirect | None |

## Critical Test Gaps

**No unit tests for:**
- `metrics.py` -- the most complex module (SRPT calculation, reds_after_red logic, streak calculations). All 16 metrics are untested at the unit level.
- `loader.py` -- date/time parsing, lucro parsing, resultado normalization, column validation. Multiple edge cases (BR date format, comma decimals) have no tests.
- `cache.py` -- cache key generation, TTL behavior, Redis serialization/deserialization
- `config/strategies.py` -- `get_strategy_internal()` translation logic
- `routers/analysis.py` -- no TestClient-based tests; validation logic (duplicate files, date format, horarios parsing) untested

**No edge case tests for deduplicator:**
- Empty DataFrame
- Missing columns (error path)
- Three-way multi-source clusters
- Exact 5-minute boundary (window_minutes edge)

**No edge case tests for normalizer:**
- Empty string input
- Single player (no "vs")
- Multiple different suffixes per player

## How to Add New Tests

**Unit tests:** Add to `tests/` directory following existing pattern:
```python
# tests/test_metrics.py
import numpy as np
import pandas as pd
from esoccer_dashboard.services.metrics import compute_metrics, _srpt, _reds_after_red

def test_srpt_all_greens():
    resultados = np.array(["Green", "Green", "Green"])
    result = _srpt(resultados)
    assert result > 0

def test_reds_after_red_same_day():
    # ... inline DataFrame, call function, assert
```

**Integration tests with TestClient (recommended over manual scripts):**
```python
# tests/test_api_integration.py
from fastapi.testclient import TestClient
from main import app

client = TestClient(app)

def test_strategies_endpoint():
    response = client.get("/strategies")
    assert response.status_code == 200
    assert "strategies" in response.json()
```

---

*Testing analysis: 2026-04-02*
