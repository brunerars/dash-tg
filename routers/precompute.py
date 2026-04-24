from __future__ import annotations

import asyncio
import logging
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import date, timedelta
from itertools import combinations
from typing import Annotated

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile

import hashlib
import pickle

from config.settings import PRECOMPUTE_WORKERS
from config.strategies import ESTRATEGIAS, get_strategy_internal
from esoccer_dashboard.services.cache import (
    store_job, get_job, gerar_cache_key, get_or_compute,
    get_file_df, store_file_df,
)
from esoccer_dashboard.services.loader import load_tips_enviadas
from middleware.auth import verify_jwt_cookie
from routers.analysis import _build_analysis_result, _UploadFileAdapter

logger = logging.getLogger(__name__)

router = APIRouter()
AuthDep = Annotated[str, Depends(verify_jwt_cookie)]

_executor = ThreadPoolExecutor(max_workers=PRECOMPUTE_WORKERS)

# Strong references to background tasks to prevent garbage collection (Python can GC
# unref'd asyncio.Task objects, silently killing the coroutine mid-execution).
_background_tasks: set[asyncio.Task] = set()


def _preparse_files(files_contents: list[tuple[str, bytes]]) -> None:
    """Parse each unique file and cache the DataFrame in Redis.

    This runs BEFORE dispatching background jobs so that workers
    get instant cache hits instead of re-parsing 25MB xlsx files.
    Critical for performance: openpyxl takes ~2 min per 10MB file.
    """
    for name, content in files_contents:
        file_hash = hashlib.md5(content).hexdigest()
        if get_file_df(file_hash) is not None:
            logger.info("File %s already cached (hash=%s)", name, file_hash[:8])
            continue
        logger.info("Pre-parsing %s (%d MB, hash=%s)...", name, len(content) // (1024 * 1024), file_hash[:8])
        adapter = _UploadFileAdapter(name, content)
        result = load_tips_enviadas([adapter])
        pickled = pickle.dumps(result.df)
        store_file_df(file_hash, pickled)
        logger.info("Pre-parsed %s — %d rows, cached %d MB pickle", name, len(result.df), len(pickled) // (1024 * 1024))


def _all_nonempty_combinations(
    files: list[tuple[str, bytes]],
) -> list[list[tuple[str, bytes]]]:
    """All non-empty subsets of files, sorted by size ascending. N files -> 2^N-1 combos."""
    result: list[list[tuple[str, bytes]]] = []
    for r in range(1, len(files) + 1):
        for combo in combinations(files, r):
            result.append(list(combo))
    return result


async def _dispatch_job(
    job_id: str,
    strategy_name: str,
    files_contents: list[tuple[str, bytes]],
    date_from: str | None = None,
    date_to: str | None = None,
) -> None:
    """Updates job to running, executes pipeline in thread pool via get_or_compute,
    updates to completed/failed.

    CRITICAL: Must use get_or_compute() — NOT _build_analysis_result() directly.
    get_or_compute stores the result under analysis:{cache_key} in Redis.
    Without this, /analyze would never see the pre-computed result (cache_hit=false).
    """
    n_files = len(files_contents)
    file_names = [name for name, _ in files_contents]
    period_label = f", period={date_from}..{date_to}" if date_from else ""
    logger.info("Job %s RUNNING — strategy=%s, files=%d %s%s", job_id[:8], strategy_name, n_files, file_names, period_label)
    store_job(job_id, status="running", filenames=file_names)
    loop = asyncio.get_running_loop()
    try:
        files_bytes = [content for _, content in files_contents]
        cache_key = gerar_cache_key(files_bytes, strategy_name, date_from, date_to)

        _result, _cache_hit = await loop.run_in_executor(
            _executor,
            lambda: get_or_compute(
                cache_key,
                lambda: _build_analysis_result(strategy_name, files_contents, date_from, date_to),
            ),
        )
        logger.info("Job %s COMPLETED — cache_key=%s, cache_hit=%s", job_id[:8], cache_key[:12], _cache_hit)
        store_job(job_id, status="completed", cache_key=cache_key, filenames=file_names)
    except Exception as exc:
        logger.error("Job %s FAILED — %s", job_id[:8], exc, exc_info=True)
        store_job(job_id, status="failed", error=str(exc), filenames=file_names)


PRECOMPUTE_PERIODS = [15, 30, 60, 90]


def _period_date_range(days: int) -> tuple[str, str]:
    """Return (date_from, date_to) for a quick-period preset."""
    today = date.today()
    return (today - timedelta(days=days)).isoformat(), today.isoformat()


async def _dispatch_remaining_after_primary(
    primary_job_id: str,
    strategy_name: str,
    combos: list[list[tuple[str, bytes]]],
    job_ids: list[str],
    period_jobs: list[tuple[str, int, list[tuple[str, bytes]]]] | None = None,
) -> None:
    """Wait for the primary job to finish, then dispatch remaining combos ONE AT A TIME.

    This prevents GIL contention and memory pressure from running
    multiple CPU-heavy pandas pipelines in parallel.
    """
    # Wait for primary to finish before starting subsets
    while True:
        job = get_job(primary_job_id)
        if job and job.get("status") in ("completed", "failed"):
            break
        await asyncio.sleep(2)

    # Dispatch period variants for the full combo first (high value for UX)
    if period_jobs:
        logger.info("Primary done. Dispatching %d period variants sequentially.", len(period_jobs))
        for jid, days, full_combo in period_jobs:
            dfrom, dto = _period_date_range(days)
            store_job(jid, status="pending")
            await _dispatch_job(jid, strategy_name, full_combo, date_from=dfrom, date_to=dto)

    logger.info("Dispatching %d remaining file combos sequentially.", len(combos))
    for jid, combo in zip(job_ids, combos):
        store_job(jid, status="pending")
        await _dispatch_job(jid, strategy_name, combo)


@router.post(
    "/precompute",
    status_code=202,
    tags=["pre-computation"],
    summary="Pre-computar todas as combinacoes para uma estrategia",
)
async def precompute(
    _user: AuthDep,
    files: list[UploadFile] = File(...),
    strategy: str = Form(...),
) -> dict:
    """Upload N planilhas e dispara jobs em background para a estrategia indicada.
    Gera 2^N-1 combinacoes. A combinacao completa (todos os arquivos) e
    priorizada — seu job_id vem no campo ``primary_job_id``.
    Retorna job_ids para polling via GET /jobs/status."""
    if len(files) < 1:
        raise HTTPException(status_code=422, detail="Envie pelo menos 1 arquivo.")

    if get_strategy_internal(strategy) is None:
        raise HTTPException(status_code=422, detail=f"Estrategia invalida: {strategy}")

    # Read all file bytes BEFORE returning response (UploadFile closes after response)
    files_contents: list[tuple[str, bytes]] = []
    for i, uf in enumerate(files):
        content = await uf.read()
        files_contents.append((uf.filename or f"file_{i}.xlsx", content))

    # Check for duplicate filenames
    filenames = [name for name, _ in files_contents]
    seen: set[str] = set()
    duplicates = [f for f in filenames if f in seen or seen.add(f)]  # type: ignore[func-returns-value]
    if duplicates:
        raise HTTPException(
            status_code=422,
            detail=f"Arquivos com nome repetido nao sao permitidos: {duplicates}",
        )

    combos = _all_nonempty_combinations(files_contents)

    logger.info(
        "Precompute: strategy=%s, files=%d, combos=%d",
        strategy, len(files_contents), len(combos),
    )

    # Pre-parse all files BEFORE dispatching jobs.
    # calamine is fast (~10s/10MB) but still worth caching for the 7 combos.
    loop = asyncio.get_running_loop()
    await loop.run_in_executor(_executor, lambda: _preparse_files(files_contents))
    logger.info("All files pre-parsed and cached.")

    # Build job list with filenames per combo (for frontend mapping)
    full_combo = combos[-1]  # all files combined
    remaining_combos = combos[:-1]

    # Primary job: full combination (dispatched immediately)
    primary_job_id = str(uuid.uuid4())
    primary_filenames = [name for name, _ in full_combo]
    store_job(primary_job_id, status="pending", filenames=primary_filenames)
    t = asyncio.create_task(_dispatch_job(primary_job_id, strategy, full_combo))
    _background_tasks.add(t)
    t.add_done_callback(_background_tasks.discard)

    # Period jobs: full combo × 4 standard periods (15d, 30d, 60d, 90d)
    period_job_list: list[tuple[str, int, list[tuple[str, bytes]]]] = []
    period_jobs_response: list[dict] = []
    for days in PRECOMPUTE_PERIODS:
        jid = str(uuid.uuid4())
        period_job_list.append((jid, days, full_combo))
        period_jobs_response.append({
            "job_id": jid,
            "filenames": primary_filenames,
            "period_days": days,
        })

    # Remaining combos: dispatched sequentially AFTER primary completes
    remaining_jobs: list[dict] = []
    remaining_ids: list[str] = []
    for combo in remaining_combos:
        jid = str(uuid.uuid4())
        combo_filenames = [name for name, _ in combo]
        remaining_ids.append(jid)
        remaining_jobs.append({"job_id": jid, "filenames": combo_filenames})

    if remaining_ids or period_job_list:
        bg_task = asyncio.create_task(
            _dispatch_remaining_after_primary(
                primary_job_id, strategy, remaining_combos, remaining_ids,
                period_jobs=period_job_list,
            )
        )
        _background_tasks.add(bg_task)
        bg_task.add_done_callback(_background_tasks.discard)

    all_job_ids = [primary_job_id] + [p["job_id"] for p in period_jobs_response] + remaining_ids

    # Return combo→filenames mapping so frontend can map file selection to cache_key
    combo_map = [{"job_id": primary_job_id, "filenames": primary_filenames}] + remaining_jobs

    return {
        "job_ids": all_job_ids,
        "primary_job_id": primary_job_id,
        "total_jobs": len(all_job_ids),
        "strategy": strategy,
        "combos": combo_map,
        "period_combos": period_jobs_response,
    }


@router.get(
    "/jobs/status",
    tags=["pre-computation"],
    summary="Status em bulk de multiplos jobs",
)
def get_jobs_bulk_status(_user: AuthDep, ids: str = "") -> dict:
    """Retorna status de multiplos jobs de uma vez. IDs separados por virgula."""
    job_ids = [jid.strip() for jid in ids.split(",") if jid.strip()]
    if not job_ids:
        raise HTTPException(status_code=422, detail="Parametro 'ids' e obrigatorio.")
    jobs: list[dict] = []
    for jid in job_ids:
        job = get_job(jid)
        if job is None:
            jobs.append({"job_id": jid, "status": "expired"})
        else:
            jobs.append(job)
    completed = sum(1 for j in jobs if j.get("status") == "completed")
    failed = sum(1 for j in jobs if j.get("status") == "failed")
    return {
        "jobs": jobs,
        "total": len(jobs),
        "completed": completed,
        "failed": failed,
        "all_done": (completed + failed) == len(jobs),
    }


@router.get(
    "/jobs/{job_id}",
    tags=["pre-computation"],
    summary="Status de um job de pre-computacao",
)
def get_job_status(_user: AuthDep, job_id: str) -> dict:
    """Retorna status do job: pending, running, completed (com cache_key), ou failed (com error)."""
    job = get_job(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job nao encontrado ou expirado.")
    return job
