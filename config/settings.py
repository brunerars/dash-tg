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

# Multi-user auth
# Default users are hashed at startup. To change passwords in production:
#   docker exec <container> python -c "from pwdlib import PasswordHash; print(PasswordHash.recommended().hash('NOVA_SENHA'))"
# Then set APP_USERS env var: "user1:hash|||user2:hash" to override defaults.
from pwdlib import PasswordHash as _PH

_DEFAULT_USERS: dict[str, str] = {
    "admin": "Adm!n@TG2026#",
    "thiago": "Th!@g0_TG#2026",
}

APP_USERS: dict[str, str] = {}
_raw_users = os.getenv("APP_USERS", "")
if _raw_users:
    for entry in _raw_users.split("|||"):
        entry = entry.strip()
        if ":" in entry:
            uname, uhash = entry.split(":", 1)
            APP_USERS[uname.strip()] = uhash.strip()
else:
    _hasher = _PH.recommended()
    for _u, _p in _DEFAULT_USERS.items():
        APP_USERS[_u] = _hasher.hash(_p)
FRONTEND_ORIGIN: str = os.getenv("FRONTEND_ORIGIN", "http://localhost:3000")
SECURE_COOKIES: bool = os.getenv("SECURE_COOKIES", "true").lower() == "true"

# Startup validation — fail fast if JWT_SECRET is missing or too short
if not JWT_SECRET or len(JWT_SECRET) < 32:
    import sys
    print("FATAL: JWT_SECRET must be set and >= 32 characters. Generate with: openssl rand -hex 32", file=sys.stderr)
    sys.exit(1)
