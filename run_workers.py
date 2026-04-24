"""Entrypoint dos workers (container `workers`).

Roda em paralelo ao container `api`. Mantem scrapers + favorites sync vivos.
"""
from __future__ import annotations

import asyncio
import logging
import signal

from workers.favorites_sync import init_favorites_sync, get_favorites_sync
from workers.scraper_scheduler import get_scraper_scheduler, init_scraper_scheduler

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")


async def main() -> None:
    scraper = await init_scraper_scheduler()
    fav_sync = await init_favorites_sync()

    stop_event = asyncio.Event()

    def _stop(*_):
        stop_event.set()

    loop = asyncio.get_event_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        try:
            loop.add_signal_handler(sig, _stop)
        except NotImplementedError:
            # Windows: sinais nao suportados em add_signal_handler
            pass

    print("[WORKERS] Rodando. Ctrl+C para parar.")
    try:
        await stop_event.wait()
    finally:
        await scraper.stop()
        await fav_sync.stop()


if __name__ == "__main__":
    asyncio.run(main())
