from __future__ import annotations

from dataclasses import dataclass

import pandas as pd


_REQUIRED_ALWAYS = ("DataHora", "__source_file")


@dataclass(frozen=True)
class DedupResult:
    df: pd.DataFrame
    total_jogos_apos_dedup: int


def deduplicate_clusters(
    df: pd.DataFrame,
    dedup_key: list[str],
    window_minutes: int = 5,
) -> DedupResult:
    """
    Deduplicação por cluster (≤ window_minutes) — versão vetorizada.

    Algoritmo:
    1. Ordena por dedup_key + DataHora
    2. Identifica grupos (dedup_key) e clusters (gaps > window) via operações C
    3. Para clusters com múltiplos arquivos: mantém a linha com horário mais tardio
    4. Para clusters com um único arquivo: mantém todas as linhas

    O dedup_key é definido pela estratégia — nunca hardcoded aqui.
    """
    required = list(_REQUIRED_ALWAYS) + [c for c in dedup_key if c not in _REQUIRED_ALWAYS]
    missing = [c for c in required if c not in df.columns]
    if missing:
        raise ValueError(f"Deduplicação requer colunas: {missing}")

    if df.empty:
        return DedupResult(df=df.copy(), total_jogos_apos_dedup=0)

    td = pd.Timedelta(minutes=window_minutes)

    # 1. Sort by dedup_key + DataHora (one C-level sort)
    dfs = df.sort_values(dedup_key + ["DataHora"]).copy()

    # 2. Identify group boundaries using ngroup (C-level groupby)
    grp_id = dfs.groupby(dedup_key, sort=False).ngroup()
    grp_changed = grp_id != grp_id.shift(1)

    # 3. Identify cluster boundaries: new group OR time gap > window
    time_diff = dfs["DataHora"].diff()
    new_cluster = grp_changed | (time_diff > td) | time_diff.isna()
    cluster_id = new_cluster.cumsum()

    # 4. Vectorized aggregation: count unique sources and find latest per cluster
    dfs["_cluster"] = cluster_id.values
    cluster_info = dfs.groupby("_cluster").agg(
        n_sources=("__source_file", "nunique"),
        latest_idx=("DataHora", "idxmax"),
    )

    # 5. Single-source clusters: keep all rows. Multi-source: keep only latest.
    single_source_clusters = cluster_info.index[cluster_info["n_sources"] < 2]
    multi_source_latest = cluster_info.loc[cluster_info["n_sources"] >= 2, "latest_idx"]

    mask_single = dfs["_cluster"].isin(single_source_clusters)
    keep_idx = dfs.index[mask_single].append(pd.Index(multi_source_latest.values))

    out = df.loc[keep_idx].sort_values(
        [dedup_key[0], "DataHora"], kind="stable",
    ).reset_index(drop=True)
    return DedupResult(df=out, total_jogos_apos_dedup=int(len(out)))
