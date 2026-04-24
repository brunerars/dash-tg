"""
Adriatic League Scraper
-----------------------
Scraping da liga Adriatic League (eadriaticleague.com)
Método: Playwright (headless browser)
"""

import json
import re
import html as html_lib
import codecs
from typing import List, Dict

from playwright.sync_api import sync_playwright
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

TZ_BR = ZoneInfo("America/Sao_Paulo")
# Horários do widget (LeagueRepublic) aparecem em CET/CEST.
# Isso dá 4h de diferença vs BRT em fevereiro (CET=UTC+1, BRT=UTC-3).
TZ_SOURCE = ZoneInfo("Europe/Belgrade")
URL = "https://eadriaticleague.com/daily-matches/"

REQUESTS_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                  "AppleWebKit/537.36 (KHTML, like Gecko) "
                  "Chrome/131.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7",
    "Connection": "keep-alive",
    "Upgrade-Insecure-Requests": "1",
}

LEAGUE_REPUBLIC_HEADERS = {
    "User-Agent": REQUESTS_HEADERS["User-Agent"],
    "Accept": "*/*",
    "Accept-Language": REQUESTS_HEADERS["Accept-Language"],
    # CloudFront costuma bloquear sem contexto de origem/referer
    "Referer": URL,
    "Origin": "https://eadriaticleague.com",
    "Connection": "keep-alive",
}


def _looks_like_challenge(html_lower: str) -> bool:
    # Sinais genéricos (Cloudflare/challenge/captcha)
    return (
        "cloudflare" in html_lower
        or "cf-ray" in html_lower
        or "challenge" in html_lower
        or "captcha" in html_lower
        or "attention required" in html_lower
    )


def _looks_like_schedule(html_text: str) -> bool:
    # Sinais mínimos do conteúdo esperado: datas e horários
    return bool(re.search(r"\b\d{2}/\d{2}/\d{2,4}\b", html_text)) and bool(
        re.search(r"\b\d{2}:\d{2}\b", html_text)
    )


def _extract_body_text_from_html(html: str) -> str:
    # Remove scripts/styles e tags para aproximar do innerText
    html = re.sub(r"(?is)<script.*?>.*?</script>", "\n", html)
    html = re.sub(r"(?is)<style.*?>.*?</style>", "\n", html)
    html = re.sub(r"(?is)<!--.*?-->", "\n", html)
    html = re.sub(r"(?is)<br\s*/?>", "\n", html)
    html = re.sub(r"(?is)</(div|p|tr|li|h\d)>", "\n", html)
    html = re.sub(r"(?is)<[^>]+>", " ", html)
    html = re.sub(r"[ \\t\\r\\f\\v]+", " ", html)
    html = re.sub(r"\n{2,}", "\n", html)
    return html.strip()


def _remove_wordbreak_artifacts(s: str) -> str:
    """
    O LeagueRepublic/Elementor pode inserir quebra de palavra via:
    - <wbr>
    - soft hyphen (&shy; / \\u00ad)
    - zero width spaces (\\u200b / \\u2060)
    que, ao "stripar" HTML, acabam virando espaços no meio dos nomes (ex.: "Ba celona").
    """
    # tags que NÃO devem virar espaço (quebra de palavra)
    s = re.sub(r"(?is)<\s*wbr\s*/?\s*>", "", s)
    # entidades e caracteres invisíveis
    s = s.replace("&shy;", "")
    s = s.replace("\u00ad", "")  # soft hyphen
    s = s.replace("\u200b", "")  # zero width space
    s = s.replace("\u2060", "")  # word joiner
    return s


def _html_fragment_to_text(fragment: str) -> str:
    fragment = _remove_wordbreak_artifacts(fragment)
    # NBSP → espaço normal
    fragment = fragment.replace("\u00a0", " ")
    fragment = html_lib.unescape(fragment)
    # remove tags restantes
    fragment = re.sub(r"(?is)<[^>]+>", " ", fragment)
    fragment = re.sub(r"\s+", " ", fragment).strip()
    return fragment


def _source_label_to_brt(date_ddmmyy: str, time_hhmm: str) -> tuple[str, str]:
    """
    O LeagueRepublic entrega horários em CET/CEST no header (ex.: Thu 26/02/26 02:30).
    Converter para BRT ajustando data quando cruza meia-noite.
    """
    dd, mm, yy = date_ddmmyy.split("/")
    year = int(yy) + 2000 if len(yy) == 2 else int(yy)
    hh, mi = map(int, time_hhmm.split(":"))
    dt_src = datetime(year, int(mm), int(dd), hh, mi, tzinfo=TZ_SOURCE)
    dt_br = dt_src.astimezone(TZ_BR)
    return dt_br.strftime("%d/%m/%y"), dt_br.strftime("%H:%M")


def _parse_leaguerepublic_inner_html(inner_html: str) -> List[Dict]:
    """
    Parse direto do HTML do widget (sem passar por "texto do body"),
    preservando nomes e evitando splits por word-break.
    """
    jogos: list[Dict] = []

    # Normaliza para facilitar regex
    html = _remove_wordbreak_artifacts(inner_html)

    # Headers do tipo: <th colspan="7">Thu 26/02/26 02:30</th>
    headers: list[tuple[int, int, str]] = []
    for m in re.finditer(r'(?is)<th[^>]*colspan\s*=\s*["\']?7["\']?[^>]*>(.*?)</th>', html):
        headers.append((m.start(), m.end(), _html_fragment_to_text(m.group(1))))

    if not headers:
        return jogos

    # Para cada bloco entre headers, extrai linhas (tr/td)
    for idx, (h_start, h_end, header_text) in enumerate(headers):
        block_start = h_end
        block_end = headers[idx + 1][0] if idx + 1 < len(headers) else len(html)
        block = html[block_start:block_end]

        hm = re.search(r"(\d{2}/\d{2}/\d{2,4})\s+(\d{2}:\d{2})", header_text)
        if not hm:
            continue
        date_src = hm.group(1)
        time_src = hm.group(2)
        data_brt, horario_brt = _source_label_to_brt(date_src, time_src)

        for tr in re.findall(r"(?is)<tr[^>]*>(.*?)</tr>", block):
            tds = re.findall(r"(?is)<td[^>]*>(.*?)</td>", tr)
            if not tds:
                continue

            texts = [_html_fragment_to_text(td) for td in tds]
            # pega apenas células com "Time (Jogador)" e ignora "FIFA STREAM"
            pair_cells = [t for t in texts if "(" in t and ")" in t and not re.search(r"FIFA\s*STREAM", t, flags=re.I)]
            if len(pair_cells) < 2:
                continue

            home_part = pair_cells[0].strip()
            away_part = pair_cells[1].strip()

            time_casa, jogador_casa = extrair_time_jogador(home_part)
            time_fora, jogador_fora = extrair_time_jogador(away_part)
            if not (jogador_casa and jogador_fora):
                continue

            jogos.append(
                {
                    "horario": horario_brt,
                    "data": data_brt,
                    "time_casa": time_casa,
                    "jogador_casa": jogador_casa,
                    "time_fora": time_fora,
                    "jogador_fora": jogador_fora,
                    "P1": jogador_casa,
                    "P2": jogador_fora,
                }
            )

    return jogos

def _extract_lrcodes_from_page_html(page_html: str) -> list[str]:
    """
    A página 'daily-matches' embute widgets do LeagueRepublic via:
      var lrcode = '325101797'
      <script src="https://api.leaguerepublic.com/client/api/cs1.js"></script>
    """
    codes = re.findall(r"var\s+lrcode\s*=\s*'(\d+)'", page_html)
    # de-dup preservando ordem
    seen: set[str] = set()
    out: list[str] = []
    for c in codes:
        if c not in seen:
            seen.add(c)
            out.append(c)
    return out


def _extract_innerhtml_from_leaguerepublic_payload(payload: str) -> str | None:
    # payload é JS que faz: document.getElementById('lrep{code}').innerHTML = '...';
    m = re.search(r"innerHTML\s*=\s*'([\s\S]*?)';", payload)
    if not m:
        return None
    raw = m.group(1)
    # Decodifica escapes típicos de string JS (\t, \n, \uXXXX, etc)
    try:
        decoded = codecs.decode(raw, "unicode_escape")
    except Exception:
        decoded = (
            raw.replace("\\t", "\t")
            .replace("\\r", "\r")
            .replace("\\n", "\n")
            .replace("\\'", "'")
            .replace('\\"', '"')
        )
    return html_lib.unescape(decoded)


def _scrape_from_leaguerepublic(session, lrcodes: list[str]) -> List[Dict]:
    jogos_all: list[Dict] = []

    for code in lrcodes:
        try:
            url = f"https://api.leaguerepublic.com/js/cs1.html?cs={code}&random=0.123"
            r = session.get(url, headers=LEAGUE_REPUBLIC_HEADERS, timeout=12, allow_redirects=True)
            payload = r.text or ""
            if r.status_code != 200 or len(payload) < 200:
                continue

            inner = _extract_innerhtml_from_leaguerepublic_payload(payload)
            if not inner:
                continue

            jogos = _parse_leaguerepublic_inner_html(inner)
            jogos_all.extend(jogos)
        except Exception as e:
            continue

    # de-dup por chave composta (data+hora+p1+p2)
    dedup: dict[str, Dict] = {}
    for j in jogos_all:
        key = f"{j.get('data','')}|{j.get('horario','')}|{j.get('P1','')}|{j.get('P2','')}"
        dedup[key] = j
    return list(dedup.values())


def _shift_date_ddmmyy(data_str: str, delta_days: int) -> str:
    """Ajusta data no formato DD/MM/YY ou DD/MM/YYYY por delta dias."""
    try:
        parts = data_str.split("/")
        if len(parts) != 3:
            return data_str
        dd, mm, yy = parts
        year = int(yy)
        if len(yy) == 2:
            year += 2000
        dt = datetime(year, int(mm), int(dd), tzinfo=TZ_BR) + timedelta(days=delta_days)
        # preservar 2 dígitos se original for YY
        return dt.strftime("%d/%m/%y") if len(yy) == 2 else dt.strftime("%d/%m/%Y")
    except Exception:
        return data_str


def _parse_schedule_from_text(body_text: str) -> List[Dict]:
    """Parse (mesma lógica do scraper original) a partir de texto já 'linearizado'."""
    jogos: List[Dict] = []
    lines = body_text.split("\n")
    horario_atual = ""
    data_atual = ""

    for line in lines:
        line = line.strip()
        if not line:
            continue
        # Normaliza whitespace para facilitar parsing (LR usa muitos escapes)
        line = line.replace("\t", " ")
        line = re.sub(r"\s+", " ", line).strip()

        # Detecta linha de horário: "Sat 31/01/26 04:00" ou "31/01/26 04:00"
        horario_match = re.match(r"^(?:[A-Za-z]{3}\s+)?(\d{2}/\d{2}/\d{2,4})\s+(\d{2}:\d{2})$", line)
        if horario_match:
            # Converte UTC -> BRT com ajuste de data
            data_atual, horario_atual = _source_label_to_brt(horario_match.group(1), horario_match.group(2))
            continue

        # Detecta linha de jogo: "Time (Jogador) v Time (Jogador) FIFA STREAM"
        try:
            if " v " in line:
                parts = re.split(r"\s+v\s+", line)
                if len(parts) >= 2:
                    home_part = parts[0].strip()
                    away_part = parts[1].strip()
                    away_part = re.sub(r"\s*FIFA\s*STREAM\d*$", "", away_part, flags=re.I)

                    time_casa, jogador_casa = extrair_time_jogador(home_part)
                    time_fora, jogador_fora = extrair_time_jogador(away_part)

                    if jogador_casa and jogador_fora and horario_atual and data_atual:
                        jogos.append(
                            {
                                "horario": horario_atual,
                                "data": data_atual,
                                "time_casa": time_casa,
                                "jogador_casa": jogador_casa,
                                "time_fora": time_fora,
                                "jogador_fora": jogador_fora,
                                "P1": jogador_casa,
                                "P2": jogador_fora,
                            }
                        )
                continue

            # Fallback: LeagueRepublic às vezes não deixa explícito o "v" na linha após limpeza.
            if re.search(r"FIFA\s*STREAM", line, flags=re.I):
                # pega as duas primeiras ocorrências de "Time (Jogador)"
                chunks = re.findall(r"[^()]+\([^)]+\)", line)
                if len(chunks) >= 2 and horario_atual and data_atual:
                    home_part = chunks[0].strip()
                    away_part = chunks[1].strip()
                    time_casa, jogador_casa = extrair_time_jogador(home_part)
                    time_fora, jogador_fora = extrair_time_jogador(away_part)
                    if jogador_casa and jogador_fora:
                        jogos.append(
                            {
                                "horario": horario_atual,
                                "data": data_atual,
                                "time_casa": time_casa,
                                "jogador_casa": jogador_casa,
                                "time_fora": time_fora,
                                "jogador_fora": jogador_fora,
                                "P1": jogador_casa,
                                "P2": jogador_fora,
                            }
                        )
        except Exception:
            continue

    # Ajuste de virada de dia por conversão UTC->BRT:
    # se o horário BRT for maior que o horário original, significa que estourou para o dia anterior.
    # Como perdemos o horário original no texto, usamos heurística:
    # - para horários BRT >= 21:00 (muito comuns em virada), o evento pode pertencer ao dia anterior.
    # Mantemos a data como está para evitar deslocamentos errados; corrigimos apenas se a data estiver vazia.
    return jogos


def _scrape_via_requests() -> List[Dict] | None:
    try:
        import requests
        session = requests.Session()
        for attempt in (1, 2):
            try:
                r = session.get(URL, headers=REQUESTS_HEADERS, timeout=12, allow_redirects=True)
                html = r.text or ""
                lowered = html.lower()

                if r.status_code != 200 or len(html) < 2000 or _looks_like_challenge(lowered):
                    continue

                # Fonte real dos jogos: widgets do LeagueRepublic (evita depender do layout/JS do WP)
                lrcodes = _extract_lrcodes_from_page_html(html)
                if lrcodes:
                    jogos_lr = _scrape_from_leaguerepublic(session, lrcodes)
                    if jogos_lr:
                        return jogos_lr

                body_text = _extract_body_text_from_html(html)
                looks = _looks_like_schedule(body_text)
                if not looks:
                    continue

                jogos = _parse_schedule_from_text(body_text)
                return jogos if jogos else None
            except Exception as e:
                continue

        return None
    except Exception as e:
        return None


def _scrape_via_playwright() -> List[Dict]:
    jogos: List[Dict] = []
    with sync_playwright() as p:
        browser = p.chromium.launch(
            headless=True,
            args=[
                "--disable-blink-features=AutomationControlled",
                "--no-sandbox",
            ],
        )

        context = browser.new_context(
            viewport={"width": 1920, "height": 1080},
            user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            locale="pt-BR",
            timezone_id="America/Sao_Paulo",
        )
        page = context.new_page()

        # Bloquear recursos pesados para reduzir chance de timeout
        try:
            page.route(
                "**/*",
                lambda route, request: route.abort()
                if request.resource_type in ("image", "media", "font", "stylesheet")
                else route.continue_(),
            )
        except Exception:
            pass

        page.add_init_script(
            """
            Object.defineProperty(navigator, "webdriver", {get: () => undefined});
            """
        )

        try:
            # Evita travar esperando "load"
            page.goto(URL, timeout=60000, wait_until="commit")
            try:
                page.wait_for_load_state("domcontentloaded", timeout=15000)
            except Exception:
                pass
        except Exception as e:
            browser.close()
            raise

        try:
            html = page.content()
            body_text = _extract_body_text_from_html(html)
        except Exception as e:
            browser.close()
            raise
        finally:
            browser.close()

    jogos = _parse_schedule_from_text(body_text)
    return jogos


def ajustar_horario_para_brt(horario: str) -> str:
    """Converte horário UTC para BRT (Brasil). Subtrai 3 horas.

    O site eadriaticleague.com retorna horários em UTC, precisamos converter
    para o fuso horário do Brasil (UTC-3).

    Exemplos:
        "01:15" (UTC) -> "22:15" (BRT, dia anterior)
        "03:00" (UTC) -> "00:00" (BRT)
        "15:00" (UTC) -> "12:00" (BRT)
    """
    try:
        hora, minuto = map(int, horario.split(":"))
        nova_hora = hora - 3  # UTC para BRT (UTC-3)

        if nova_hora < 0:
            nova_hora += 24

        return f"{nova_hora:02d}:{minuto:02d}"
    except (ValueError, AttributeError):
        # Se falhar o parse, retorna o original
        return horario


def extrair_time_jogador(texto: str) -> tuple[str, str]:
    """Extrai nome do time e jogador do formato 'Time (Jogador)'.

    Exemplo: 'Manchester City (Odin)' -> ('Manchester City', 'odin')
    """
    match = re.match(r'^(.+?)\s*\(([^)]+)\)$', texto.strip())
    if match:
        time = re.sub(r"\s+", " ", match.group(1)).strip()
        # Nicknames são identificadores: remover whitespace interno evita "edua do"
        jogador = re.sub(r"\s+", "", match.group(2)).strip().lower()
        return time, jogador
    return texto.strip(), ""


def scrape_adriatic_league() -> List[Dict]:
    """Faz scrape da Adriatic League e retorna lista de jogos.

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
    }
    """
    jogos = _scrape_via_requests()
    if jogos is not None and len(jogos) > 0:
        return jogos

    # Fallback Playwright (mais pesado, mas cobre casos com JS/bloqueio leve)
    return _scrape_via_playwright()


if __name__ == "__main__":
    jogos = scrape_adriatic_league()
    print(f"\nTotal: {len(jogos)} jogos")
    if jogos:
        print("\nPrimeiros 5 jogos:")
        for j in jogos[:5]:
            print(f"  {j.get('data', 'N/A')} {j['horario']} | {j['jogador_casa']} ({j['time_casa']}) vs {j['jogador_fora']} ({j['time_fora']})")

    with open("adriatic_league_jogos.json", "w", encoding="utf-8") as f:
        json.dump(jogos, f, ensure_ascii=False, indent=2)
    print("\nSalvo em adriatic_league_jogos.json")
