"""Tradutor entre a string de dupla do dashboard e o par normalizado do scraper.

- dash-tg armazena: "cevuu (2x6) vs elmagico (2x6)" (com sufixos)
- scraper v3 entrega: {P1: "cevuu", P2: "elmagico"} (so o nome-base lowercase)

`dupla_to_pair` usa `_extract_player_name` ja existente em
`esoccer_dashboard/services/normalizer.py` para extrair o `base` de cada lado.
"""
from __future__ import annotations

from typing import Optional, Tuple

from esoccer_dashboard.services.normalizer import (
    _VS_SPLIT_RE,
    _extract_player_name,
)


def dupla_to_pair(dupla: str) -> Optional[Tuple[str, str]]:
    """Extrai (p1, p2) base names lowercase, ordenados alfabeticamente.

    Retorna None se nao conseguir parsear.
    """
    if not dupla:
        return None

    parts = _VS_SPLIT_RE.split(str(dupla).strip(), maxsplit=1)
    if len(parts) != 2:
        return None

    left = _extract_player_name(parts[0]).base.strip().lower()
    right = _extract_player_name(parts[1]).base.strip().lower()

    if not left or not right or left == right:
        return None

    a, b = sorted([left, right])
    return (a, b)


def pair_to_display(p1: str, p2: str) -> str:
    """Formato limpo para mostrar na Grade do Dia: 'p1 vs p2'."""
    return f"{p1} vs {p2}"


def event_pair(event: dict) -> Optional[Tuple[str, str]]:
    """Extrai o par ordenado de um evento do scraper."""
    home = str(event.get("jogador_casa") or event.get("P1") or "").strip().lower()
    away = str(event.get("jogador_fora") or event.get("P2") or "").strip().lower()
    if not home or not away:
        return None
    a, b = sorted([home, away])
    return (a, b)
