from __future__ import annotations

import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import DateTime, ForeignKey, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB, UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.sql import func

from database import Base

if TYPE_CHECKING:
    from models.favorite import Favorite


class GridMatch(Base):
    __tablename__ = "grid_matches"
    __table_args__ = (
        UniqueConstraint("favorite_id", "match_hash", name="uq_grid_match_fav_hash"),
    )

    id: Mapped[uuid.UUID] = mapped_column(PGUUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    favorite_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("favorites.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    liga: Mapped[str] = mapped_column(String(32), nullable=False)
    event_date: Mapped[str | None] = mapped_column(String(16), nullable=True)
    event_time: Mapped[str | None] = mapped_column(String(8), nullable=True)
    event_dt_br: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    home_team: Mapped[str | None] = mapped_column(String(128), nullable=True)
    home_player: Mapped[str | None] = mapped_column(String(128), nullable=True)
    away_team: Mapped[str | None] = mapped_column(String(128), nullable=True)
    away_player: Mapped[str | None] = mapped_column(String(128), nullable=True)
    match_hash: Mapped[str] = mapped_column(String(32), nullable=False)
    raw_event: Mapped[dict] = mapped_column(JSONB, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    favorite: Mapped["Favorite"] = relationship("Favorite", back_populates="grid_matches")
