from __future__ import annotations

from fastapi import APIRouter, HTTPException, Response
from pydantic import BaseModel

from middleware.auth import create_access_token, verify_password
from config.settings import (
    APP_USERNAME,
    APP_PASSWORD_HASH,
    JWT_EXPIRE_MINUTES,
    SECURE_COOKIES,
)

router = APIRouter(prefix="/auth", tags=["auth"])


class LoginRequest(BaseModel):
    username: str
    password: str


@router.post("/login")
def login(body: LoginRequest, response: Response) -> dict:
    if body.username != APP_USERNAME:
        # Always run verify to prevent timing side-channel
        verify_password(body.password, APP_PASSWORD_HASH)
        raise HTTPException(status_code=401, detail="Credenciais inválidas")
    if not verify_password(body.password, APP_PASSWORD_HASH):
        raise HTTPException(status_code=401, detail="Credenciais inválidas")
    token = create_access_token({"sub": body.username})
    response.set_cookie(
        key="access_token",
        value=token,
        httponly=True,
        secure=SECURE_COOKIES,
        samesite="lax",
        max_age=JWT_EXPIRE_MINUTES * 60,
    )
    return {"access_token": token, "token_type": "bearer"}


@router.post("/logout")
def logout(response: Response) -> dict:
    response.delete_cookie(
        key="access_token",
        httponly=True,
        samesite="lax",
    )
    return {"message": "Logout realizado com sucesso"}
