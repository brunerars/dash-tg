"""Leitor read-only do cache Redis populado pelo ScraperScheduler.

Portado de `v3/backend/services/scrapers_service.py` (fatia minima).
"""
from __future__ import annotations

from typing import Dict, List, Optional

from grade.async_cache import AsyncCache


class ScrapersCache:
    def __init__(self, cache: Optional[AsyncCache] = None) -> None:
        self.cache = cache or AsyncCache()

    async def get_all_matches(self) -> List[Dict]:
        data = await self.cache.get("scraper:all_matches:data")
        return data if isinstance(data, list) else []

    async def get_matches_by_league(self, liga: str) -> List[Dict]:
        if liga not in ("adriatic", "gtleague", "ebattle"):
            return []
        data = await self.cache.get(f"scraper:{liga}:data")
        return data if isinstance(data, list) else []

    async def get_last_update(self) -> Optional[Dict]:
        return await self.cache.get("scraper:last_update")


_scrapers_cache: Optional[ScrapersCache] = None


def get_scrapers_cache() -> ScrapersCache:
    global _scrapers_cache
    if _scrapers_cache is None:
        _scrapers_cache = ScrapersCache()
    return _scrapers_cache
