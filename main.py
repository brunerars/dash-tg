import asyncio
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


async def _init_db_with_retry(attempts: int = 30, delay: float = 2.0) -> None:
    """create_tables com retry — em Swarm, Postgres pode demorar a entrar no DNS."""
    last_err: Exception | None = None
    for i in range(1, attempts + 1):
        try:
            await create_tables()
            print(f"[STARTUP] Tabelas de grade OK (tentativa {i})")
            return
        except Exception as e:
            last_err = e
            if i == 1:
                print(f"[STARTUP] Aguardando DB ({type(e).__name__}: {e})...")
            await asyncio.sleep(delay)
    print(f"[STARTUP] ERRO: DB indisponivel apos {attempts * delay:.0f}s. Ultimo erro: {last_err}")
    print("[STARTUP] API vai subir mesmo assim — endpoints /flags e /grade vao falhar ate DB voltar.")


@asynccontextmanager
async def lifespan(app: FastAPI):
    await _init_db_with_retry()
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
