# Phase 2: JWT Authentication - Research

**Researched:** 2026-04-02
**Domain:** FastAPI JWT authentication with HttpOnly cookies, argon2 password hashing, CORS restriction
**Confidence:** HIGH

---

## Summary

This phase replaces the existing `X-API-Key` header authentication with a username + password login flow that issues a JWT stored in an HttpOnly cookie. The system has a single user (no multi-user, no self-registration). The entire auth surface is: one login endpoint, one logout endpoint, and a new dependency that replaces `verify_api_key` on all existing protected routes.

The current codebase is well-structured for this change: `middleware/auth.py` contains only the `verify_api_key` function and is imported in exactly one place (`routers/analysis.py` via `AuthDep`). Replacing auth is surgical — swap the dependency, add an auth router, update settings and CORS.

The FastAPI ecosystem has moved away from `passlib` (unmaintained) and `python-jose` (nearly abandoned) toward `pwdlib[argon2]` and `PyJWT` respectively. The official FastAPI docs were updated to reflect this. Both are the correct choices for this phase.

**Primary recommendation:** Add `PyJWT 2.x` + `pwdlib[argon2]` to requirements.txt. Replace `verify_api_key` dependency with `verify_jwt_cookie`. Create `routers/auth.py` with `/auth/login` and `/auth/logout`. Update CORS `allow_origins` from `["*"]` to the frontend domain with `allow_credentials=True`.

**AUTH-04 discrepancy:** `REQUIREMENTS.md` says "hash bcrypt" but `ROADMAP.md` success criteria says "argon2 hash". The official FastAPI docs now recommend argon2 via `pwdlib[argon2]`. Argon2 is the correct choice — it won the Password Hashing Competition, is recommended by IETF, and is more secure than bcrypt. The planner should clarify this with the user or default to argon2 (the ROADMAP is the more recent/authoritative document).

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| AUTH-01 | User can login with username + password via `POST /auth/login`, receive JWT in HttpOnly cookie and in JSON body | Login endpoint pattern with `Response` object + `set_cookie()` + JSON body |
| AUTH-02 | Protected endpoints reject requests without valid JWT with 401 | Replace `verify_api_key` with `verify_jwt_cookie` dependency using `Cookie(None)` extraction |
| AUTH-03 | User can logout via `POST /auth/logout`, session cookie cleared | `response.delete_cookie()` pattern, return 200 |
| AUTH-04 | Password stored as argon2 hash in env var — never plaintext | `pwdlib[argon2]` + `PasswordHash.recommended()` for hashing; env var `APP_PASSWORD_HASH` holds the hash |
| AUTH-05 | CORS `allow_origins` locked to frontend domain before cookie auth is active | `CORSMiddleware` with explicit origin list + `allow_credentials=True` |
</phase_requirements>

---

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| PyJWT | 2.12.1 | JWT encode/decode | Official FastAPI docs recommendation; replaces abandoned python-jose; actively maintained |
| pwdlib[argon2] | 0.2.x | Password hashing with Argon2id | Official FastAPI docs recommendation; replaces unmaintained passlib; wraps argon2-cffi |
| argon2-cffi | 25.1.0 | Argon2 hash implementation (dependency of pwdlib) | Won Password Hashing Competition; IETF recommended; installed transitively |

### Already in Stack (no new install needed)

| Library | Purpose | Note |
|---------|---------|------|
| fastapi | `Cookie()` parameter, `Response`, `JSONResponse` | Already present |
| pydantic | Request body models for login | Already present |
| python-dotenv | Loading `JWT_SECRET`, `APP_PASSWORD_HASH` env vars | Already present |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| pwdlib[argon2] | argon2-cffi directly | pwdlib is a thin ergonomic wrapper; either works; pwdlib is what official FastAPI docs show |
| pwdlib[argon2] | passlib[bcrypt] | passlib unmaintained, broken on Python 3.13+; do not use |
| PyJWT | python-jose | python-jose nearly abandoned (last release ~3 years ago); PyJWT is the official FastAPI recommendation |
| HS256 (HMAC) | RS256 (RSA) | RS256 needed for distributed verification; single-service API, HS256 is correct and simpler |

**Installation:**
```bash
pip install pyjwt "pwdlib[argon2]"
```

---

## Architecture Patterns

### Recommended Project Structure Changes

```
dash-tg/
├── routers/
│   ├── analysis.py        # existing — swap AuthDep only
│   └── auth.py            # NEW — /auth/login, /auth/logout
├── middleware/
│   └── auth.py            # REPLACE verify_api_key with verify_jwt_cookie
├── config/
│   └── settings.py        # ADD: JWT_SECRET, APP_USERNAME, APP_PASSWORD_HASH, JWT_EXPIRE_MINUTES
└── main.py                # CHANGE: CORS origins, include auth router
```

### Pattern 1: Login Endpoint (sets HttpOnly cookie + returns token in body)

The login endpoint must do two things simultaneously: set the JWT as an HttpOnly cookie (for browser-based frontend) AND return it in the JSON body (for Swagger UI's "Authorize" button to work).

```python
# routers/auth.py
from fastapi import APIRouter, HTTPException, Response
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from middleware.auth import create_access_token, verify_password
from config.settings import APP_USERNAME, APP_PASSWORD_HASH

router = APIRouter(prefix="/auth", tags=["auth"])

class LoginRequest(BaseModel):
    username: str
    password: str

@router.post("/login")
def login(body: LoginRequest, response: Response) -> dict:
    if body.username != APP_USERNAME:
        # Always run verify to prevent timing attacks
        verify_password(body.password, APP_PASSWORD_HASH)
        raise HTTPException(status_code=401, detail="Credenciais inválidas")
    if not verify_password(body.password, APP_PASSWORD_HASH):
        raise HTTPException(status_code=401, detail="Credenciais inválidas")
    token = create_access_token({"sub": body.username})
    response.set_cookie(
        key="access_token",
        value=token,
        httponly=True,
        secure=True,         # HTTPS only — must be False in local dev without TLS
        samesite="lax",
        max_age=JWT_EXPIRE_SECONDS,
    )
    return {"access_token": token, "token_type": "bearer"}
```

**Critical:** `secure=True` requires HTTPS. On the VPS behind Traefik this is always TLS. For local Docker testing without TLS, set `secure=False` via an env var.

### Pattern 2: JWT Cookie Dependency (replaces verify_api_key)

```python
# middleware/auth.py — replaces existing file
from __future__ import annotations
import jwt
from jwt.exceptions import InvalidTokenError
from fastapi import Cookie, HTTPException
from pwdlib import PasswordHash
from config.settings import JWT_SECRET, ALGORITHM

password_hash = PasswordHash.recommended()

def verify_password(plain: str, hashed: str) -> bool:
    return password_hash.verify(plain, hashed)

def get_password_hash(password: str) -> str:
    return password_hash.hash(password)

def create_access_token(data: dict) -> str:
    from datetime import datetime, timedelta, timezone
    from config.settings import JWT_EXPIRE_MINUTES
    to_encode = data.copy()
    expire = datetime.now(timezone.utc) + timedelta(minutes=JWT_EXPIRE_MINUTES)
    to_encode["exp"] = expire
    return jwt.encode(to_encode, JWT_SECRET, algorithm=ALGORITHM)

async def verify_jwt_cookie(access_token: str | None = Cookie(None)) -> str:
    if access_token is None:
        raise HTTPException(status_code=401, detail="Não autenticado")
    try:
        payload = jwt.decode(access_token, JWT_SECRET, algorithms=[ALGORITHM])
        username: str | None = payload.get("sub")
        if username is None:
            raise HTTPException(status_code=401, detail="Token inválido")
        return username
    except InvalidTokenError:
        raise HTTPException(status_code=401, detail="Token inválido ou expirado")
```

### Pattern 3: Logout Endpoint

```python
@router.post("/logout")
def logout(response: Response) -> dict:
    response.delete_cookie(key="access_token", httponly=True, samesite="lax")
    return {"message": "Logout realizado com sucesso"}
```

### Pattern 4: Swap the dependency in analysis.py

```python
# routers/analysis.py — one-line change
from middleware.auth import verify_jwt_cookie   # was: verify_api_key

AuthDep = Annotated[str, Depends(verify_jwt_cookie)]  # was: verify_api_key
```

### Pattern 5: CORS update (AUTH-05)

```python
# main.py
app.add_middleware(
    CORSMiddleware,
    allow_origins=["https://seu-frontend.com.br"],  # locked to frontend domain
    allow_methods=["*"],
    allow_headers=["*"],
    allow_credentials=True,   # REQUIRED for cookies to be sent cross-origin
)
```

**Critical:** When `allow_credentials=True`, `allow_origins` CANNOT be `["*"]`. Browsers reject this combination. The frontend domain MUST be explicitly listed.

### Pattern 6: New env vars in settings.py

```python
# config/settings.py additions
import secrets

JWT_SECRET: str = os.getenv("JWT_SECRET", "")  # must be set in Portainer, never default
ALGORITHM: str = "HS256"
JWT_EXPIRE_MINUTES: int = int(os.getenv("JWT_EXPIRE_MINUTES", "720"))  # 12h default
APP_USERNAME: str = os.getenv("APP_USERNAME", "admin")
APP_PASSWORD_HASH: str = os.getenv("APP_PASSWORD_HASH", "")  # argon2 hash, set via CLI
FRONTEND_ORIGIN: str = os.getenv("FRONTEND_ORIGIN", "http://localhost:3000")
```

### Anti-Patterns to Avoid

- **Storing JWT in localStorage:** Vulnerable to XSS. Use HttpOnly cookie only.
- **allow_origins=["*"] with allow_credentials=True:** Browsers reject this; it's also a security hole.
- **Storing plaintext password in env var:** Must store the argon2 hash. Operator runs `python -c "from pwdlib import PasswordHash; print(PasswordHash.recommended().hash('mypassword'))"` once to generate the hash and stores that in Portainer.
- **Using passlib:** Unmaintained, broken on Python 3.13+. Use pwdlib.
- **Using python-jose:** Nearly abandoned. Use PyJWT.
- **Short `secure=True` in local dev:** Will silently fail over HTTP. Use an env flag `SECURE_COOKIES=true/false`.
- **Not running verify_password on wrong username:** Creates a timing side-channel that reveals valid usernames.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| JWT encode/decode | Custom base64 + signature | PyJWT | Handles exp, iat, nbf claims, algorithm negotiation, and signature verification correctly |
| Password hashing | SHA256/MD5 or custom salting | pwdlib[argon2] | Argon2 has configurable memory-hardness; custom solutions miss salt generation and timing-safe comparison |
| Timing-safe comparison | `password == stored` | `password_hash.verify()` | `pwdlib.verify()` is constant-time; direct string comparison leaks password length via timing |
| Cookie deletion | Setting value to empty string | `response.delete_cookie()` | Proper invalidation sets `Expires` to epoch; empty value still leaves cookie present |

---

## Common Pitfalls

### Pitfall 1: CORS Wildcard with allow_credentials
**What goes wrong:** Existing `main.py` has `allow_origins=["*"]`. When `allow_credentials=True` is added (required for cookies), browsers enforce that `allow_origins` cannot be wildcard — requests fail with CORS error.
**Why it happens:** The W3C CORS spec prohibits the combination `Access-Control-Allow-Origin: *` with `Access-Control-Allow-Credentials: true`.
**How to avoid:** Set `allow_origins=[FRONTEND_ORIGIN]` as an explicit list before enabling cookie auth. AUTH-05 must be done as the first step of this phase.
**Warning signs:** Browser console shows "CORS error: credentials flag is 'true' but Access-Control-Allow-Origin is '*'".

### Pitfall 2: HttpOnly Cookie not Sent by Swagger UI
**What goes wrong:** Swagger UI cannot read the HttpOnly cookie set by `/auth/login`, so testing protected endpoints via `/docs` fails.
**Why it happens:** HttpOnly cookies are inaccessible to JavaScript — including Swagger's fetch calls.
**How to avoid:** The login endpoint ALSO returns the token in the JSON body. Swagger can be configured to send it as a Bearer token via the "Authorize" button. The dependency `verify_jwt_cookie` can be extended to check both the cookie and the `Authorization: Bearer` header for Swagger compatibility.
**Warning signs:** Login works but all subsequent Swagger calls return 401.

### Pitfall 3: secure=True Breaks Local Dev
**What goes wrong:** `set_cookie(secure=True)` means the cookie is only sent over HTTPS. Local Docker without TLS will never receive the cookie.
**Why it happens:** `secure=True` is correct for production behind Traefik; it's wrong for local testing.
**How to avoid:** Gate on env var: `secure = os.getenv("SECURE_COOKIES", "true").lower() == "true"`.
**Warning signs:** Login returns 200 with Set-Cookie header but next request returns 401 (cookie not sent).

### Pitfall 4: JWT_SECRET with no Default
**What goes wrong:** If `JWT_SECRET` has a hardcoded default (empty string or known value), every deployment with an unset env var is vulnerable.
**Why it happens:** Developers set defaults for convenience.
**How to avoid:** At startup, validate that `JWT_SECRET` is set and has sufficient length (>= 32 bytes). Raise startup error if not.
**Warning signs:** API starts without error despite no `JWT_SECRET` in Portainer.

### Pitfall 5: Generating the argon2 hash requires a utility
**What goes wrong:** The operator needs to hash the password before storing it in Portainer. If there's no documented CLI command, they may store plaintext.
**Why it happens:** Unlike bcrypt, there's no standard `htpasswd`-style tool pre-installed.
**How to avoid:** Document the one-liner: `python -c "from pwdlib import PasswordHash; print(PasswordHash.recommended().hash('YOURPASSWORD'))"`. Include this in the plan as an explicit task — not just documentation.
**Warning signs:** `APP_PASSWORD_HASH` value in Portainer starts with the literal password instead of `$argon2id$`.

---

## Code Examples

### Generate JWT Secret (shell command for operator)
```bash
# Source: openssl standard
openssl rand -hex 32
```

### Generate argon2 hash for password (one-time setup)
```python
# Source: argon2-cffi docs + pwdlib docs
from pwdlib import PasswordHash
ph = PasswordHash.recommended()
print(ph.hash("your_plaintext_password"))
# Output example: $argon2id$v=19$m=65536,t=3,p=4$...
```

### FastAPI Cookie dependency — dual-mode (cookie + Bearer for Swagger)
```python
# Source: FastAPI Cookie Parameters + community pattern
from fastapi import Cookie, Header
from typing import Annotated

async def verify_jwt_cookie(
    access_token: str | None = Cookie(None),
    authorization: str | None = Header(None),
) -> str:
    token = access_token
    if token is None and authorization and authorization.startswith("Bearer "):
        token = authorization.removeprefix("Bearer ")
    if token is None:
        raise HTTPException(status_code=401, detail="Não autenticado")
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[ALGORITHM])
        username: str | None = payload.get("sub")
        if username is None:
            raise HTTPException(status_code=401, detail="Token inválido")
        return username
    except InvalidTokenError:
        raise HTTPException(status_code=401, detail="Token inválido ou expirado")
```

This dual-mode dependency handles both cookie (browser/frontend) and Bearer header (Swagger UI) transparently.

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| passlib[bcrypt] | pwdlib[argon2] | 2023-2024 | passlib unmaintained; pwdlib is official FastAPI docs replacement |
| python-jose | PyJWT | 2024-2025 | python-jose nearly abandoned; FastAPI docs updated |
| `allow_origins=["*"]` | explicit origin list | Any time using cookies | Browser CORS spec requires explicit origins when credentials are sent |

**Deprecated/outdated:**
- `passlib`: Last meaningful release 2022; broken with Python 3.13+. Do not use.
- `python-jose`: Last release ~3 years ago; security posture declining. Do not use.
- `fastapi-jwt-auth`: Third-party package, not needed — standard FastAPI + PyJWT is sufficient.

---

## Open Questions

1. **Frontend domain for AUTH-05**
   - What we know: CORS must be locked to the frontend domain before cookie auth is active (AUTH-05)
   - What's unclear: The exact domain is unknown — STATE.md explicitly notes "Phase 2 requires the actual frontend domain confirmed before CORS lockdown"
   - Recommendation: Planner should add a task that sets `FRONTEND_ORIGIN` as an env var in Portainer. The code reads from env; the operator fills it in. Default to a placeholder that fails loudly if unset.

2. **AUTH-04 bcrypt vs argon2 discrepancy**
   - What we know: REQUIREMENTS.md says "bcrypt", ROADMAP success criteria says "argon2"
   - What's unclear: Which is authoritative? The user may not care about the distinction.
   - Recommendation: Use argon2 (it's what the ROADMAP specifies and what official FastAPI docs now recommend). Note the discrepancy in the plan so the user can confirm.

3. **Swagger UI authentication after cookie migration**
   - What we know: Swagger cannot use HttpOnly cookies directly
   - What's unclear: Whether the user wants Swagger to remain functional
   - Recommendation: Implement dual-mode dependency (cookie + Bearer header) so both browser and Swagger work. This is low-cost and avoids breaking the developer workflow.

4. **Token expiration and "remember me"**
   - What we know: REQUIREMENTS.md explicitly lists "Refresh tokens" as Out of Scope
   - What's unclear: What JWT TTL the user wants (e.g., 12h, 24h, 7 days)
   - Recommendation: Default to 720 minutes (12h) via `JWT_EXPIRE_MINUTES` env var. Operator can adjust in Portainer without redeployment.

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Docker | Container deployment | Yes | 29.2.1 | — |
| Redis | Existing cache layer | Already in stack | Redis 7 | — |
| PyJWT | JWT operations | Not installed (new dep) | 2.12.1 on PyPI | — |
| pwdlib[argon2] | Password hashing | Not installed (new dep) | 0.2.x on PyPI | — |
| HTTPS/TLS | `secure=True` cookies | Yes (Traefik on VPS) | — | local dev: SECURE_COOKIES=false |

**Missing dependencies with no fallback:**
- None — all new dependencies are pip-installable and have no external service requirements.

**Missing dependencies with fallback:**
- `HTTPS for secure cookies`: Local development requires `SECURE_COOKIES=false` env flag since cookies with `secure=True` are not sent over HTTP.

---

## Project Constraints (from CLAUDE.md)

These directives from `CLAUDE.md` apply to this phase:

| Directive | Impact on Phase 2 |
|-----------|-------------------|
| Stack: FastAPI + Redis, no additional database | JWT stored in HttpOnly cookie (browser); no server-side session storage needed — stateless JWT fits perfectly |
| Deploy: Docker Compose on VPS, infra unchanged | Only requirements.txt and env vars change; no new containers |
| Compatibility: retrocompatible or coordinated | Cookie auth replaces header auth — NOT retrocompatible. Must coordinate frontend switchover. Old `X-API-Key` header will stop working after this deploy. |
| `middleware/auth.py` is the auth boundary | Replace content of this file; do not scatter auth logic |
| `config/strategies.py` is single source of truth | Unrelated to this phase — do not touch |
| Services receive config as parameters | New `JWT_SECRET`, `APP_PASSWORD_HASH`, etc. go in `config/settings.py` only |
| Error handling: 401 for auth failures | Match existing pattern: `HTTPException(status_code=401, detail="...")` |
| Env vars defined in Portainer, never in GitHub Actions | `JWT_SECRET`, `APP_USERNAME`, `APP_PASSWORD_HASH`, `FRONTEND_ORIGIN`, `JWT_EXPIRE_MINUTES` all set in Portainer |
| Cloudflare: DNS-only, never proxied | No impact on cookie auth — HTTPS is terminated at Traefik, not Cloudflare |

**Breaking change note:** The existing `X-API-Key` header auth will be removed. Any client currently using the API Key must migrate to cookie-based auth. This requires coordination with the frontend before deployment.

---

## Sources

### Primary (HIGH confidence)
- [FastAPI official docs — OAuth2 JWT](https://fastapi.tiangolo.com/tutorial/security/oauth2-jwt/) — confirmed: PyJWT + pwdlib[argon2] are now the official recommendation
- [FastAPI official docs — CORS](https://fastapi.tiangolo.com/tutorial/cors/) — confirmed: `allow_credentials=True` requires explicit `allow_origins`
- [FastAPI official docs — Response Cookies](https://fastapi.tiangolo.com/advanced/response-cookies/) — confirmed: `set_cookie()` and `delete_cookie()` API
- [argon2-cffi 25.1.0 docs](https://argon2-cffi.readthedocs.io/) — confirmed: version 25.1.0, argon2id default

### Secondary (MEDIUM confidence)
- [FastAPI GitHub Discussion #11345](https://github.com/fastapi/fastapi/discussions/11345) — confirmed python-jose abandonment; community consensus on PyJWT
- [FastAPI GitHub Discussion #9587](https://github.com/fastapi/fastapi/discussions/9587) — confirmed passlib abandonment and pwdlib as replacement
- [PyJWT 2.12.1 changelog](https://pyjwt.readthedocs.io/en/stable/changelog.html) — confirmed version 2.12.1 released March 2026
- [retz.dev — JWT and Cookie Auth in FastAPI](https://retz.dev/blog/jwt-and-cookie-auth-in-fastapi/) — verified pattern for dual-mode cookie + Bearer dependency

### Tertiary (LOW confidence)
- None — all critical claims verified against official sources

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — verified against official FastAPI docs and PyPI
- Architecture: HIGH — verified patterns from official FastAPI docs + Starlette cookie API
- Pitfalls: HIGH — CORS pitfall confirmed by W3C spec; others confirmed by FastAPI community discussions

**Research date:** 2026-04-02
**Valid until:** 2026-07-02 (90 days — stable libraries, CORS spec does not change)
