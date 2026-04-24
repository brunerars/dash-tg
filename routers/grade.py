"""Router /flags e /grade — persiste duplas flagadas e entrega a grade do dia."""
from __future__ import annotations

from datetime import date
from typing import Annotated, Any, Dict, List, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from grade.service import GradeService
from middleware.auth import verify_jwt_cookie

AuthDep = Annotated[str, Depends(verify_jwt_cookie)]
DbDep = Annotated[AsyncSession, Depends(get_db)]

router = APIRouter(tags=["grade"])


def _svc(db: AsyncSession) -> GradeService:
    return GradeService(db)


# ---------------- Schemas ----------------

class FlagCreate(BaseModel):
    dupla: str = Field(..., description="Nome da dupla como aparece na tabela (com sufixos OK)")
    strategy: str = Field(..., description="'Dale', 'OverUnder' ou identificador da estrategia")
    snapshot: Dict[str, Any] = Field(default_factory=dict, description="Metrica + contexto congelado no momento do flag")
    snapshot_cache_key: Optional[str] = Field(default=None)


class SnapshotRefresh(BaseModel):
    snapshot: Dict[str, Any]
    snapshot_cache_key: Optional[str] = None


class FlagResponse(BaseModel):
    id: str
    p1: str
    p2: str
    dupla_display: str
    strategy: str
    flagged_at: Optional[str]
    snapshot_cache_key: Optional[str]
    games_added: int = 0


# ---------------- Endpoints ----------------

@router.post("/flags", response_model=FlagResponse, status_code=status.HTTP_201_CREATED)
async def create_flag(payload: FlagCreate, username: AuthDep, db: DbDep):
    svc = _svc(db)
    try:
        fav, added = await svc.flag_dupla(
            username=username,
            dupla=payload.dupla,
            strategy=payload.strategy,
            snapshot=payload.snapshot,
            snapshot_cache_key=payload.snapshot_cache_key,
        )
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    return FlagResponse(
        id=str(fav.id),
        p1=fav.p1,
        p2=fav.p2,
        dupla_display=fav.dupla_display,
        strategy=fav.strategy,
        flagged_at=fav.flagged_at.isoformat() if fav.flagged_at else None,
        snapshot_cache_key=fav.snapshot_cache_key,
        games_added=added,
    )


@router.get("/flags")
async def list_flags(username: AuthDep, db: DbDep) -> List[Dict[str, Any]]:
    return await _svc(db).list_flags(username)


@router.delete("/flags/{favorite_id}")
async def delete_flag(favorite_id: UUID, username: AuthDep, db: DbDep):
    ok = await _svc(db).unflag(username, favorite_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Favorito nao encontrado")
    return {"success": True, "id": str(favorite_id)}


@router.post("/flags/{favorite_id}/refresh-snapshot")
async def refresh_snapshot(
    favorite_id: UUID,
    payload: SnapshotRefresh,
    username: AuthDep,
    db: DbDep,
):
    fav = await _svc(db).refresh_snapshot(
        username=username,
        favorite_id=favorite_id,
        snapshot=payload.snapshot,
        snapshot_cache_key=payload.snapshot_cache_key,
    )
    if fav is None:
        raise HTTPException(status_code=404, detail="Favorito nao encontrado")
    return {
        "success": True,
        "id": str(fav.id),
        "snapshot_cache_key": fav.snapshot_cache_key,
    }


@router.get("/grade")
async def list_grade(
    username: AuthDep,
    db: DbDep,
    date_from: Optional[str] = Query(default=None, description="YYYY-MM-DD ou DD/MM/YY conforme armazenado"),
    date_to: Optional[str] = Query(default=None),
):
    items = await _svc(db).list_grade(username, date_from=date_from, date_to=date_to)
    return {"total": len(items), "items": items}


@router.post("/grade/sync")
async def sync_grade(username: AuthDep, db: DbDep):
    """Forca sync manual dos favoritos do usuario com o cache de scraper."""
    added = await _svc(db).sync_all_active(username=username)
    return {"added": added}
