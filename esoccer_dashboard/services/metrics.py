from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd


_FIXED_REQUIRED = (
    "DuplaNormalizada",
    "Torneio",
    "Data",
    "DataHora",
    "Resultado",
    "Lucro/Prej.",
)


@dataclass(frozen=True)
class MetricsResult:
    df: pd.DataFrame


def _vec_max_streak(flags: np.ndarray, group_ids: np.ndarray) -> pd.Series:
    """Vectorized max consecutive True streak per group.

    Uses run-length encoding: new run when group changes or flag changes.
    """
    n = len(flags)
    if n == 0:
        return pd.Series(dtype=int)

    group_changed = np.empty(n, dtype=bool)
    group_changed[0] = True
    group_changed[1:] = group_ids[1:] != group_ids[:-1]

    flag_changed = np.empty(n, dtype=bool)
    flag_changed[0] = True
    flag_changed[1:] = flags[1:] != flags[:-1]

    # New run starts when group OR flag changes
    run_start = group_changed | flag_changed
    run_id = np.cumsum(run_start)

    # Count length within each run using cumcount logic
    run_lengths = pd.Series(run_id).groupby(run_id).transform("count").values

    # Zero out runs where flag is False
    run_lengths = np.where(flags, run_lengths, 0)

    # Max per group
    result = pd.Series(run_lengths, index=pd.RangeIndex(n))
    return result.groupby(group_ids).max()


def _vec_trailing_streak(flags: np.ndarray, group_ids: np.ndarray) -> pd.Series:
    """Vectorized trailing True streak per group (from the end)."""
    n = len(flags)
    if n == 0:
        return pd.Series(dtype=int)

    # Work backwards: reverse, find max streak from start = trailing streak from end
    rev_flags = flags[::-1].copy()
    rev_groups = group_ids[::-1].copy()

    # For reversed data, a "trailing" streak from the original is a "leading" streak
    group_changed = np.empty(n, dtype=bool)
    group_changed[0] = True
    group_changed[1:] = rev_groups[1:] != rev_groups[:-1]

    # Streak breaks when group changes or flag is False
    streak_break = group_changed | ~rev_flags
    # cumsum gives us block IDs; within each block where flag=True, count up
    block_id = np.cumsum(streak_break)
    counts = pd.Series(block_id).groupby(block_id).cumcount().values + 1
    counts = np.where(rev_flags, counts, 0)

    # The leading (first) value per group in reversed order = trailing streak in original
    # Get the first value per group
    rev_series = pd.Series(counts)
    rev_group_series = pd.Series(rev_groups)

    # First occurrence of each group in reversed order
    first_mask = ~rev_group_series.duplicated(keep="first")
    result = pd.Series(
        counts[first_mask],
        index=rev_groups[first_mask],
    )
    return result


def _vec_reds_after_red(
    df: pd.DataFrame,
    group_ids: np.ndarray,
    janela_horas: int | None,
) -> pd.Series:
    """Vectorized count of consecutive Red -> Red pairs per group."""
    is_red = (df["Resultado"].values == "Red")
    n = len(df)
    if n <= 1:
        return pd.Series(0, index=pd.Index(np.unique(group_ids)))

    group_changed = np.empty(n, dtype=bool)
    group_changed[0] = True
    group_changed[1:] = group_ids[1:] != group_ids[:-1]

    # Consecutive Red pairs: both current and previous are Red, same group
    pair = np.zeros(n, dtype=int)
    both_red = is_red[1:] & is_red[:-1] & ~group_changed[1:]

    if janela_horas is None:
        # Same-day only
        datas = df["Data"].values
        same_day = datas[1:] == datas[:-1]
        pair[1:] = (both_red & same_day).astype(int)
    else:
        datas = df["Data"].values
        same_day = datas[1:] == datas[:-1]
        datahoras = pd.to_datetime(df["DataHora"])
        time_diff = datahoras.diff().iloc[1:].dt.total_seconds().values
        within_window = time_diff <= (janela_horas * 3600)
        pair[1:] = (both_red & (same_day | within_window)).astype(int)

    return pd.Series(pair).groupby(group_ids).sum()


def _vec_srpt(resultados: np.ndarray, group_ids: np.ndarray) -> pd.Series:
    """Vectorized SRPT per group."""
    values = np.where(resultados == "Green", 1.0, -3.0)

    gid_series = pd.Series(group_ids)
    # Reverse cumcount gives distance from end within group
    rev_cumcount = gid_series.groupby(group_ids).cumcount(ascending=False).values
    weights = 0.5 ** (rev_cumcount / 10.0)

    weighted = values * weights
    return pd.Series(weighted).groupby(group_ids).sum()


def _last_n_green_str(resultado_series: pd.Series, group_ids: np.ndarray, n: int) -> pd.Series:
    """Last N results as G-R-G string per group."""
    gr = resultado_series.map({"Green": "G", "Red": "R"}).fillna("?")
    gid = pd.Series(group_ids, index=resultado_series.index)

    def _tail_join(g: pd.Series) -> str:
        return "-".join(g.tail(n).tolist())

    return gr.groupby(gid).apply(_tail_join)


def _last_n_green_pct(resultado_values: np.ndarray, group_ids: np.ndarray, n: int) -> pd.Series:
    """% green in the last N entries per group."""
    gid = pd.Series(group_ids)
    resultado = pd.Series(resultado_values)

    def _tail_pct(g: pd.Series) -> float:
        tail = g.tail(n)
        total = len(tail)
        if total == 0:
            return 0.0
        greens = int((tail.values == "Green").sum())
        return float(greens / total * 100.0)

    return resultado.groupby(gid).apply(_tail_pct)


def _unique_in_order(values: pd.Series) -> str:
    seen: set[str] = set()
    out: list[str] = []
    for v in values.astype(str).tolist():
        if v not in seen:
            seen.add(v)
            out.append(v)
    return " / ".join(out)


def compute_metrics(
    df: pd.DataFrame,
    group_by: list[str],
    sistema_red_janela_horas: int | None,
) -> MetricsResult:
    """
    Calcula as 16 métricas por grupo definido por group_by — versão vetorizada.

    group_by: ["DuplaNormalizada"] ou ["DuplaNormalizada", "Linha"]
    sistema_red_janela_horas: None = só mesmo dia / int = mesmo dia OU até N horas

    Definido pela estratégia — nunca hardcoded aqui.
    """
    required = list(_FIXED_REQUIRED) + [c for c in group_by if c not in _FIXED_REQUIRED]
    missing = [c for c in required if c not in df.columns]
    if missing:
        raise ValueError(f"Métricas requerem colunas: {missing}")

    if df.empty:
        return MetricsResult(df=pd.DataFrame())

    # Sort once by group + DataHora
    df = df.sort_values(group_by + ["DataHora"], kind="stable").copy()

    # Numeric group IDs for vectorized operations
    grp = df.groupby(group_by, sort=False)
    group_ids = grp.ngroup().values

    resultados = df["Resultado"].values
    is_green = resultados == "Green"
    is_red = resultados == "Red"

    # ---- Simple aggregations (fully vectorized) ----
    agg_df = grp.agg(
        quantidade_entradas=("Resultado", "size"),
        quantidade_greens=("Resultado", lambda x: int((x.values == "Green").sum())),
        quantidade_reds=("Resultado", lambda x: int((x.values == "Red").sum())),
        lucro_prej_total=("Lucro/Prej.", lambda x: float(pd.to_numeric(x, errors="coerce").fillna(0.0).sum())),
    ).reset_index()

    agg_df["percentual_green"] = np.where(
        agg_df["quantidade_entradas"] > 0,
        agg_df["quantidade_greens"] / agg_df["quantidade_entradas"] * 100.0,
        0.0,
    )
    agg_df["pontuacao"] = agg_df["quantidade_greens"] - 3 * agg_df["quantidade_reds"]

    # ---- Vectorized streak metrics ----
    agg_df["max_reds"] = _vec_max_streak(is_red, group_ids).values
    agg_df["max_greens"] = _vec_max_streak(is_green, group_ids).values
    agg_df["sequencia_atual_g"] = _vec_trailing_streak(is_green, group_ids).values

    # ---- Reds after red ----
    rar = _vec_reds_after_red(df, group_ids, sistema_red_janela_horas)
    agg_df["reds_apos_red"] = rar.values
    agg_df["sistema_red_pct"] = np.where(
        agg_df["quantidade_reds"] > 0,
        agg_df["reds_apos_red"] / agg_df["quantidade_reds"] * 100.0,
        0.0,
    )

    # ---- SRPT ----
    agg_df["srpt"] = _vec_srpt(resultados, group_ids).values

    # ---- Last-N metrics (need per-group tail) ----
    agg_df["ultimos_6"] = _last_n_green_str(df["Resultado"], group_ids, 6).values
    agg_df["pct_green_10"] = _last_n_green_pct(resultados, group_ids, 10).values

    # ---- String aggregations (apply-based, but lightweight) ----
    ligas = grp["Torneio"].apply(_unique_in_order).reset_index(name="ligas")
    agg_df["ligas"] = ligas["ligas"].values

    fontes = grp["__bet"].apply(lambda x: sorted(x.dropna().unique().tolist())).reset_index(name="fontes")
    agg_df["fontes"] = fontes["fontes"].values

    # ---- Format output ----
    if len(group_by) == 1:
        agg_df = agg_df.rename(columns={group_by[0]: "dupla"})
        agg_df["dupla"] = agg_df["dupla"].astype(str)
    else:
        agg_df = agg_df.rename(columns={group_by[0]: "dupla", group_by[1]: "linha"})
        agg_df["dupla"] = agg_df["dupla"].astype(str)
        agg_df["linha"] = agg_df["linha"].astype(str)

    # Select output columns in the expected order
    cols = [
        "dupla", "ligas", "fontes",
        "quantidade_entradas", "quantidade_greens", "percentual_green",
        "pontuacao", "ultimos_6", "pct_green_10",
        "quantidade_reds", "max_reds", "reds_apos_red", "sistema_red_pct",
        "srpt", "sequencia_atual_g", "max_greens", "lucro_prej_total",
    ]
    if "linha" in agg_df.columns:
        cols.insert(cols.index("quantidade_entradas"), "linha")

    out = agg_df[[c for c in cols if c in agg_df.columns]].copy()
    return MetricsResult(df=out)
