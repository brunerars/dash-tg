"""Logica pesada do precompute — separada do router pra ser reusada pelo
worker ARQ (`worker_precompute.py`) sem importar FastAPI.

Quem dispara essas funcoes hoje:
- Etapa 3 em diante: `worker_precompute.process_precompute_task` (ARQ worker
  em container separado, processa um job por vez via fila Redis).

Antes da refatoracao ARQ a logica vivia em `routers/precompute.py` direto.
Movida pra ca pra que o worker possa importar sem trazer junto Depends/UploadFile.
"""
from __future__ import annotations

import asyncio
import gc
import hashlib
import io
import logging
from concurrent.futures import ThreadPoolExecutor
from datetime import date, timedelta
from itertools import combinations

from config.settings import PRECOMPUTE_WORKERS
from esoccer_dashboard.services.cache import (
    gerar_cache_key,
    get_file_df,
    get_or_compute,
    store_file_df,
    store_job,
)
from esoccer_dashboard.services.loader import load_tips_enviadas
from routers.analysis import _build_analysis_result, _UploadFileAdapter

logger = logging.getLogger(__name__)

PRECOMPUTE_PERIODS = [15, 30, 60, 90]

# ThreadPoolExecutor compartilhado entre chamadas concorrentes do worker.
# Como o worker ARQ tem max_jobs=1, na pratica so ha 1 job por vez —
# este executor existe so pra jogar pandas/calamine fora do event loop.
_executor = ThreadPoolExecutor(max_workers=PRECOMPUTE_WORKERS)


def _preparse_files(files_contents: list[tuple[str, bytes]]) -> None:
    """Parse cada arquivo unico e cacheia o DataFrame em Redis como parquet+zstd.

    Parquet+zstd e ~5-10x menor que pickle pra DataFrames densos. del +
    gc.collect() entre iteracoes evita acumulo de RAM com multiplos arquivos.
    """
    for name, content in files_contents:
        file_hash = hashlib.md5(content).hexdigest()
        if get_file_df(file_hash) is not None:
            logger.info("File %s already cached (hash=%s)", name, file_hash[:8])
            continue
        logger.info(
            "Pre-parsing %s (%d MB, hash=%s)...",
            name, len(content) // (1024 * 1024), file_hash[:8],
        )
        adapter = _UploadFileAdapter(name, content)
        result = load_tips_enviadas([adapter])
        rows = len(result.df)
        buf = io.BytesIO()
        result.df.to_parquet(buf, engine="pyarrow", compression="zstd")
        parquet_bytes = buf.getvalue()
        store_file_df(file_hash, parquet_bytes)
        logger.info(
            "Pre-parsed %s — %d rows, cached %d MB parquet (zstd)",
            name, rows, len(parquet_bytes) // (1024 * 1024),
        )
        del result, buf, parquet_bytes
        gc.collect()


def all_nonempty_combinations(
    files: list[tuple[str, bytes]],
) -> list[list[tuple[str, bytes]]]:
    """Todos os subsets nao-vazios. N arquivos -> 2^N-1 combos."""
    result: list[list[tuple[str, bytes]]] = []
    for r in range(1, len(files) + 1):
        for combo in combinations(files, r):
            result.append(list(combo))
    return result


def period_date_range(days: int) -> tuple[str, str]:
    """(date_from, date_to) pro preset de periodo."""
    today = date.today()
    return (today - timedelta(days=days)).isoformat(), today.isoformat()


async def dispatch_job(
    job_id: str,
    strategy_name: str,
    files_contents: list[tuple[str, bytes]],
    date_from: str | None = None,
    date_to: str | None = None,
) -> None:
    """Atualiza job pra running, executa pipeline em thread pool via
    get_or_compute, atualiza pra completed/failed.

    CRITICAL: tem que usar get_or_compute() — NAO _build_analysis_result direto.
    get_or_compute armazena resultado em analysis:{cache_key}, sem isso
    /analyze nunca veria o pre-computed (cache_hit=false sempre).
    """
    n_files = len(files_contents)
    file_names = [name for name, _ in files_contents]
    period_label = f", period={date_from}..{date_to}" if date_from else ""
    logger.info(
        "Job %s RUNNING — strategy=%s, files=%d %s%s",
        job_id[:8], strategy_name, n_files, file_names, period_label,
    )
    store_job(job_id, status="running", filenames=file_names)
    loop = asyncio.get_running_loop()
    try:
        files_bytes = [content for _, content in files_contents]
        cache_key = gerar_cache_key(files_bytes, strategy_name, date_from, date_to)

        _result, _cache_hit = await loop.run_in_executor(
            _executor,
            lambda: get_or_compute(
                cache_key,
                lambda: _build_analysis_result(
                    strategy_name, files_contents, date_from, date_to
                ),
            ),
        )
        logger.info(
            "Job %s COMPLETED — cache_key=%s, cache_hit=%s",
            job_id[:8], cache_key[:12], _cache_hit,
        )
        store_job(job_id, status="completed", cache_key=cache_key, filenames=file_names)
    except Exception as exc:
        logger.error("Job %s FAILED — %s", job_id[:8], exc, exc_info=True)
        store_job(job_id, status="failed", error=str(exc), filenames=file_names)


# Re-export interno pra worker_precompute usar o mesmo nome de antes
_dispatch_job = dispatch_job
