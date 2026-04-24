from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPBearer

from config.settings import FRONTEND_ORIGIN
from database import create_tables
from routers.analysis import router as analysis_router
from routers.auth import router as auth_router
from routers.grade import router as grade_router
from routers.precompute import router as precompute_router

bearer_scheme = HTTPBearer(auto_error=False)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Cria tabelas do subsistema de grade (idempotente — SQLAlchemy checa antes de criar).
    try:
        await create_tables()
    except Exception as e:
        print(f"[STARTUP] Aviso: create_tables falhou ({e}). Rode migrations manuais se necessario.")
    yield


app = FastAPI(
    title="dash-tg API",
    description="Dashboard eSoccer — Analise de duplas + grade integrada",
    version="2.1.0",
    swagger_ui_parameters={"persistAuthorization": True},
    lifespan=lifespan,
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
app.include_router(grade_router)


@app.get("/health", tags=["infra"])
def health() -> dict:
    return {"status": "ok"}
