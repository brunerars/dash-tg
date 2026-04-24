from __future__ import annotations

import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import Boolean, DateTime, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB, UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.sql import func

from database import Base

if TYPE_CHECKING:
    from models.grid_match import GridMatch


class Favorite(Base):
    __tablename__ = "favorites"
    __table_args__ = (
        UniqueConstraint("username", "p1", "p2", "strategy", name="uq_favorites_user_pair_strategy"),
    )

    id: Mapped[uuid.UUID] = mapped_column(PGUUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    username: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    p1: Mapped[str] = mapped_column(String(128), nullable=False)
    p2: Mapped[str] = mapped_column(String(128), nullable=False)
    dupla_display: Mapped[str] = mapped_column(String(300), nullable=False)
    strategy: Mapped[str] = mapped_column(String(64), nullable=False)
    flagged_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
    analysis_snapshot: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    snapshot_cache_key: Mapped[str | None] = mapped_column(String(128), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)

    grid_matches: Mapped[list["GridMatch"]] = relationship(
        "GridMatch",
        back_populates="favorite",
        cascade="all, delete-orphan",
    )
