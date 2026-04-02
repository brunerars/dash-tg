from __future__ import annotations

import asyncio
import uuid
from concurrent.futures import ThreadPoolExecutor
from itertools import combinations
from typing import Annotated

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile

from config.strategies import ESTRATEGIAS
from esoccer_dashboard.services.cache import store_job, get_job, gerar_cache_key, get_or_compute
from middleware.auth import verify_jwt_cookie
from routers.analysis import _build_analysis_result

router = APIRouter()
AuthDep = Annotated[str, Depends(verify_jwt_cookie)]

# Strategy name sourced from config/strategies.py (single source of truth per CLAUDE.md).
# Never use a free-floating string literal for strategy names.
PRECOMPUTE_STRATEGY: str = next(k for k in ESTRATEGIAS if "Over/HT" in k)

_executor = ThreadPoolExecutor(max_workers=2)

# Strong references to background tasks to prevent garbage collection (Python can GC
# unref'd asyncio.Task objects, silently killing the coroutine mid-execution).
_background_tasks: set[asyncio.Task] = set()


def _all_nonempty_combinations(
    files: list[tuple[str, bytes]],
) -> list[list[tuple[str, bytes]]]:
    """All non-empty subsets of files, sorted by size ascending. N files -> 2^N-1 combos."""
    result: list[list[tuple[str, bytes]]] = []
    for r in range(1, len(files) + 1):
        for combo in combinations(files, r):
            result.append(list(combo))
    return result


async def _dispatch_job(job_id: str, files_contents: list[tuple[str, bytes]]) -> None:
    """Updates job to running, executes pipeline in thread pool via get_or_compute,
    updates to completed/failed.

    CRITICAL: Must use get_or_compute() — NOT _build_analysis_result() directly.
    get_or_compute stores the result under analysis:{cache_key} in Redis.
    Without this, /analyze would never see the pre-computed result (cache_hit=false).
    """
    store_job(job_id, status="running")
    loop = asyncio.get_running_loop()
    try:
        # 1. Compute cache_key FIRST (same formula as /analyze uses)
        files_bytes = [content for _, content in files_contents]
        cache_key = gerar_cache_key(files_bytes, PRECOMPUTE_STRATEGY)

        # 2. Use get_or_compute to run pipeline AND store result under analysis:{cache_key}
        #    This is the SAME function /analyze uses via _analyze_with_strategy.
        #    On cache hit (already computed by another job), it returns immediately.
        #    On cache miss, it calls the lambda, stores result in Redis, returns it.
        _result, _cache_hit = await loop.run_in_executor(
            _executor,
            lambda: get_or_compute(
                cache_key,
                lambda: _build_analysis_result(PRECOMPUTE_STRATEGY, files_contents),
            ),
        )
        store_job(job_id, status="completed", cache_key=cache_key)
    except Exception as exc:
        store_job(job_id, status="failed", error=str(exc))


@router.post(
    "/precompute",
    status_code=202,
    tags=["pre-computation"],
    summary="Pre-computar todas as combinacoes Over/HT",
)
async def precompute(
    _user: AuthDep,
    files: list[UploadFile] = File(...),
) -> dict:
    """Upload N planilhas e dispara 2^N-1 jobs em background para Over/HT.
    Retorna lista de job_ids para polling via GET /jobs/{job_id}."""
    if len(files) < 1:
        raise HTTPException(status_code=422, detail="Envie pelo menos 1 arquivo.")

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

    job_ids: list[str] = []
    for combo in combos:
        job_id = str(uuid.uuid4())
        store_job(job_id, status="pending")
        # Strong reference via _background_tasks prevents GC of the Task object
        t = asyncio.create_task(_dispatch_job(job_id, combo))
        _background_tasks.add(t)
        t.add_done_callback(_background_tasks.discard)
        job_ids.append(job_id)

    return {"job_ids": job_ids, "total_jobs": len(job_ids)}


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
