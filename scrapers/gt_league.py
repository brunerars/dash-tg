"""
GT League Scraper
-----------------
Scraping da liga GT League (gtleagues.com)
Método: Playwright (headless browser)
"""

import json
import re
from datetime import datetime
from typing import List, Dict
from zoneinfo import ZoneInfo

from playwright.sync_api import sync_playwright

TZ_BR = ZoneInfo("America/Sao_Paulo")


def ajustar_horario_utc_para_brt(horario: str) -> str:
    """Retorna horário SEM conversão - site já retorna em BRT.

    DESCOBERTA FINAL (20/02/2026 - teste com Docker em UTC):
        - Docker roda em timezone UTC
        - Site GT League SEMPRE retorna horários em BRT (Brasil)
        - Site NÃO faz conversão automática baseada no timezone do cliente
        - Portanto, NÃO precisamos converter nada!

    Exemplo REAL testado:
        - Jogo às 11:45 BRT (horário oficial)
        - Site retorna: "11:45" (já em BRT)
        - Scraper deve retornar: "11:45" (SEM conversão) ✓

    TODO: Migrar para solução timezone-aware usando zoneinfo (Phase 2).
    """
    # SEM CONVERSÃO - site já retorna em BRT
    return horario


def extrair_time_jogador(texto: str) -> tuple[str, str]:
    """Extrai nome do time e jogador.

    O texto pode vir em formato 'Time\\nJogador' ou 'TimeJogador'.
    """
    # Primeiro verifica se tem quebra de linha (formato mais comum no site)
    if "\n" in texto:
        partes = texto.split("\n")
        time = partes[0].strip()
        jogador = partes[1].strip().lower() if len(partes) > 1 else ""
        return time, jogador

    # Fallback: formato 'TimeJogador' sem separador
    match = re.match(r'^(.+?)([A-Z][a-z]+)$', texto)
    if match:
        time = match.group(1).strip()
        jogador = match.group(2).strip().lower()
        return time, jogador

    return texto, ""


def scrape_gt_league() -> List[Dict]:
    """Faz scrape da GT League e retorna lista de jogos.

    Retorna formato padronizado:
    {
        "horario": "HH:MM",
        "data": "DD/MM/YY",
        "time_casa": "Nome Time",
        "jogador_casa": "nickname",
        "time_fora": "Nome Time",
        "jogador_fora": "nickname",
        "P1": "nickname",
        "P2": "nickname",
        "status": "NOT STARTED" (apenas para filtro interno)
    }
    """
    jogos = []
    data_hoje = datetime.now(TZ_BR).strftime("%d/%m/%y")

    with sync_playwright() as p:
        try:
            browser = p.chromium.launch(headless=True)
        except Exception as e:
            raise
        # Forçar timezone Brasil para obter horários corretos do site
        page = browser.new_page(
            locale="pt-BR",
            timezone_id="America/Sao_Paulo"
        )

        print("[INFO] Acessando GT League...")
        try:
            page.goto("https://www.gtleagues.com/dashboard", timeout=30000)
        except Exception as e:
            browser.close()
            raise
        page.wait_for_timeout(3000)  # Espera carregar

        # Encontra a tabela de jogos (segunda tabela)
        tables = page.query_selector_all("table")
        if len(tables) < 2:
            print("[WARN] Tabela de jogos não encontrada")
            try:
                title = page.title()
            except Exception:
                title = None
            browser.close()
            return jogos

        game_table = tables[1]
        rows = game_table.query_selector_all("tr")

        print(f"[INFO] Encontradas {len(rows)} linhas na tabela")

        for row in rows[1:]:  # Pula header
            cells = row.query_selector_all("td")
            if len(cells) < 9:
                continue

            try:
                horario_utc = cells[0].inner_text().strip()
                home_text = cells[4].inner_text().strip()
                away_text = cells[5].inner_text().strip()
                status = cells[8].inner_text().strip()

                # Pula se não for horário válido
                if not re.match(r"\d{2}:\d{2}", horario_utc):
                    continue

                # Extrai time e jogador
                time_casa, jogador_casa = extrair_time_jogador(home_text)
                time_fora, jogador_fora = extrair_time_jogador(away_text)

                # Converte UTC para BRT (subtrai 3 horas)
                horario_brt = ajustar_horario_utc_para_brt(horario_utc)

                jogo = {
                    "horario": horario_brt,
                    "data": data_hoje,
                    "time_casa": time_casa,
                    "jogador_casa": jogador_casa,
                    "time_fora": time_fora,
                    "jogador_fora": jogador_fora,
                    "status": status,
                    "P1": jogador_casa,
                    "P2": jogador_fora,
                }
                jogos.append(jogo)

            except Exception as e:
                print(f"[WARN] Erro ao processar linha: {e}")
                continue

        browser.close()

    print(f"[INFO] Total de jogos encontrados: {len(jogos)}")

    # Filtra apenas jogos NOT STARTED (como no código original do n8n)
    jogos_nao_iniciados = [j for j in jogos if j.get("status") == "NOT STARTED"]
    print(f"[INFO] Jogos não iniciados: {len(jogos_nao_iniciados)}")

    return jogos_nao_iniciados


if __name__ == "__main__":
    jogos = scrape_gt_league()
    print(f"\nTotal: {len(jogos)} jogos")
    if jogos:
        print("\nPrimeiros 3 jogos:")
        for j in jogos[:3]:
            print(f"  {j.get('data', 'N/A')} {j['horario']} | {j['jogador_casa']} ({j['time_casa']}) vs {j['jogador_fora']} ({j['time_fora']})")

    with open("gt_league_jogos.json", "w", encoding="utf-8") as f:
        json.dump(jogos, f, ensure_ascii=False, indent=2)
    print("\nSalvo em gt_league_jogos.json")
