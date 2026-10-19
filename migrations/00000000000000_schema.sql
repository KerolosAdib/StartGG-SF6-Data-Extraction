-- Initial schema: all tables in FK-safe order + v2 updates + indexes.
-- Applied by scripts/migrate.js.

BEGIN;

-- =============================================================================
-- 1. Base tables (FK-safe order)
-- =============================================================================

CREATE TABLE IF NOT EXISTS startgg_videogames (
    id BIGINT PRIMARY KEY NOT NULL,
    name VARCHAR(255) NOT NULL
);

CREATE TABLE IF NOT EXISTS startgg_players (
    playerid INT PRIMARY KEY NOT NULL,
    gamertag VARCHAR(255) NOT NULL,
    slug VARCHAR(255),
    profilepicture VARCHAR(500)
);

CREATE TABLE IF NOT EXISTS startgg_tournaments (
    tournamentid INT PRIMARY KEY NOT NULL,
    tournamentname VARCHAR(255),
    slug VARCHAR(255) NOT NULL,
    startdate TIMESTAMP,
    createdat TIMESTAMP,
    latestupdate TIMESTAMP
);

CREATE TABLE IF NOT EXISTS startgg_events (
    eventid INT PRIMARY KEY NOT NULL,
    tournamentid INT REFERENCES startgg_tournaments(tournamentid),
    eventname VARCHAR(255),
    slug VARCHAR(255) NOT NULL,
    videogameid BIGINT NOT NULL REFERENCES startgg_videogames(id),
    numentrants INTEGER,
    startdate TIMESTAMP,
    latestupdate TIMESTAMP,
    synced_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS startgg_sets (
    setid INT PRIMARY KEY NOT NULL,
    eventid INT REFERENCES startgg_events(eventid),
    playeroneid INT REFERENCES startgg_players(playerid),
    playertwoid INT REFERENCES startgg_players(playerid),
    playeronewins INT,
    playertwowins INT,
    winnerid INT,
    hasdq BOOLEAN
);

CREATE TABLE IF NOT EXISTS startgg_playerstats (
    playerid INT PRIMARY KEY REFERENCES startgg_players(playerid),
    totalsetwins INT DEFAULT 0 CHECK (totalsetwins >= 0),
    totalsetlosses INT DEFAULT 0 CHECK (totalsetlosses >= 0),
    totalgamewins INT DEFAULT 0 CHECK (totalgamewins >= 0),
    totalgamelosses INT DEFAULT 0 CHECK (totalgamelosses >= 0)
);

CREATE TABLE IF NOT EXISTS startgg_headtoheadplayerstats (
    playeroneid INT REFERENCES startgg_players(playerid),
    playertwoid INT REFERENCES startgg_players(playerid),
    playeronesetwins INT DEFAULT 0 CHECK (playeronesetwins >= 0),
    playertwosetwins INT DEFAULT 0 CHECK (playertwosetwins >= 0),
    playeronegamewins INT DEFAULT 0 CHECK (playeronegamewins >= 0),
    playertwogamewins INT DEFAULT 0 CHECK (playertwogamewins >= 0),
    PRIMARY KEY (playeroneid, playertwoid),
    CONSTRAINT stats_playersetids_check CHECK (playeroneid != playertwoid)
);

CREATE TABLE IF NOT EXISTS startgg_entrants (
    entrantid INTEGER PRIMARY KEY NOT NULL,
    eventid INTEGER REFERENCES startgg_events(eventid),
    playerid INTEGER REFERENCES startgg_players(playerid),
    seed_placement INTEGER,
    final_placement INTEGER,
    is_disqualified BOOLEAN DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS startgg_scraper_meta (
    game_id BIGINT PRIMARY KEY REFERENCES startgg_videogames(id),
    sync_status TEXT NOT NULL DEFAULT 'idle',
    current_stage TEXT,
    stage_cursor JSONB DEFAULT '{}',
    tournament_cursor BIGINT DEFAULT 0,
    last_full_sync_at TIMESTAMPTZ,
    last_incremental_sync_at TIMESTAMPTZ,
    error_message TEXT,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- =============================================================================
-- 2. Indexes
-- =============================================================================

CREATE INDEX IF NOT EXISTS idx_sets_playeroneid ON startgg_sets(playeroneid);
CREATE INDEX IF NOT EXISTS idx_sets_playertwoid ON startgg_sets(playertwoid);
CREATE INDEX IF NOT EXISTS idx_sets_eventid ON startgg_sets(eventid);
CREATE INDEX IF NOT EXISTS idx_sets_winnerid ON startgg_sets(winnerid);

CREATE INDEX IF NOT EXISTS idx_events_tournamentid ON startgg_events(tournamentid);
CREATE INDEX IF NOT EXISTS idx_events_videogameid ON startgg_events(videogameid);
CREATE INDEX IF NOT EXISTS idx_events_latestupdate ON startgg_events(latestupdate);
CREATE INDEX IF NOT EXISTS idx_events_synced_at ON startgg_events(synced_at);

CREATE INDEX IF NOT EXISTS idx_entrants_eventid ON startgg_entrants(eventid);
CREATE INDEX IF NOT EXISTS idx_entrants_playerid ON startgg_entrants(playerid);

CREATE INDEX IF NOT EXISTS idx_tournaments_latestupdate ON startgg_tournaments(latestupdate);

COMMIT;
