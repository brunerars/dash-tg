-- 001_favorites_and_grid.sql
-- Tabelas iniciais do subsistema de grade.
-- Rodar manualmente via: psql -U dashgrade -d dash_grade -f migrations/001_favorites_and_grid.sql
-- (ou e aplicado automaticamente no startup da API via create_tables() — o SQL aqui
--  serve como referencia canonica e para CREATE INDEX CONCURRENTLY em producao).

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Favoritos (duplas flagadas).
CREATE TABLE IF NOT EXISTS favorites (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    username        VARCHAR(64)  NOT NULL,
    p1              VARCHAR(128) NOT NULL,
    p2              VARCHAR(128) NOT NULL,
    dupla_display   VARCHAR(300) NOT NULL,
    strategy        VARCHAR(64)  NOT NULL,
    flagged_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    analysis_snapshot JSONB      NOT NULL DEFAULT '{}'::jsonb,
    snapshot_cache_key VARCHAR(128),
    is_active       BOOLEAN      NOT NULL DEFAULT TRUE,
    CONSTRAINT uq_favorites_user_pair_strategy UNIQUE (username, p1, p2, strategy)
);

CREATE INDEX IF NOT EXISTS ix_favorites_username_active
    ON favorites (username) WHERE is_active;

CREATE INDEX IF NOT EXISTS ix_favorites_pair
    ON favorites (p1, p2);

-- Jogos do scraper atrelados a um favorito.
CREATE TABLE IF NOT EXISTS grid_matches (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    favorite_id     UUID NOT NULL REFERENCES favorites(id) ON DELETE CASCADE,
    liga            VARCHAR(32)  NOT NULL,
    event_date      VARCHAR(16),
    event_time      VARCHAR(8),
    event_dt_br     TIMESTAMPTZ,
    home_team       VARCHAR(128),
    home_player     VARCHAR(128),
    away_team       VARCHAR(128),
    away_player     VARCHAR(128),
    match_hash      CHAR(32) NOT NULL,
    raw_event       JSONB NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_grid_match_fav_hash UNIQUE (favorite_id, match_hash)
);

CREATE INDEX IF NOT EXISTS ix_grid_matches_favorite_date
    ON grid_matches (favorite_id, event_date);

CREATE INDEX IF NOT EXISTS ix_grid_matches_dt_br
    ON grid_matches (event_dt_br);
