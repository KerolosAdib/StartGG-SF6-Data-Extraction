-- Migration 001: Schema updates for the scraper overhaul
-- All statements are idempotent (safe to re-run).

BEGIN;

-- =============================================================================
-- 1. Add missing columns to existing tables
-- =============================================================================

-- Tournament start date was being lost (column didn't exist)
ALTER TABLE startgg_tournaments ADD COLUMN IF NOT EXISTS startdate TIMESTAMP;

-- Track number of entrants per event (useful for ratings weighting + frontend)
ALTER TABLE startgg_events ADD COLUMN IF NOT EXISTS numentrants INTEGER;

-- Track when each event was last fully synced (entrants + sets)
-- Events where synced_at IS NULL OR synced_at < latestupdate need reprocessing.
ALTER TABLE startgg_events ADD COLUMN IF NOT EXISTS synced_at TIMESTAMPTZ;

-- =============================================================================
-- 2. Create startgg_entrants table (replaces missing playereventstats)
-- =============================================================================
-- Stores the entrant→player mapping and per-event player statistics.
-- This table is critical: it provides the link between API entrant IDs
-- and our player IDs, and persists seeding/placement data.

CREATE TABLE IF NOT EXISTS startgg_entrants (
    entrantid   INTEGER PRIMARY KEY NOT NULL,
    eventid     INTEGER REFERENCES startgg_events(eventid),
    playerid    INTEGER REFERENCES startgg_players(playerid),
    seed_placement    INTEGER,
    final_placement   INTEGER,
    is_disqualified   BOOLEAN DEFAULT FALSE
);

-- =============================================================================
-- 3. Redesign scraper_meta for checkpoint/resume
-- =============================================================================
-- The old table had 15 identical, unused rows. Drop and recreate.

DROP TABLE IF EXISTS startgg_scraper_meta;

CREATE TABLE startgg_scraper_meta (
    game_id                     BIGINT PRIMARY KEY REFERENCES startgg_videogames(id),
    sync_status                 TEXT NOT NULL DEFAULT 'idle',       -- idle | running | failed | completed
    current_stage               TEXT,                               -- tournaments | events | entrants | sets
    stage_cursor                JSONB DEFAULT '{}',                 -- stage-specific resume data
    tournament_cursor           BIGINT DEFAULT 0,                   -- afterDate epoch for tournament pagination
    last_full_sync_at           TIMESTAMPTZ,
    last_incremental_sync_at    TIMESTAMPTZ,
    error_message               TEXT,
    updated_at                  TIMESTAMPTZ DEFAULT NOW()
);

-- =============================================================================
-- 4. Add indexes for query performance
-- =============================================================================
-- The sets table (1.1M+ rows) has no indexes beyond the PK.
-- These are critical for the rating system, h2h lookups, and the frontend.

CREATE INDEX IF NOT EXISTS idx_sets_playeroneid    ON startgg_sets(playeroneid);
CREATE INDEX IF NOT EXISTS idx_sets_playertwoid    ON startgg_sets(playertwoid);
CREATE INDEX IF NOT EXISTS idx_sets_eventid        ON startgg_sets(eventid);
CREATE INDEX IF NOT EXISTS idx_sets_winnerid       ON startgg_sets(winnerid);

CREATE INDEX IF NOT EXISTS idx_events_tournamentid ON startgg_events(tournamentid);
CREATE INDEX IF NOT EXISTS idx_events_videogameid  ON startgg_events(videogameid);
CREATE INDEX IF NOT EXISTS idx_events_latestupdate ON startgg_events(latestupdate);
CREATE INDEX IF NOT EXISTS idx_events_synced_at    ON startgg_events(synced_at);

CREATE INDEX IF NOT EXISTS idx_entrants_eventid    ON startgg_entrants(eventid);
CREATE INDEX IF NOT EXISTS idx_entrants_playerid   ON startgg_entrants(playerid);

CREATE INDEX IF NOT EXISTS idx_tournaments_latestupdate ON startgg_tournaments(latestupdate);

-- =============================================================================
-- 5. Create startgg_set_games table (per-game data within a set)
-- =============================================================================
-- Stores individual game results and character selections within a set.
-- Only populated when start.gg has game-level reporting for the set.
-- Character fields are nullable since players don't always report selections.

CREATE TABLE IF NOT EXISTS startgg_set_games (
    id SERIAL PRIMARY KEY,
    setid INT NOT NULL REFERENCES startgg_sets(setid),
    game_number INT NOT NULL,
    winnerid INT REFERENCES startgg_players(playerid),
    player_one_character VARCHAR(255),
    player_two_character VARCHAR(255),
    UNIQUE(setid, game_number)
);

ALTER TABLE startgg_sets ADD COLUMN IF NOT EXISTS latestupdate TIMESTAMP;
ALTER TABLE startgg_sets ADD COLUMN IF NOT EXISTS completedat TIMESTAMP;

CREATE INDEX IF NOT EXISTS idx_set_games_setid ON startgg_set_games(setid);

COMMIT;
