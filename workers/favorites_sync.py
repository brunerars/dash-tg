"""Scheduler que sincroniza favoritos ativos com o cache de scraper.

A cada N min, roda `GradeService.sync_all_active()` — garante que jogos
descobertos pelo scraper apos o flag apareçam na grade do usuario.

Usa SETNX + heartbeat pra evitar execucao duplicada em multiplas instancias.
"""
from __future__ import annotations

import asyncio
import logging
from datetime import datetime
from typing import Optional

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.interval import IntervalTrigger

from config.settings import FAVORITES_SYNC_LOCK_KEY, FAVORITES_SYNC_MIN
from database import async_session
from grade.async_cache import AsyncCache
from grade.service import GradeService

logger = logging.getLogger(__name__)


class FavoritesSyncScheduler:
    LOCK_TIMEOUT = 120

    def __init__(self, cache: Optional[AsyncCache] = None) -> None:
        self.cache = cache or AsyncCache()
        self.scheduler = AsyncIOScheduler()
        self.is_running = False
        self.interval_min = FAVORITES_SYNC_MIN
        self.lock_key = FAVORITES_SYNC_LOCK_KEY

    async def start(self) -> None:
        if self.is_running:
            return
        print("[FAV_SYNC] iniciando")
        asyncio.create_task(self._initial())
        self.scheduler.add_job(
            self.run_once,
            trigger=IntervalTrigger(minutes=self.interval_min),
            id="favorites_sync",
            replace_existing=True,
        )
        self.scheduler.start()
        self.is_running = True
        print(f"[FAV_SYNC] ativo — cada {self.interval_min} min")

    async def _initial(self) -> None:
        try:
            await self.run_once()
        except Exception as e:
            print(f"[FAV_SYNC] erro inicial: {e}")

    async def stop(self) -> None:
        if self.is_running:
            self.scheduler.shutdown(wait=False)
            await self.cache.close()
            self.is_running = False

    async def run_once(self) -> int:
        if not await self._acquire():
            logger.info("[FAV_SYNC] lock ocupado — skip")
            return 0
        hb = asyncio.create_task(self._heartbeat())
        try:
            async with async_session() as db:
                svc = GradeService(db)
                added = await svc.sync_all_active(username=None)
            logger.info(f"[FAV_SYNC] {added} jogos novos")
            return added
        except Exception as e:
            logger.error(f"[FAV_SYNC] erro: {e}")
            return 0
        finally:
            hb.cancel()
            try:
                await hb
            except asyncio.CancelledError:
                pass
            await self._release()

    async def _acquire(self) -> bool:
        return await self.cache.set(
            self.lock_key,
            {"acquired_at": datetime.now().isoformat()},
            ttl=self.LOCK_TIMEOUT,
            nx=True,
        )

    async def _release(self) -> None:
        try:
            await self.cache.delete(self.lock_key)
        except Exception:
            pass

    async def _heartbeat(self) -> None:
        try:
            while True:
                await asyncio.sleep(60)
                await self.cache.set(
                    self.lock_key,
                    {"renewed_at": datetime.now().isoformat()},
                    ttl=self.LOCK_TIMEOUT,
                    nx=False,
                )
        except asyncio.CancelledError:
            pass


_fav_sync: Optional[FavoritesSyncScheduler] = None


def get_favorites_sync() -> FavoritesSyncScheduler:
    global _fav_sync
    if _fav_sync is None:
        _fav_sync = FavoritesSyncScheduler()
    return _fav_sync


async def init_favorites_sync() -> FavoritesSyncScheduler:
    s = get_favorites_sync()
    if not s.is_running:
        await s.start()
    return s
