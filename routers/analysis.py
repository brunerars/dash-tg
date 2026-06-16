from __future__ import annotations

import gc
import hashlib
import io
import json
from datetime import date as date_type, time as time_type
from typing import Annotated

import pandas as pd
from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import StreamingResponse

from config.strategies import ESTRATEGIAS, get_strategy_internal
from esoccer_dashboard.services.cache import (
    delete_cache_key,
    gerar_cache_key,
    get_analysis,
    get_file_df,
    store_file_df,
    get_blueprint,
    get_cache_stats,
    get_export,
    get_or_compute,
    store_blueprint,
    store_export,
)
from esoccer_dashboard.services.deduplicator import deduplicate_clusters
from esoccer_dashboard.services.loader import LoadResult, load_tips_enviadas
from esoccer_dashboard.services.metrics import compute_metrics
from esoccer_dashboard.services.normalizer import add_dupla_normalizada
from middleware.auth import verify_jwt_cookie

router = APIRouter()

AuthDep = Annotated[str, Depends(verify_jwt_cookie)]


# ---------------------------------------------------------------------------
# Adapter: FastAPI UploadFile → UploadedLike (protocolo do loader)
# ---------------------------------------------------------------------------
class _UploadFileAdapter:
    def __init__(self, filename: str, content: bytes) -> None:
        self.name = filename
        self._content = content

    def getvalue(self) -> bytes:
        return self._content


# ---------------------------------------------------------------------------
# Sync pipeline — callable from any thread (e.g. ThreadPoolExecutor)
# ---------------------------------------------------------------------------
def _build_analysis_result(
    strategy_name: str,
    files_contents: list[tuple[str, bytes]],
    date_from: str | None = None,
    date_to: str | None = None,
    horarios: list[str] | None = None,
) -> dict:
    """Full synchronous compute pipeline.

    Returns the result dict (without ``cache_hit`` — caller adds it).
    Designed to be called both from ``_analyze_with_strategy`` (via
    ``get_or_compute``) and from the precompute router via
    ``ThreadPoolExecutor``.
    """
    estrategia = get_strategy_internal(strategy_name)

    files_bytes = [c for _, c in files_contents]
    cache_key = gerar_cache_key(files_bytes, strategy_name, date_from, date_to, horarios)

    # 1. Carregar com cache individual por arquivo (parquet+zstd)
    frames: list[pd.DataFrame] = []
    for name, content in files_contents:
        file_hash = hashlib.md5(content).hexdigest()
        cached_bytes = get_file_df(file_hash)
        if cached_bytes:
            frames.append(pd.read_parquet(io.BytesIO(cached_bytes)))
        else:
            adapter = _UploadFileAdapter(name, content)
            result = load_tips_enviadas([adapter])
            buf = io.BytesIO()
            result.df.to_parquet(buf, engine="pyarrow", compression="zstd")
            store_file_df(file_hash, buf.getvalue())
            frames.append(result.df)
            del buf, result

    df = pd.concat(frames, ignore_index=True) if frames else pd.DataFrame()
    # Libera lista de frames intermediarios — concat ja copiou
    del frames
    gc.collect()
    load_result = LoadResult(df=df, total_jogos_brutos=int(len(df)))

    # 1b. Filtrar por período (se informado) — antes da normalização e dedup
    if date_from or date_to:
        if date_from:
            df = df[df["Data"] >= date_type.fromisoformat(date_from)]
        if date_to:
            df = df[df["Data"] <= date_type.fromisoformat(date_to)]
        if df.empty:
            raise HTTPException(
                status_code=422,
                detail="Nenhum jogo encontrado no período especificado.",
            )
        df = df.reset_index(drop=True)
        load_result = LoadResult(df=df, total_jogos_brutos=len(df))

    # 1c. Capturar minutos únicos de "Horario Jogo" (MM:SS → minuto)
    # Valores como "05:04" são parseados como time(5,4) — .hour dá o minuto do jogo
    horarios_unicos: list[str] = []
    if "Horario Jogo" in df.columns and not df.empty:
        minutes = df["Horario Jogo"].dropna().apply(lambda t: t.hour)
        horarios_unicos = sorted(set(str(m) for m in minutes), key=lambda x: int(x))

    # 1d. Filtrar por minutos de jogo selecionados
    if horarios and "Horario Jogo" in df.columns:
        parsed_minutes = [int(h) for h in horarios]
        df = df[df["Horario Jogo"].apply(lambda t: t.hour).isin(parsed_minutes)]
        if df.empty:
            raise HTTPException(
                status_code=422,
                detail="Nenhum jogo encontrado nos horários selecionados.",
            )
        df = df.reset_index(drop=True)
        load_result = LoadResult(df=df, total_jogos_brutos=len(df))

    # 2. Normalizar dupla
    df = add_dupla_normalizada(load_result.df)

    # 3. Deduplicar — usando dedup_key da estratégia
    dedup_result = deduplicate_clusters(
        df,
        dedup_key=estrategia["dedup_key_internal"],
    )

    # 3b. Armazenar dados de blueprint (dedup df completo para auditoria)
    dedup_json = dedup_result.df.to_json(orient="records", date_format="iso", default_handler=str)
    store_blueprint(cache_key, dedup_json)

    # 4. Calcular métricas — usando group_by e janela_horas da estratégia
    metrics_result = compute_metrics(
        dedup_result.df,
        group_by=estrategia["group_by_internal"],
        sistema_red_janela_horas=estrategia["sistema_red_janela_horas"],
    )

    # 5. Sem filtros de exibição — frontend controla min_jogos e min_green_pct (FILT-01, FILT-02)
    mdf = metrics_result.df

    # 6. Serializar para dict (JSON-safe)
    duplas = mdf.to_dict(orient="records") if not mdf.empty else []
    for row in duplas:
        for k, v in row.items():
            if hasattr(v, "item"):
                row[k] = v.item()

    # 7. Gerar e armazenar xlsx para export
    _store_xlsx(mdf, cache_key)

    result: dict = {
        "cache_key": cache_key,
        "strategy": strategy_name,
        "total_jogos_brutos": load_result.total_jogos_brutos,
        "total_jogos_apos_dedup": dedup_result.total_jogos_apos_dedup,
        "duplas": duplas,
    }
    if date_from:
        result["date_from"] = date_from
    if date_to:
        result["date_to"] = date_to
    if horarios_unicos:
        result["horarios_unicos"] = horarios_unicos
    return result


# ---------------------------------------------------------------------------
# Helper interno: pipeline completo dado files_contents já em memória
# ---------------------------------------------------------------------------
async def _analyze_with_strategy(
    strategy_name: str,
    files_contents: list[tuple[str, bytes]],
    date_from: str | None = None,
    date_to: str | None = None,
    horarios: list[str] | None = None,
) -> dict:
    files_bytes = [c for _, c in files_contents]
    cache_key = gerar_cache_key(files_bytes, strategy_name, date_from, date_to, horarios)

    def compute() -> dict:
        return _build_analysis_result(strategy_name, files_contents, date_from, date_to, horarios)

    result, cache_hit = get_or_compute(cache_key, compute)
    result["cache_hit"] = cache_hit
    return result


# ---------------------------------------------------------------------------
# GET /results/{cache_key}  (fetch pre-computed result without re-uploading files)
# ---------------------------------------------------------------------------
@router.get(
    "/results/{cache_key}",
    tags=["análise"],
    summary="Buscar resultado pre-computado pelo cache_key",
)
def get_cached_result(_key: AuthDep, cache_key: str) -> dict:
    """Retorna um resultado de análise já computado (cache hit instantâneo).
    Usado quando o frontend troca a seleção de planilhas e a combinação
    já foi pre-computada em background."""
    result = get_analysis(cache_key)
    if result is None:
        raise HTTPException(status_code=404, detail="Resultado nao encontrado ou expirado.")
    result["cache_hit"] = True
    return result


# ---------------------------------------------------------------------------
# GET /strategies
# ---------------------------------------------------------------------------
@router.get("/strategies", tags=["análise"], summary="Listar estratégias disponíveis")
def list_strategies() -> dict:
    """Retorna as estratégias configuradas com seus parâmetros principais (`min_jogos`, `min_green_pct`).
    Use o campo `id` como valor do campo `strategy` no `/analyze`."""
    return {
        "strategies": [
            {
                "id": name,
                "descricao": cfg["descricao"],
                "min_jogos": cfg["min_jogos"],
                "min_green_pct": cfg["min_green_pct"],
            }
            for name, cfg in ESTRATEGIAS.items()
        ]
    }


# ---------------------------------------------------------------------------
# POST /analyze  (upload de arquivos)
# ---------------------------------------------------------------------------
@router.post(
    "/analyze",
    tags=["análise"],
    summary="Analisar arquivos (upload)",
    response_description="Métricas calculadas por dupla, com `cache_key` para export posterior.",
)
async def analyze(
    _key: AuthDep,
    files: list[UploadFile] = File(...),
    strategy: str = Form(...),
    date_from: str | None = Form(None, description="Data inicial do período (YYYY-MM-DD). Opcional."),
    date_to: str | None = Form(None, description="Data final do período (YYYY-MM-DD). Opcional."),
    horarios: str | None = Form(None, description="Horários de jogo selecionados, separados por vírgula (HH:MM:SS). Opcional."),
) -> dict:
    if get_strategy_internal(strategy) is None:
        raise HTTPException(
            status_code=422,
            detail=f"Estratégia '{strategy}' não encontrada. Use GET /strategies para listar as disponíveis.",
        )

    for label, value in (("date_from", date_from), ("date_to", date_to)):
        if value is not None:
            try:
                date_type.fromisoformat(value)
            except ValueError:
                raise HTTPException(
                    status_code=422,
                    detail=f"'{label}' inválido: '{value}'. Use o formato YYYY-MM-DD.",
                )

    horarios_list: list[str] | None = None
    if horarios:
        horarios_list = [h.strip() for h in horarios.split(",") if h.strip()]
        for h in horarios_list:
            try:
                int(h)
            except ValueError:
                raise HTTPException(
                    status_code=422,
                    detail=f"Horário inválido: '{h}'. Use o minuto do jogo (ex: 0, 1, 2, 5).",
                )

    filenames = [uf.filename or "arquivo.xlsx" for uf in files]
    seen = set()
    duplicates = [f for f in filenames if f in seen or seen.add(f)]
    if duplicates:
        raise HTTPException(
            status_code=422,
            detail=f"Arquivos com nome repetido não são permitidos: {duplicates}",
        )

    files_contents: list[tuple[str, bytes]] = []
    for uf in files:
        content = await uf.read()
        files_contents.append((uf.filename or "arquivo.xlsx", content))

    return await _analyze_with_strategy(strategy, files_contents, date_from, date_to, horarios_list)



def _store_xlsx(df: pd.DataFrame, cache_key: str) -> None:
    buf = io.BytesIO()
    with pd.ExcelWriter(buf, engine="openpyxl") as writer:
        df.to_excel(writer, index=False, sheet_name="Análise")
    store_export(cache_key, buf.getvalue())


# ---------------------------------------------------------------------------
# GET /blueprint/{cache_key}
# ---------------------------------------------------------------------------
@router.get("/blueprint/{cache_key}", tags=["blueprint"], summary="Dados detalhados (blueprint) de uma dupla")
def get_blueprint_data(
    _key: AuthDep,
    cache_key: str,
    dupla: str,
    linha: str | None = None,
) -> dict:
    """Retorna os jogos individuais de uma dupla para auditoria.
    O `cache_key` é obtido no response do `POST /analyze`."""
    raw = get_blueprint(cache_key)
    if raw is None:
        raise HTTPException(404, "Blueprint não encontrado. Rode /analyze novamente.")
    records = json.loads(raw)
    filtered = [r for r in records if r.get("DuplaNormalizada") == dupla]
    if linha is not None:
        filtered = [r for r in filtered if str(r.get("Linha", "")) == linha]
    cols = [
        "Torneio", "Confronto", "Linha", "Data", "Horario Jogo", "Hora",
        "Placar Envio", "Placar Final", "Odd",
        "Resultado", "Lucro/Prej.", "__bet",
    ]
    # Só incluir colunas que existem nos dados
    available_cols = set()
    if filtered:
        available_cols = set(filtered[0].keys())
    cols = [c for c in cols if c in available_cols]
    jogos = [{k: r.get(k) for k in cols} for r in filtered]
    return {
        "dupla": dupla,
        "linha": linha,
        "total_jogos": len(jogos),
        "total_records": len(records),
        "jogos": jogos,
    }


# ---------------------------------------------------------------------------
# GET /export/{cache_key}
# ---------------------------------------------------------------------------
@router.get("/export/{cache_key}", tags=["export"], summary="Baixar resultado como .xlsx")
def export_xlsx(_key: AuthDep, cache_key: str) -> StreamingResponse:
    """Retorna o resultado de uma análise já processada como arquivo `.xlsx`.
    O `cache_key` é obtido no response do `POST /analyze`. TTL do export: 1h."""
    xlsx_bytes = get_export(cache_key)
    if xlsx_bytes is None:
        raise HTTPException(
            status_code=404,
            detail="Export não encontrado. Rode /analyze primeiro ou o cache expirou (TTL 1h).",
        )
    return StreamingResponse(
        io.BytesIO(xlsx_bytes),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f"attachment; filename=analise_{cache_key[:8]}.xlsx"},
    )


# ---------------------------------------------------------------------------
# GET /cache/status
# ---------------------------------------------------------------------------
@router.get("/cache/status", tags=["cache"], summary="Status do Redis")
def cache_status(_key: AuthDep) -> dict:
    """Retorna estatísticas do Redis: total de chaves, memória, hit rate e uptime."""
    try:
        return get_cache_stats()
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"Redis indisponível: {exc}") from exc


# ---------------------------------------------------------------------------
# DELETE /cache/{cache_key}
# ---------------------------------------------------------------------------
@router.delete("/cache/{cache_key}", tags=["cache"], summary="Invalidar entrada do cache")
def invalidate_cache(_key: AuthDep, cache_key: str) -> dict:
    """Remove manualmente uma entrada do cache pelo `cache_key`."""
    deleted = delete_cache_key(cache_key)
    if not deleted:
        raise HTTPException(status_code=404, detail="Cache key não encontrada.")
    return {"deleted": True, "cache_key": cache_key}
