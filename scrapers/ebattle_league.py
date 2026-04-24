"""
eBattle League Scraper
----------------------
Scraping da liga eBattle (esportsbattle.com)
Método: REST API direta, com descoberta de torneios via listing endpoint oficial.

Histórico: a versão anterior usava busca binária + range scan em tournament_ids,
assumindo que "tem matches" era monotônico no ID. Isso falhou no incidente de
2026-04-23 — a eBattle cria torneios com IDs esparsos (ex.: 241711 finalizado,
depois 241848, 241899 para o dia seguinte), e a binária convergia no último
bloco contíguo, deixando jogos novos "escondidos".
"""

import time
from datetime import datetime, timedelta, timezone
from typing import Dict, List, Optional
from zoneinfo import ZoneInfo

import requests

BASE = "https://football.esportsbattle.com"
TZ_BR = ZoneInfo("America/Sao_Paulo")

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                  "AppleWebKit/537.36 (KHTML, like Gecko) "
                  "Chrome/131.0.0.0 Safari/537.36",
    "Accept": "application/json",
    "Accept-Language": "en-US,en;q=0.9",
    "Referer": BASE + "/",
    "Connection": "keep-alive",
}

# status_id observados na API:
#   2 = scheduled, 4 = finished
#   1 e 3 não observados ao vivo, mas reservados (provável staging/live).
# Ignoramos apenas o 4 (finished) — os demais entram no pipeline.
FINISHED_STATUS = 4

LISTING_TIMEOUT = 10
MATCHES_TIMEOUT = 30
MAX_LISTING_PAGES = 50  # safety cap — em operação normal são 2-3 páginas


def fetch_tournaments_from_listing(
    days_back: int = 1,
    days_ahead: int = 2,
) -> List[Dict]:
    """Lista torneios via endpoint oficial /api/tournaments.

    A janela cobre days_back dias no passado até days_ahead dias no futuro,
    alinhada a 03:00 UTC (= 00:00 BRT) pra bater com a noção de "dia BR".

    eBattle hoje só publica até d+1, mas cobrimos d+2 por segurança.
    days_back=1 garante que jogos em andamento e finalizados recentes sejam
    incluídos (usefuis pra cálculos H2H downstream).

    Returns:
        Lista de torneios (dicts), com chaves:
        id, status_id, start_date, token_international, league, location
    """
    now_utc = datetime.now(timezone.utc)
    start_day = (now_utc - timedelta(days=days_back)).replace(
        hour=3, minute=0, second=0, microsecond=0
    )
    end_day = (now_utc + timedelta(days=days_ahead + 1)).replace(
        hour=2, minute=59, second=0, microsecond=0
    )
    date_from = start_day.strftime("%Y/%m/%d %H:%M")
    date_to = end_day.strftime("%Y/%m/%d %H:%M")

    tournaments: List[Dict] = []
    page = 1
    while page <= MAX_LISTING_PAGES:
        try:
            resp = requests.get(
                f"{BASE}/api/tournaments",
                headers=HEADERS,
                params={"page": page, "dateFrom": date_from, "dateTo": date_to},
                timeout=LISTING_TIMEOUT,
            )
            resp.raise_for_status()
            data = resp.json()
        except Exception as e:
            print(f"[ERROR] Listing falhou na page={page}: {e}")
            break

        page_items = data.get("tournaments", []) or []
        tournaments.extend(page_items)

        total_pages = int(data.get("totalPages") or 0)
        if page >= total_pages or not page_items:
            break
        page += 1
    else:
        print(f"[WARN] Atingiu MAX_LISTING_PAGES={MAX_LISTING_PAGES} — interrompendo")

    return tournaments


def get_matches_for_tournament(tournament_id: int) -> List[Dict]:
    """Chama a API /api/tournaments/<id>/matches e retorna a lista de matches (dicts)."""
    url = f"{BASE}/api/tournaments/{tournament_id}/matches"
    resp = requests.get(url, headers=HEADERS, timeout=MATCHES_TIMEOUT)
    resp.raise_for_status()

    data = resp.json()
    if isinstance(data, list):
        return data
    if isinstance(data, dict):
        for key in ("data", "matches", "items", "result"):
            if key in data and isinstance(data[key], list):
                return data[key]
    raise ValueError(f"Formato inesperado da API para tournament {tournament_id}: {type(data)}")


def extrair_jogador_do_participante(participant: Dict) -> tuple[str, str]:
    """Extrai nome do time e jogador de um participante da API.

    Retorna: (time, jogador)
    """
    nickname = participant.get("nickname", "")
    team_data = participant.get("team", {}) or {}
    team_name = team_data.get("token_international", "") or team_data.get("name", "")

    return team_name, nickname.lower() if nickname else ""


def parse_match(match: Dict) -> Dict | None:
    """Normaliza um match para o formato padronizado.

    Retorna None se o match for FIFA IA (participantes virtual_*) — são jogos
    de bot entre IAs, fora do escopo do BetChecker (focado em eSoccer humano).
    """
    raw_date = match.get("date")
    if not raw_date:
        raise ValueError("Match sem campo 'date'")

    iso = raw_date.replace("Z", "+00:00")
    dt = datetime.fromisoformat(iso)

    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)

    dt_br = dt.astimezone(TZ_BR)

    p1 = match.get("participant1", {}) or {}
    p2 = match.get("participant2", {}) or {}

    time_casa, jogador_casa = extrair_jogador_do_participante(p1)
    time_fora, jogador_fora = extrair_jogador_do_participante(p2)

    if (
        not jogador_casa
        or not jogador_fora
        or jogador_casa.startswith("virtual_")
        or jogador_fora.startswith("virtual_")
    ):
        return None

    return {
        "horario": dt_br.strftime("%H:%M"),
        "time_casa": time_casa,
        "jogador_casa": jogador_casa,
        "time_fora": time_fora,
        "jogador_fora": jogador_fora,
        "P1": jogador_casa,
        "P2": jogador_fora,
        "data": dt_br.strftime("%d/%m/%Y"),
        "tournament_id": match.get("tournament_id"),
        "match_id": match.get("id"),
    }


def _count_future(matches: List[Dict]) -> int:
    """Conta quantos matches do resultado final estão no futuro (BRT)."""
    now_brt = datetime.now(TZ_BR)
    count = 0
    for m in matches:
        try:
            d, mo, y = m["data"].split("/")
            hh, mm = m["horario"].split(":")
            dt = datetime(int(y), int(mo), int(d), int(hh), int(mm), tzinfo=TZ_BR)
            if dt >= now_brt:
                count += 1
        except Exception:
            continue
    return count


def scrape_ebattle_league(**_kwargs) -> List[Dict]:
    """Scrape principal da eBattle League.

    Pipeline:
      1. Lista torneios via /api/tournaments (janela: ontem → d+2)
      2. Descarta torneios com status_id=4 (finished)
      3. Para cada torneio restante, baixa matches e parseia
      4. Filtra FIFA IA (virtual_*) no parse_match

    **_kwargs: aceitos e ignorados pra compat com chamadores antigos
              (range_size, max_tournaments — não fazem mais sentido).

    Retorna formato padronizado:
    {
        "horario": "HH:MM",
        "time_casa": "Nome Time",
        "jogador_casa": "nickname",
        "time_fora": "Nome Time",
        "jogador_fora": "nickname",
        "P1": "nickname",
        "P2": "nickname",
        "data": "DD/MM/YYYY",
        "tournament_id": int,
        "match_id": int,
    }
    """
    start_ts = time.monotonic()

    print("[INFO] eBattle: listando torneios via endpoint oficial...")
    tournaments = fetch_tournaments_from_listing()

    # Filtra finalizados — não trazem jogos futuros e só inflam o cache
    active = [t for t in tournaments if t.get("status_id") != FINISHED_STATUS]

    latest_id = max((t.get("id", 0) for t in tournaments), default=None)
    print(
        f"[INFO] eBattle: {len(tournaments)} torneios listados "
        f"({len(active)} ativos, {len(tournaments) - len(active)} finished), "
        f"latest_id={latest_id}"
    )

    all_matches: List[Dict] = []
    skipped_virtual = 0
    parse_errors = 0
    tournament_errors = 0

    for t in active:
        tid = t.get("id")
        if tid is None:
            continue
        try:
            matches = get_matches_for_tournament(tid)
            for m in matches:
                try:
                    parsed = parse_match(m)
                    if parsed is None:
                        skipped_virtual += 1
                        continue
                    all_matches.append(parsed)
                except Exception:
                    parse_errors += 1
                    continue
        except Exception:
            tournament_errors += 1
            continue

    duration_ms = int((time.monotonic() - start_ts) * 1000)
    future = _count_future(all_matches)
    past = len(all_matches) - future

    print(
        f"[INFO] eBattle: total={len(all_matches)} future={future} past={past} "
        f"virtual_skipped={skipped_virtual} parse_errors={parse_errors} "
        f"tournament_errors={tournament_errors} listed={len(tournaments)} "
        f"active={len(active)} latest_id={latest_id} duration_ms={duration_ms}"
    )

    if future == 0 and len(all_matches) > 0:
        print(
            f"[WARN] eBattle stagnation: {len(all_matches)} matches em cache "
            f"mas nenhum futuro. Possível janela entre releases."
        )

    return all_matches


if __name__ == "__main__":
    import json

    jogos = scrape_ebattle_league()
    print(f"\nTotal: {len(jogos)} jogos")
    if jogos:
        print("\nPrimeiros 5 jogos:")
        for j in jogos[:5]:
            print(f"  {j['horario']} | {j['jogador_casa']} ({j['time_casa']}) vs {j['jogador_fora']} ({j['time_fora']})")

    with open("ebattle_league_jogos.json", "w", encoding="utf-8") as f:
        json.dump(jogos, f, ensure_ascii=False, indent=2)
    print("\nSalvo em ebattle_league_jogos.json")
