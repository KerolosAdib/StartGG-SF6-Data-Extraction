-- Migration 003: Replace fixed character columns on startgg_set_games with
-- a selections table to support variable numbers of character picks per game.
--
-- Changes:
--   1. Create startgg_set_game_selections table
--   2. Drop player_one_character and player_two_character from startgg_set_games
--
-- This migration is NOT idempotent — it should only be run once.

BEGIN;

-- =============================================================================
-- 1. Create selections table
-- =============================================================================

CREATE TABLE startgg_set_game_selections (
    id              SERIAL PRIMARY KEY,
    set_game_id     INTEGER NOT NULL REFERENCES startgg_set_games(id) ON DELETE CASCADE,
    entrantid       INTEGER NOT NULL REFERENCES startgg_entrants(entrantid),
    character_name  VARCHAR(255) NOT NULL
);

CREATE INDEX idx_set_game_selections_set_game_id ON startgg_set_game_selections(set_game_id);
CREATE INDEX idx_set_game_selections_entrantid ON startgg_set_game_selections(entrantid);

-- =============================================================================
-- 2. Drop fixed character columns from startgg_set_games
-- =============================================================================

ALTER TABLE startgg_set_games DROP COLUMN player_one_character;
ALTER TABLE startgg_set_games DROP COLUMN player_two_character;

COMMIT;
