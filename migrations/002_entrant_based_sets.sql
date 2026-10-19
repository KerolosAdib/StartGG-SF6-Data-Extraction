-- Migration 002: Switch sets to reference entrants instead of players directly.
--
-- Changes:
--   1. Clear all data from affected tables (FK-safe order)
--   2. Create startgg_entrant_players junction table (entrant → players)
--   3. Remove playerid column from startgg_entrants
--   4. Replace playeroneid/playertwoid on startgg_sets with entrantoneid/entranttwoid
--   5. Change winnerid on startgg_sets from player reference to entrant reference
--   6. Change winnerid on startgg_set_games from player reference to entrant reference
--   7. Update indexes
--
-- WARNING: This migration clears all data. Rerun the scraper after applying.

BEGIN;

-- =============================================================================
-- 1. Clear all data (FK-safe order: children first)
-- =============================================================================

-- start.gg stats
TRUNCATE TABLE startgg_headtoheadplayerstats CASCADE;
TRUNCATE TABLE startgg_playerstats CASCADE;

-- start.gg core (children → parents)
TRUNCATE TABLE startgg_set_games CASCADE;
TRUNCATE TABLE startgg_sets CASCADE;
TRUNCATE TABLE startgg_entrants CASCADE;
TRUNCATE TABLE startgg_scraper_meta CASCADE;
TRUNCATE TABLE startgg_events CASCADE;
TRUNCATE TABLE startgg_tournaments CASCADE;
TRUNCATE TABLE startgg_players CASCADE;
TRUNCATE TABLE startgg_videogames CASCADE;

-- =============================================================================
-- 2. Create junction table: startgg_entrant_players
-- =============================================================================

CREATE TABLE startgg_entrant_players (
    entrantid   INTEGER NOT NULL REFERENCES startgg_entrants(entrantid),
    playerid    INTEGER NOT NULL REFERENCES startgg_players(playerid),
    PRIMARY KEY (entrantid, playerid)
);

CREATE INDEX idx_entrant_players_playerid ON startgg_entrant_players(playerid);

-- =============================================================================
-- 3. Remove playerid column from startgg_entrants
-- =============================================================================

DROP INDEX IF EXISTS idx_entrants_playerid;
ALTER TABLE startgg_entrants DROP COLUMN playerid;

-- =============================================================================
-- 4. Replace player references with entrant references on startgg_sets
-- =============================================================================

DROP INDEX IF EXISTS idx_sets_playeroneid;
DROP INDEX IF EXISTS idx_sets_playertwoid;
DROP INDEX IF EXISTS idx_sets_winnerid;

ALTER TABLE startgg_sets DROP COLUMN playeroneid;
ALTER TABLE startgg_sets DROP COLUMN playertwoid;
ALTER TABLE startgg_sets DROP COLUMN winnerid;

ALTER TABLE startgg_sets ADD COLUMN entrantoneid INTEGER REFERENCES startgg_entrants(entrantid);
ALTER TABLE startgg_sets ADD COLUMN entranttwoid INTEGER REFERENCES startgg_entrants(entrantid);
ALTER TABLE startgg_sets ADD COLUMN winnerid INTEGER REFERENCES startgg_entrants(entrantid);

CREATE INDEX idx_sets_entrantoneid ON startgg_sets(entrantoneid);
CREATE INDEX idx_sets_entranttwoid ON startgg_sets(entranttwoid);
CREATE INDEX idx_sets_winnerid ON startgg_sets(winnerid);

-- =============================================================================
-- 5. Convert winnerid on startgg_set_games from player to entrant reference
-- =============================================================================

ALTER TABLE startgg_set_games DROP COLUMN winnerid;
ALTER TABLE startgg_set_games ADD COLUMN winnerid INTEGER REFERENCES startgg_entrants(entrantid);

COMMIT;
