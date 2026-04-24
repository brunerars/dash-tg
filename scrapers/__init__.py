# Scrapers V3 - BetChecker
# Ligas eSoccer: Adriatic League, GT League, eBattle League

from .adriatic_league import scrape_adriatic_league
from .gt_league import scrape_gt_league
from .ebattle_league import (
    scrape_ebattle_league,
    fetch_tournaments_from_listing,
    get_matches_for_tournament,
    parse_match,
)

__all__ = [
    "scrape_adriatic_league",
    "scrape_gt_league",
    "scrape_ebattle_league",
    "fetch_tournaments_from_listing",
    "get_matches_for_tournament",
    "parse_match",
]
