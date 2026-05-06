"""Singleton lazy do pool ARQ — usado pelo router pra enfileirar jobs no
worker (`precompute_worker` no compose).

API e worker compartilham o mesmo Redis (`REDIS_URL`). A API chama
``await pool.enqueue_job('process_precompute_task', payload)``; o worker
ARQ faz dequeue e executa.

Pool e criado no event loop da API no primeiro uso e reutilizado.
"""
from __future__ import annotations

from urllib.parse import urlparse

from arq import create_pool
from arq.connections import ArqRedis, RedisSettings

from config.settings import REDIS_URL

_pool: ArqRedis | None = None


def _redis_settings_from_url(url: str) -> RedisSettings:
    parsed = urlparse(url)
    host = parsed.hostname or "localhost"
    port = parsed.port or 6379
    database = (
        int(parsed.path.lstrip("/"))
        if parsed.path and parsed.path != "/"
        else 0
    )
    password = parsed.password
    return RedisSettings(host=host, port=port, database=database, password=password)


async def get_arq_pool() -> ArqRedis:
    global _pool
    if _pool is None:
        _pool = await create_pool(_redis_settings_from_url(REDIS_URL))
    return _pool


async def close_arq_pool() -> None:
    global _pool
    if _pool is not None:
        await _pool.aclose()
        _pool = None
