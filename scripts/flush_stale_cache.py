#!/usr/bin/env python3
"""
flush_stale_cache.py — Delete all analysis:, export:, and blueprint: Redis keys.

Run once at deploy before the API starts to prevent stale filtered results
from being served as cache hits after the FILT-01/FILT-02 filter removal.

filedf: keys (per-file parsed DataFrames) are intentionally preserved — they
contain raw data, not filtered results, so they remain valid.
"""
from __future__ import annotations

import os
import sys

import redis


PREFIXES = ("analysis:", "export:", "blueprint:")


def main() -> None:
    redis_url = os.environ.get("REDIS_URL", "redis://localhost:6379")
    r = redis.from_url(redis_url, decode_responses=False)

    try:
        r.ping()
    except redis.ConnectionError as exc:
        print(f"[flush] ERROR: cannot reach Redis at {redis_url}: {exc}", file=sys.stderr)
        sys.exit(1)

    total_deleted = 0
    for prefix in PREFIXES:
        cursor = 0
        while True:
            cursor, keys = r.scan(cursor, match=f"{prefix}*", count=500)
            if keys:
                deleted = r.delete(*keys)
                total_deleted += deleted
                print(f"[flush] deleted {deleted} keys with prefix '{prefix}'")
            if cursor == 0:
                break

    print(f"[flush] done — {total_deleted} keys removed.")


if __name__ == "__main__":
    main()
