"""Async Redis cache para o subsistema de grade.

Isolado do `esoccer_dashboard/services/cache.py` (que e sincrono e focado
nas analises de planilha). Aqui serve scrapers + locks distribuidos.
"""
from __future__ import annotations

import json
from typing import Any, Optional

import redis.asyncio as redis

from config.settings import REDIS_URL

_pool: Optional[redis.ConnectionPool] = None


def get_redis_pool() -> redis.ConnectionPool:
    global _pool
    if _pool is None:
        _pool = redis.ConnectionPool.from_url(
            REDIS_URL,
            encoding="utf-8",
            decode_responses=True,
            max_connections=50,
        )
    return _pool


class AsyncCache:
    def __init__(self) -> None:
        self._client: Optional[redis.Redis] = None

    async def _c(self) -> redis.Redis:
        if self._client is None:
            self._client = redis.Redis(connection_pool=get_redis_pool())
        return self._client

    async def get(self, key: str) -> Optional[Any]:
        try:
            raw = await (await self._c()).get(key)
            return json.loads(raw) if raw else None
        except Exception as e:
            print(f"[async_cache.get] {key} erro: {e}")
            return None

    async def set(self, key: str, value: Any, ttl: int = 3600, nx: bool = False) -> bool:
        try:
            payload = json.dumps(value)
            c = await self._c()
            if nx:
                res = await c.set(key, payload, ex=ttl, nx=True)
                return res is True
            await c.setex(key, ttl, payload)
            return True
        except Exception as e:
            print(f"[async_cache.set] {key} erro: {e}")
            return False

    async def delete(self, key: str) -> bool:
        try:
            await (await self._c()).delete(key)
            return True
        except Exception as e:
            print(f"[async_cache.delete] {key} erro: {e}")
            return False

    async def close(self) -> None:
        if self._client:
            await self._client.close()
