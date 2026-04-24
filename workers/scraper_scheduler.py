"""Scheduler de scrapers (portado de v3/backend/workers/scraper_scheduler.py).

Responsavel por popular o cache Redis com:
- scraper:<liga>:data        (TTL 2h)
- scraper:<liga>:last_good:data (TTL 24h — fallback)
- scraper:all_matches:data   (TTL 2h)
- scraper:last_update        (TTL 2h)

Lock distribuido via SETNX + heartbeat. Refresh inicial em background.
"""
from __future__ import annotations

import asyncio
import logging
import os
from concurrent.futures import ProcessPoolExecutor
from datetime import datetime, timezone
from typing import Dict, List, Optional

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.interval import IntervalTrigger
from zoneinfo import ZoneInfo

from config.settings import (
    SCRAPER_REFRESH_MIN,
    SCRAPER_SCHEDULER_LOCK_KEY,
)
from grade.async_cache import AsyncCache

logger = logging.getLogger(__name__)

TZ_BR = ZoneInfo("America/Sao_Paulo")


def _parse_match_datetime(data_str: str | None, horario_str: str | None) -> datetime | None:
    if not data_str or not horario_str:
        return None
    data_str = str(data_str).strip()
    horario_str = str(horario_str).strip()
    try:
        hh, mm = [int(x) for x in horario_str.split(":")]
    except Exception:
        return None
    try:
        if "/" in data_str:
            parts = data_str.split("/")
            if len(parts) != 3:
                return None
            dd, mo, yy_raw = int(parts[0]), int(parts[1]), parts[2]
            yy = int(yy_raw)
            if len(yy_raw) == 2:
                yy = 2000 + yy
            return datetime(yy, mo, dd, hh, mm, tzinfo=TZ_BR)
        if "-" in data_str:
            parts = data_str.split("-")
            if len(parts) != 3:
                return None
            return datetime(int(parts[0]), int(parts[1]), int(parts[2]), hh, mm, tzinfo=TZ_BR)
    except Exception:
        return None
    return None


def _format_game_label(dt: datetime) -> str:
    return dt.astimezone(TZ_BR).strftime("%d/%m/%Y %H:%M")


# ---- Wrappers top-level para ProcessPoolExecutor (precisam ser pickleable) ----

def _run_adriatic_scraper() -> List[Dict]:
    from scrapers.adriatic_league import scrape_adriatic_league
    return scrape_adriatic_league()


def _run_gt_scraper() -> List[Dict]:
    from scrapers.gt_league import scrape_gt_league
    return scrape_gt_league()


def _run_ebattle_scraper() -> List[Dict]:
    from scrapers.ebattle_league import scrape_ebattle_league
    return scrape_ebattle_league(range_size=200)


class ScraperScheduler:
    CACHE_TTL = 7200
    LAST_GOOD_TTL = 24 * 3600
    LOCK_TIMEOUT = 180

    def __init__(self, cache: Optional[AsyncCache] = None) -> None:
        self.cache = cache or AsyncCache()
        self.scheduler = AsyncIOScheduler()
        self.is_running = False
        self.refresh_interval = SCRAPER_REFRESH_MIN
        self.lock_key = SCRAPER_SCHEDULER_LOCK_KEY

    async def start(self) -> None:
        if self.is_running:
            return
        print("[SCRAPER_SCHED] iniciando (refresh em bg)")
        asyncio.create_task(self._initial_refresh())
        self.scheduler.add_job(
            self.refresh_all_scrapers,
            trigger=IntervalTrigger(minutes=self.refresh_interval),
            id="scraper_refresh",
            replace_existing=True,
        )
        self.scheduler.start()
        self.is_running = True
        print(f"[SCRAPER_SCHED] ativo — refresh cada {self.refresh_interval} min")

    async def _initial_refresh(self) -> None:
        try:
            await self.refresh_all_scrapers()
        except Exception as e:
            print(f"[SCRAPER_SCHED] erro refresh inicial: {e}")

    async def stop(self) -> None:
        if self.is_running:
            self.scheduler.shutdown(wait=False)
            await self.cache.close()
            self.is_running = False
            print("[SCRAPER_SCHED] parado")

    async def refresh_all_scrapers(self) -> bool:
        if not await self._try_acquire_lock():
            logger.warning("[SCRAPER_SCHED] lock ocupado — skip")
            return False
        try:
            await self._execute_refresh()
            return True
        except Exception as e:
            logger.error(f"[SCRAPER_SCHED] erro: {e}")
            return False
        finally:
            await self._release_lock()

    async def _try_acquire_lock(self) -> bool:
        try:
            return await self.cache.set(
                self.lock_key,
                {"holder": "scheduler", "acquired_at": datetime.now().isoformat()},
                ttl=self.LOCK_TIMEOUT,
                nx=True,
            )
        except Exception as e:
            logger.warning(f"[SCRAPER_SCHED] acquire lock falhou: {e}")
            return False

    async def _release_lock(self) -> None:
        try:
            await self.cache.delete(self.lock_key)
        except Exception:
            pass

    async def _heartbeat_lock(self) -> None:
        try:
            while True:
                await asyncio.sleep(60)
                await self.cache.set(
                    self.lock_key,
                    {"holder": "scheduler", "renewed_at": datetime.now().isoformat()},
                    ttl=self.LOCK_TIMEOUT,
                    nx=False,
                )
        except asyncio.CancelledError:
            pass

    async def _execute_refresh(self) -> None:
        logger.info(f"[SCRAPER_SCHED] refresh start {datetime.now().strftime('%H:%M:%S')}")
        start = datetime.now()
        heartbeat_task = asyncio.create_task(self._heartbeat_lock())
        try:
            loop = asyncio.get_event_loop()
            cpu_cap = os.cpu_count() or 1
            env_cap_raw = os.getenv("SCRAPER_MAX_WORKERS")
            try:
                env_cap = int(env_cap_raw) if env_cap_raw else 3
            except ValueError:
                env_cap = 3
            max_workers = max(1, min(3, env_cap, cpu_cap))

            with ProcessPoolExecutor(max_workers=max_workers) as executor:
                results = await asyncio.gather(
                    loop.run_in_executor(executor, _run_adriatic_scraper),
                    loop.run_in_executor(executor, _run_gt_scraper),
                    loop.run_in_executor(executor, _run_ebattle_scraper),
                    return_exceptions=True,
                )

            all_matches: List[Dict] = []
            league_names = ["adriatic", "gtleague", "ebattle"]
            stats: Dict[str, Dict] = {}
            now_br = datetime.now(TZ_BR)

            for result, liga in zip(results, league_names):
                last_good_key = f"scraper:{liga}:last_good:data"
                error_msg: str | None = None

                if isinstance(result, Exception):
                    exc = result
                    logger.warning(f"[SCRAPER_SCHED] {liga} erro: {exc}")
                    prev_good = await self.cache.get(last_good_key) or []
                    if isinstance(prev_good, list) and prev_good:
                        result = prev_good
                        error_msg = f"Falha: {type(exc).__name__}"
                    else:
                        stats[liga] = {
                            "error": str(exc),
                            "count": 0, "remaining": 0,
                            "first_game": None, "last_game": None,
                        }
                        continue
                elif len(result) == 0:
                    prev_good = await self.cache.get(last_good_key) or []
                    if isinstance(prev_good, list) and prev_good:
                        result = prev_good
                        error_msg = "Refresh retornou 0; usando last_good"
                    else:
                        stats[liga] = {
                            "error": "Nenhum jogo.",
                            "count": 0, "remaining": 0,
                            "first_game": None, "last_game": None,
                        }
                        continue
                else:
                    await self.cache.set(last_good_key, result, ttl=self.LAST_GOOD_TTL)

                for m in result:
                    m["liga"] = liga
                all_matches.extend(result)
                await self.cache.set(f"scraper:{liga}:data", result, ttl=self.CACHE_TTL)

                dts: list[datetime] = []
                for m in result:
                    dt = _parse_match_datetime(m.get("data"), m.get("horario"))
                    if dt is not None:
                        dts.append(dt)
                dts.sort()
                stats[liga] = {
                    "count": len(result),
                    "remaining": sum(1 for dt in dts if dt >= now_br) if dts else 0,
                    "first_game": _format_game_label(dts[0]) if dts else None,
                    "last_game": _format_game_label(dts[-1]) if dts else None,
                }
                if error_msg:
                    stats[liga]["error"] = error_msg

            await self.cache.set("scraper:all_matches:data", all_matches, ttl=self.CACHE_TTL)
            await self.cache.set(
                "scraper:last_update",
                {
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                    "total_matches": len(all_matches),
                    "by_league": stats,
                },
                ttl=self.CACHE_TTL,
            )
            elapsed = (datetime.now() - start).total_seconds()
            logger.info(f"[SCRAPER_SCHED] refresh OK {len(all_matches)} em {elapsed:.1f}s")
        finally:
            heartbeat_task.cancel()
            try:
                await heartbeat_task
            except asyncio.CancelledError:
                pass


_scheduler: Optional[ScraperScheduler] = None


def get_scraper_scheduler() -> ScraperScheduler:
    global _scheduler
    if _scheduler is None:
        _scheduler = ScraperScheduler()
    return _scheduler


async def init_scraper_scheduler() -> ScraperScheduler:
    s = get_scraper_scheduler()
    if not s.is_running:
        await s.start()
    return s
