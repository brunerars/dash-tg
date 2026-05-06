"""ARQ worker dedicado pro precompute pesado.

Roda em container separado da API (`precompute_worker` no compose). A API
salva os arquivos uploadados em `/tmp/precompute/<batch_id>/` e enfileira
uma task ARQ. Este worker processa **um job por vez** (concurrency=1) —
mesmo que ele caia por OOM com arquivo gigante, a API NUNCA cai junto.

A task `process_precompute_task` executa sequencialmente:
  1. Pre-parse de cada arquivo (calamine -> parquet zstd no Redis)
  2. Primary job (combo full, sem filtro de periodo)
  3. 4 periodos (15/30/60/90d) sobre o full combo
  4. Combos restantes (subsets menores)
  5. Cleanup do diretorio do batch

Cada sub-job atualiza ``store_job(jid, status, cache_key)`` no Redis,
mantendo a interface que o frontend ja consome via /jobs/status.
"""
from __future__ import annotations

import logging
import shutil
from pathlib import Path
from typing import Any

from arq.connections import RedisSettings

from config.settings import REDIS_URL
from esoccer_dashboard.services.cache import store_job
from precompute_jobs import (
    PRECOMPUTE_PERIODS,
    _preparse_files,
    dispatch_job,
    period_date_range,
)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)
logger = logging.getLogger("precompute_worker")


def _redis_settings_from_url(url: str) -> RedisSettings:
    """Converte REDIS_URL em RedisSettings do ARQ (host, port, database)."""
    from urllib.parse import urlparse

    parsed = urlparse(url)
    host = parsed.hostname or "localhost"
    port = parsed.port or 6379
    database = int(parsed.path.lstrip("/")) if parsed.path and parsed.path != "/" else 0
    password = parsed.password
    return RedisSettings(host=host, port=port, database=database, password=password)


async def startup(ctx: dict[str, Any]) -> None:
    logger.info("[precompute_worker] startup OK — REDIS_URL=%s", REDIS_URL)


async def shutdown(ctx: dict[str, Any]) -> None:
    logger.info("[precompute_worker] shutdown")


def _read_saved_files(saved_files: list[list[str]]) -> list[tuple[str, bytes]]:
    """Le os arquivos salvos pela API e retorna [(filename, bytes)] no formato
    esperado por _preparse_files / dispatch_job.

    saved_files vem como list[[name, abs_path]] (JSON serializa tuple como list).
    """
    out: list[tuple[str, bytes]] = []
    for entry in saved_files:
        name, abs_path = entry[0], entry[1]
        with open(abs_path, "rb") as fp:
            out.append((name, fp.read()))
    return out


def _cleanup_batch_dir(saved_files: list[list[str]]) -> None:
    """Remove o diretorio do batch (todos os xlsx + diretorio).
    Idempotente — silencioso se ja foi removido."""
    if not saved_files:
        return
    first_path = Path(saved_files[0][1])
    batch_dir = first_path.parent
    try:
        shutil.rmtree(batch_dir, ignore_errors=True)
        logger.info("Cleanup batch dir %s", batch_dir)
    except Exception as e:
        logger.warning("Cleanup falhou em %s: %s", batch_dir, e)


async def process_precompute_task(ctx: dict[str, Any], payload: dict) -> dict:
    """Task ARQ principal — processa primary + periodos + combos sequencial.

    Payload (vem do POST /precompute):
      - batch_id: str
      - strategy_name: str
      - saved_files: list[[filename, abs_path]]
      - primary_job_id: str
      - period_jobs: list[{job_id, days}]
      - remaining_combos: list[{job_id, filenames}]

    Atualiza store_job(jid) pra cada sub-job conforme avanca. Frontend
    poll /jobs/status com os IDs ve progresso granular.
    """
    batch_id = payload["batch_id"]
    strategy_name = payload["strategy_name"]
    saved_files = payload["saved_files"]
    primary_job_id = payload["primary_job_id"]
    period_jobs = payload["period_jobs"]
    remaining_combos = payload["remaining_combos"]

    logger.info(
        "[batch=%s] start: strategy=%s, files=%d, primary=%s, periods=%d, remaining=%d",
        batch_id[:8], strategy_name, len(saved_files), primary_job_id[:8],
        len(period_jobs), len(remaining_combos),
    )

    try:
        # 1. Le arquivos do disco — bytes vivem so neste worker
        files_contents = _read_saved_files(saved_files)
        name_to_content = dict(files_contents)

        # 2. Pre-parse cada arquivo unico -> Redis (parquet+zstd)
        _preparse_files(files_contents)

        # 3. Primary job (todos os arquivos juntos, sem filtro de periodo)
        full_combo = files_contents
        await dispatch_job(primary_job_id, strategy_name, full_combo)

        # 4. 4 periodos sobre o full combo
        if period_jobs:
            logger.info(
                "[batch=%s] dispatching %d period variants",
                batch_id[:8], len(period_jobs),
            )
            for pj in period_jobs:
                jid = pj["job_id"]
                days = pj["days"]
                dfrom, dto = period_date_range(days)
                await dispatch_job(jid, strategy_name, full_combo, dfrom, dto)

        # 5. Remaining combos (subsets menores)
        if remaining_combos:
            logger.info(
                "[batch=%s] dispatching %d remaining combos",
                batch_id[:8], len(remaining_combos),
            )
            for rc in remaining_combos:
                jid = rc["job_id"]
                filenames = rc["filenames"]
                combo = [(fn, name_to_content[fn]) for fn in filenames]
                await dispatch_job(jid, strategy_name, combo)

        logger.info("[batch=%s] all jobs done", batch_id[:8])
        return {"batch_id": batch_id, "status": "ok"}

    except Exception as exc:
        # Marca jobs ainda pendentes como failed pra frontend nao ficar polling infinito
        logger.error("[batch=%s] FATAL: %s", batch_id[:8], exc, exc_info=True)
        all_jids = (
            [primary_job_id]
            + [pj["job_id"] for pj in period_jobs]
            + [rc["job_id"] for rc in remaining_combos]
        )
        from esoccer_dashboard.services.cache import get_job
        for jid in all_jids:
            existing = get_job(jid)
            if existing is None or existing.get("status") in ("pending", "running"):
                store_job(jid, status="failed", error=str(exc))
        return {"batch_id": batch_id, "status": "failed", "error": str(exc)}

    finally:
        # Sempre limpa o diretorio do batch — nao precisa mais dos xlsx
        _cleanup_batch_dir(saved_files)


class WorkerSettings:
    """Config do worker ARQ — usada pelo CLI `arq worker_precompute.WorkerSettings`."""

    redis_settings = _redis_settings_from_url(REDIS_URL)

    functions: list = [process_precompute_task]

    # 1 job por vez — garante que nao temos 2 parses de xlsx pesado em paralelo.
    max_jobs = 1

    # Timeout generoso pra parses + 11 sub-jobs com planilhas grandes (15 min).
    job_timeout = 900

    # Mantem resultado do job no Redis por 1 hora (frontend polling).
    keep_result = 3600

    # Hooks
    on_startup = startup
    on_shutdown = shutdown

    # 1 job por vez — garante que nao temos 2 parses de xlsx pesado em paralelo.
    max_jobs = 1

    # Timeout generoso pra parses de planilhas grandes (10 min).
    job_timeout = 600

    # Mantem resultado do job no Redis por 1 hora (frontend polling).
    keep_result = 3600

    # Hooks
    on_startup = startup
    on_shutdown = shutdown
