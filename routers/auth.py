from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel

from middleware.auth import create_access_token, verify_jwt_cookie, verify_password
from config.settings import (
    APP_USERS,
    JWT_EXPIRE_MINUTES,
    SECURE_COOKIES,
)

AuthDep = Annotated[str, Depends(verify_jwt_cookie)]

router = APIRouter(prefix="/auth", tags=["auth"])


class LoginRequest(BaseModel):
    username: str
    password: str


@router.post("/login")
def login(body: LoginRequest, response: Response) -> dict:
    stored_hash = APP_USERS.get(body.username)
    if stored_hash is None:
        # Run verify against a dummy hash to prevent timing side-channel
        dummy = list(APP_USERS.values())[0] if APP_USERS else "$argon2id$v=19$m=65536,t=3,p=4$x$x"
        verify_password(body.password, dummy)
        raise HTTPException(status_code=401, detail="Credenciais inválidas")
    if not verify_password(body.password, stored_hash):
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


@router.get("/me")
def me(username: AuthDep) -> dict:
    return {"username": username}


@router.post("/logout")
def logout(response: Response) -> dict:
    response.delete_cookie(
        key="access_token",
        httponly=True,
        samesite="lax",
    )
    return {"message": "Logout realizado com sucesso"}
