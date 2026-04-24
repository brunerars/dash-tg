"""GradeService — orquestra flags, snapshot e sync com scraper."""
from __future__ import annotations

import hashlib
import logging
from datetime import datetime, timezone
from typing import Dict, List, Optional, Tuple
from uuid import UUID
from zoneinfo import ZoneInfo

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from grade.dupla_matcher import dupla_to_pair, event_pair, pair_to_display
from grade.scrapers_cache import ScrapersCache, get_scrapers_cache
from models.favorite import Favorite
from models.grid_match import GridMatch

logger = logging.getLogger(__name__)
TZ_BR = ZoneInfo("America/Sao_Paulo")


def _parse_dt(data_str: Optional[str], horario: Optional[str]) -> Optional[datetime]:
    if not data_str or not horario:
        return None
    try:
        hh, mm = [int(x) for x in str(horario).split(":")]
    except Exception:
        return None
    s = str(data_str).strip()
    try:
        if "/" in s:
            parts = s.split("/")
            if len(parts) != 3:
                return None
            dd, mo, yy_raw = int(parts[0]), int(parts[1]), parts[2]
            yy = int(yy_raw) + 2000 if len(yy_raw) == 2 else int(yy_raw)
            return datetime(yy, mo, dd, hh, mm, tzinfo=TZ_BR)
        if "-" in s:
            parts = s.split("-")
            if len(parts) != 3:
                return None
            return datetime(int(parts[0]), int(parts[1]), int(parts[2]), hh, mm, tzinfo=TZ_BR)
    except Exception:
        return None
    return None


def _match_hash(event: Dict) -> str:
    """MD5 estavel pra dedup — compativel com padrao do v3."""
    parts = [
        str(event.get("liga", "")).lower(),
        str(event.get("data", "")).strip(),
        str(event.get("horario", "")).strip(),
        str(event.get("jogador_casa") or event.get("P1") or "").strip().lower(),
        str(event.get("jogador_fora") or event.get("P2") or "").strip().lower(),
    ]
    return hashlib.md5("|".join(parts).encode("utf-8")).hexdigest()


def _future_only(events: List[Dict]) -> List[Dict]:
    now = datetime.now(TZ_BR)
    today = now.date()
    current = now.strftime("%H:%M")
    out: List[Dict] = []
    for ev in events:
        dt = _parse_dt(ev.get("data"), ev.get("horario"))
        if dt is None:
            out.append(ev)
            continue
        d = dt.date()
        if d > today:
            out.append(ev)
        elif d == today and str(ev.get("horario") or "") >= current:
            out.append(ev)
    return out


class GradeService:
    def __init__(self, db: AsyncSession, scrapers: Optional[ScrapersCache] = None) -> None:
        self.db = db
        self.scrapers = scrapers or get_scrapers_cache()

    # ---------- FLAG ----------

    async def flag_dupla(
        self,
        username: str,
        dupla: str,
        strategy: str,
        snapshot: Dict,
        snapshot_cache_key: Optional[str],
    ) -> Tuple[Favorite, int]:
        """Cria (ou reativa) favorito e popula grid_matches com jogos futuros."""
        pair = dupla_to_pair(dupla)
        if pair is None:
            raise ValueError(f"nao foi possivel extrair dupla de '{dupla}'")
        p1, p2 = pair

        # Ja existe?
        existing = await self._get_fav(username, p1, p2, strategy)
        if existing:
            existing.analysis_snapshot = snapshot
            existing.snapshot_cache_key = snapshot_cache_key
            existing.is_active = True
            await self.db.commit()
            await self.db.refresh(existing)
            fav = existing
        else:
            fav = Favorite(
                username=username,
                p1=p1,
                p2=p2,
                dupla_display=pair_to_display(p1, p2),
                strategy=strategy,
                analysis_snapshot=snapshot,
                snapshot_cache_key=snapshot_cache_key,
                is_active=True,
            )
            self.db.add(fav)
            await self.db.commit()
            await self.db.refresh(fav)

        added = await self.sync_matches_for_favorite(fav)
        return fav, added

    async def unflag(self, username: str, favorite_id: UUID) -> bool:
        fav = await self.db.get(Favorite, favorite_id)
        if fav is None or fav.username != username:
            return False
        await self.db.delete(fav)  # cascade em grid_matches
        await self.db.commit()
        return True

    async def refresh_snapshot(
        self,
        username: str,
        favorite_id: UUID,
        snapshot: Dict,
        snapshot_cache_key: Optional[str],
    ) -> Optional[Favorite]:
        fav = await self.db.get(Favorite, favorite_id)
        if fav is None or fav.username != username:
            return None
        fav.analysis_snapshot = snapshot
        fav.snapshot_cache_key = snapshot_cache_key
        await self.db.commit()
        await self.db.refresh(fav)
        return fav

    # ---------- SYNC ----------

    async def sync_matches_for_favorite(self, fav: Favorite) -> int:
        """Varre scraper, adiciona jogos novos (dedup por match_hash)."""
        events = await self.scrapers.get_all_matches()
        if not events:
            return 0
        events = _future_only(events)

        pair = (fav.p1, fav.p2)
        matching = [ev for ev in events if event_pair(ev) == pair]
        if not matching:
            return 0

        existing = await self.db.execute(
            select(GridMatch.match_hash).where(GridMatch.favorite_id == fav.id)
        )
        existing_hashes = {row[0] for row in existing.fetchall()}

        added = 0
        for ev in matching:
            h = _match_hash(ev)
            if h in existing_hashes:
                continue
            dt_br = _parse_dt(ev.get("data"), ev.get("horario"))
            dt_utc = dt_br.astimezone(timezone.utc) if dt_br else None
            gm = GridMatch(
                favorite_id=fav.id,
                liga=str(ev.get("liga") or ""),
                event_date=str(ev.get("data") or "") or None,
                event_time=str(ev.get("horario") or "") or None,
                event_dt_br=dt_utc,
                home_team=str(ev.get("time_casa") or "") or None,
                home_player=str(ev.get("jogador_casa") or ev.get("P1") or "") or None,
                away_team=str(ev.get("time_fora") or "") or None,
                away_player=str(ev.get("jogador_fora") or ev.get("P2") or "") or None,
                match_hash=h,
                raw_event=ev,
            )
            self.db.add(gm)
            added += 1
        if added:
            await self.db.commit()
        return added

    async def sync_all_active(self, username: Optional[str] = None) -> int:
        stmt = select(Favorite).where(Favorite.is_active.is_(True))
        if username:
            stmt = stmt.where(Favorite.username == username)
        result = await self.db.execute(stmt)
        favs = result.scalars().all()
        total = 0
        for fav in favs:
            try:
                total += await self.sync_matches_for_favorite(fav)
            except Exception as e:
                logger.warning(f"[GRADE] sync fav {fav.id} falhou: {e}")
        return total

    # ---------- READ ----------

    async def list_flags(self, username: str) -> List[Dict]:
        """Lista favoritos + agregados de jogos.

        Semantica (alinhada com a aba Grade do Dia):
        - upcoming_count = jogos de HOJE ou qualquer dia futuro (inclui jogos do dia
          que ja comecaram/terminaram — alinha com o que aparece em /grade).
        - past_count = jogos de dias anteriores.
        - next_game_at = proximo jogo que ainda nao comecou (>= agora).
        - last_game_at = ultimo jogo ja iniciado (< agora).

        NULLs em event_dt_br sao tratados como "upcoming" (fallback defensivo pra
        nao esconder partida so porque a data nao deu pra parsear).
        """
        now_br = datetime.now(TZ_BR)
        today_start_utc = now_br.replace(hour=0, minute=0, second=0, microsecond=0).astimezone(timezone.utc)
        now_utc = now_br.astimezone(timezone.utc)

        total_count = func.count(GridMatch.id)
        past_count = func.count(GridMatch.id).filter(GridMatch.event_dt_br < today_start_utc)
        next_dt = func.min(GridMatch.event_dt_br).filter(GridMatch.event_dt_br >= now_utc)
        last_dt = func.max(GridMatch.event_dt_br).filter(GridMatch.event_dt_br < now_utc)

        stmt = (
            select(
                Favorite,
                total_count.label("total_count"),
                past_count.label("past_count"),
                next_dt.label("next_dt"),
                last_dt.label("last_dt"),
            )
            .outerjoin(GridMatch, GridMatch.favorite_id == Favorite.id)
            .where(Favorite.username == username, Favorite.is_active.is_(True))
            .group_by(Favorite.id)
            .order_by(Favorite.flagged_at.desc())
        )
        result = await self.db.execute(stmt)
        out: List[Dict] = []
        for fav, total, pcount, ndt, ldt in result.all():
            total_i = int(total or 0)
            past_i = int(pcount or 0)
            upcoming_i = max(0, total_i - past_i)  # inclui NULLs e hoje
            d = self._fav_to_dict(fav)
            d["upcoming_count"] = upcoming_i
            d["past_count"] = past_i
            d["next_game_at"] = ndt.isoformat() if ndt else None
            d["last_game_at"] = ldt.isoformat() if ldt else None
            out.append(d)
        return out

    async def list_grade(
        self,
        username: str,
        date_from: Optional[str] = None,
        date_to: Optional[str] = None,
    ) -> List[Dict]:
        """Jogos agrupados por dia (lista flat; agrupamento no frontend)."""
        # Busca favs + jogos
        result = await self.db.execute(
            select(Favorite, GridMatch)
            .join(GridMatch, GridMatch.favorite_id == Favorite.id)
            .where(Favorite.username == username, Favorite.is_active.is_(True))
            .order_by(GridMatch.event_dt_br.asc())
        )
        rows = result.all()
        out: List[Dict] = []
        for fav, gm in rows:
            if date_from and gm.event_date and gm.event_date < date_from:
                continue
            if date_to and gm.event_date and gm.event_date > date_to:
                continue
            out.append({
                "match_id": str(gm.id),
                "favorite_id": str(fav.id),
                "dupla_display": fav.dupla_display,
                "strategy": fav.strategy,
                "liga": gm.liga,
                "event_date": gm.event_date,
                "event_time": gm.event_time,
                "event_dt_br": gm.event_dt_br.isoformat() if gm.event_dt_br else None,
                "home_team": gm.home_team,
                "home_player": gm.home_player,
                "away_team": gm.away_team,
                "away_player": gm.away_player,
                "snapshot": fav.analysis_snapshot,
                "snapshot_cache_key": fav.snapshot_cache_key,
                "flagged_at": fav.flagged_at.isoformat() if fav.flagged_at else None,
            })
        return out

    # ---------- INTERNOS ----------

    async def _get_fav(self, username: str, p1: str, p2: str, strategy: str) -> Optional[Favorite]:
        result = await self.db.execute(
            select(Favorite).where(
                Favorite.username == username,
                Favorite.p1 == p1,
                Favorite.p2 == p2,
                Favorite.strategy == strategy,
            )
        )
        return result.scalar_one_or_none()

    def _fav_to_dict(self, f: Favorite) -> Dict:
        return {
            "id": str(f.id),
            "p1": f.p1,
            "p2": f.p2,
            "dupla_display": f.dupla_display,
            "strategy": f.strategy,
            "flagged_at": f.flagged_at.isoformat() if f.flagged_at else None,
            "snapshot_cache_key": f.snapshot_cache_key,
            "snapshot": f.analysis_snapshot,
        }
