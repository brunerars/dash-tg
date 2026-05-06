"""Endpoint /precompute — salva arquivos no volume compartilhado e
enfileira **uma** task ARQ (`process_precompute_task`) no worker dedicado.

Toda CPU/RAM pesada (parse xlsx, dedup, metrics) acontece no container
`precompute_worker`. A API responde 202 imediato e nunca cai por OOM
de upload pesado.

Endpoints:
- POST /precompute       -> 202, dispara worker
- GET  /jobs/status?ids  -> bulk polling do frontend
- GET  /jobs/{job_id}    -> single polling
"""
from __future__ import annotations

import logging
import os
import uuid
from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile

from arq_client import get_arq_pool
from config.strategies import get_strategy_internal
from esoccer_dashboard.services.cache import get_job, store_job
from middleware.auth import verify_jwt_cookie
from precompute_jobs import PRECOMPUTE_PERIODS, all_nonempty_combinations

logger = logging.getLogger(__name__)

router = APIRouter()
AuthDep = Annotated[str, Depends(verify_jwt_cookie)]

# Volume compartilhado entre api e precompute_worker no docker-compose.
UPLOAD_DIR = Path("/tmp/precompute")


def _save_uploads_to_disk(
    batch_id: str, files: list[UploadFile]
) -> list[tuple[str, str]]:
    """Salva uploads em /tmp/precompute/<batch_id>/ e retorna lista
    [(filename, abs_path)]. Cria o diretorio se nao existir.
    """
    batch_dir = UPLOAD_DIR / batch_id
    batch_dir.mkdir(parents=True, exist_ok=True)
    saved: list[tuple[str, str]] = []
    for i, uf in enumerate(files):
        name = uf.filename or f"file_{i}.xlsx"
        # Sanitiza pra evitar path traversal — so o basename
        safe_name = os.path.basename(name)
        dest = batch_dir / safe_name
        # Stream em chunks pra nao carregar arquivo inteiro em RAM da API
        with dest.open("wb") as fp:
            while chunk := uf.file.read(1024 * 1024):  # 1 MB chunks
                fp.write(chunk)
        saved.append((safe_name, str(dest.resolve())))
    return saved


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
    """Upload de N planilhas + estrategia. Salva arquivos no disco,
    enfileira ARQ task no worker e retorna 202 imediato com job_ids
    pra polling. Worker processa primary + 4 periodos + 2^N-1 combos
    sequencialmente.
    """
    if len(files) < 1:
        raise HTTPException(status_code=422, detail="Envie pelo menos 1 arquivo.")

    if get_strategy_internal(strategy) is None:
        raise HTTPException(status_code=422, detail=f"Estrategia invalida: {strategy}")

    # Checa nomes duplicados ANTES de salvar (evita sobrescrever)
    filenames_raw = [uf.filename or f"file_{i}.xlsx" for i, uf in enumerate(files)]
    seen: set[str] = set()
    duplicates = [f for f in filenames_raw if f in seen or seen.add(f)]  # type: ignore[func-returns-value]
    if duplicates:
        raise HTTPException(
            status_code=422,
            detail=f"Arquivos com nome repetido nao sao permitidos: {duplicates}",
        )

    # 1. Salva uploads em disco — API nao mantem bytes em RAM
    batch_id = str(uuid.uuid4())
    saved = _save_uploads_to_disk(batch_id, files)
    saved_names = [n for n, _ in saved]
    logger.info(
        "Precompute batch=%s strategy=%s files=%d (%s)",
        batch_id[:8], strategy, len(saved), saved_names,
    )

    # 2. Gera todos os job_ids upfront (frontend precisa deles no response)
    n_files = len(saved)
    n_combos = 2 ** n_files - 1  # subsets nao vazios
    full_combo_names = saved_names  # todos juntos = primary

    # Fake "files_contents" so pra reusar all_nonempty_combinations e gerar
    # a ordem dos combos. Sem bytes — substituidos por (name, b"") aqui.
    placeholder_combos = all_nonempty_combinations(
        [(n, b"") for n in saved_names]
    )
    # all_nonempty_combinations retorna do menor pro maior, primary = ultimo
    full_combo = placeholder_combos[-1]
    remaining_combos = placeholder_combos[:-1]

    # Primary
    primary_job_id = str(uuid.uuid4())
    store_job(primary_job_id, status="pending", filenames=full_combo_names)

    # 4 periodos sobre o full combo
    period_jobs_response: list[dict] = []
    period_jobs_payload: list[dict] = []
    for days in PRECOMPUTE_PERIODS:
        jid = str(uuid.uuid4())
        store_job(jid, status="pending", filenames=full_combo_names)
        period_jobs_response.append({
            "job_id": jid,
            "filenames": full_combo_names,
            "period_days": days,
        })
        period_jobs_payload.append({"job_id": jid, "days": days})

    # Remaining combos (subsets menores)
    remaining_response: list[dict] = []
    remaining_payload: list[dict] = []
    for combo in remaining_combos:
        jid = str(uuid.uuid4())
        combo_filenames = [n for n, _ in combo]
        store_job(jid, status="pending", filenames=combo_filenames)
        remaining_response.append({"job_id": jid, "filenames": combo_filenames})
        remaining_payload.append({"job_id": jid, "filenames": combo_filenames})

    # 3. Enfileira UMA task ARQ que executa tudo sequencial
    pool = await get_arq_pool()
    payload = {
        "batch_id": batch_id,
        "strategy_name": strategy,
        "saved_files": saved,  # [(filename, abs_path)]
        "primary_job_id": primary_job_id,
        "period_jobs": period_jobs_payload,
        "remaining_combos": remaining_payload,
    }
    await pool.enqueue_job("process_precompute_task", payload)
    logger.info(
        "Enqueued ARQ job — primary=%s, periods=%d, remaining=%d, total_jobs=%d, n_combos=%d",
        primary_job_id[:8], len(period_jobs_payload), len(remaining_payload),
        1 + len(period_jobs_payload) + len(remaining_payload), n_combos,
    )

    all_job_ids = (
        [primary_job_id]
        + [p["job_id"] for p in period_jobs_response]
        + [r["job_id"] for r in remaining_response]
    )
    combo_map = (
        [{"job_id": primary_job_id, "filenames": full_combo_names}]
        + remaining_response
    )

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
    """Retorna status do job: pending, running, completed (com cache_key) ou failed."""
    job = get_job(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job nao encontrado ou expirado.")
    return job
