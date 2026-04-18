import os
from dotenv import load_dotenv

load_dotenv()

API_KEYS: set[str] = set(
    k.strip() for k in os.getenv("API_KEYS", "").split(",") if k.strip()
)

REDIS_URL: str = os.getenv("REDIS_URL", "redis://localhost:6379")

CACHE_TTL_ANALYSIS: int = int(os.getenv("CACHE_TTL_ANALYSIS", "86400"))
CACHE_TTL_EXPORT: int = int(os.getenv("CACHE_TTL_EXPORT", "3600"))
CACHE_TTL_JOB: int = int(os.getenv("CACHE_TTL_JOB", "7200"))

DATA_DIR: str = os.getenv("DATA_DIR", "/app/data")

PRECOMPUTE_WORKERS: int = int(os.getenv("PRECOMPUTE_WORKERS", "2"))

# --- JWT Auth (Phase 2) ---
JWT_SECRET: str = os.getenv("JWT_SECRET", "")
ALGORITHM: str = "HS256"
JWT_EXPIRE_MINUTES: int = int(os.getenv("JWT_EXPIRE_MINUTES", "720"))
APP_USERNAME: str = os.getenv("APP_USERNAME", "admin")
APP_PASSWORD_HASH: str = os.getenv("APP_PASSWORD_HASH", "")
FRONTEND_ORIGIN: str = os.getenv("FRONTEND_ORIGIN", "http://localhost:3000")
SECURE_COOKIES: bool = os.getenv("SECURE_COOKIES", "true").lower() == "true"

# Startup validation — fail fast if JWT_SECRET is missing or too short
if not JWT_SECRET or len(JWT_SECRET) < 32:
    import sys
    print("FATAL: JWT_SECRET must be set and >= 32 characters. Generate with: openssl rand -hex 32", file=sys.stderr)
    sys.exit(1)
