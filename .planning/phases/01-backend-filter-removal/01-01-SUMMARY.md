# Plan 01-01 Summary: Remove display filters + cache flush

**Status:** Complete
**Commit:** 5fee552

## What was done

### Task 1: Remove filter block (FILT-01, FILT-02)
- Removed `min_jogos` and `min_green_pct` filter from `routers/analysis.py` pipeline
- `mdf = metrics_result.df` now passes through unfiltered
- `config/strategies.py` unchanged — `/strategies` endpoint still serves filter defaults for frontend

### Task 2: Cache flush script (FILT-03)
- Created `scripts/flush_stale_cache.py` — deletes `analysis:`, `export:`, `blueprint:` Redis keys via SCAN
- Preserves `filedf:` keys (raw data, not stale)
- Added `cache-flush` service to `docker-compose.yml` as init container (runs before API starts)

## Files changed
- `routers/analysis.py` — filter block replaced with passthrough
- `scripts/flush_stale_cache.py` — new file
- `docker-compose.yml` — added cache-flush service + api depends_on

## Verification
- Filter logic removed from pipeline (no `quantidade_entradas >= min_jogos` in analysis.py)
- `mdf = metrics_result.df` preserved (1 match)
- Flush script covers all 3 prefixes
- `service_completed_successfully` wired in docker-compose
