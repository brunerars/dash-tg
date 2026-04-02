from __future__ import annotations

import jwt
from jwt.exceptions import InvalidTokenError
from datetime import datetime, timedelta, timezone

from fastapi import Cookie, Header, HTTPException
from pwdlib import PasswordHash

from config.settings import JWT_SECRET, ALGORITHM, JWT_EXPIRE_MINUTES

password_hash = PasswordHash.recommended()


def verify_password(plain: str, hashed: str) -> bool:
    return password_hash.verify(plain, hashed)


def get_password_hash(password: str) -> str:
    return password_hash.hash(password)


def create_access_token(data: dict) -> str:
    to_encode = data.copy()
    expire = datetime.now(timezone.utc) + timedelta(minutes=JWT_EXPIRE_MINUTES)
    to_encode["exp"] = expire
    return jwt.encode(to_encode, JWT_SECRET, algorithm=ALGORITHM)


async def verify_jwt_cookie(
    access_token: str | None = Cookie(None),
    authorization: str | None = Header(None),
) -> str:
    """Dual-mode JWT verification: HttpOnly cookie (browser) or Bearer header (Swagger UI)."""
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
