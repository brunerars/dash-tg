import logging

logging.basicConfig(level=logging.INFO)

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPBearer

from config.settings import FRONTEND_ORIGIN
from routers.analysis import router as analysis_router
from routers.auth import router as auth_router
from routers.precompute import router as precompute_router

bearer_scheme = HTTPBearer(auto_error=False)

app = FastAPI(
    title="dash-tg API",
    description="Dashboard eSoccer — Análise de duplas multi-estratégia",
    version="2.0.0",
    swagger_ui_parameters={"persistAuthorization": True},
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[FRONTEND_ORIGIN],
    allow_methods=["*"],
    allow_headers=["*"],
    allow_credentials=True,
)

app.include_router(auth_router)
app.include_router(analysis_router, tags=["analysis"])
app.include_router(precompute_router, tags=["pre-computation"])


@app.get("/health", tags=["infra"])
def health() -> dict:
    return {"status": "ok"}
