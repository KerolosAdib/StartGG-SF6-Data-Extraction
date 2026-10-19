-- Migration 004: Step-level checkpoints and staging for resumable stages.
--
-- Each stage is split into named steps. startgg_scraper_meta records the
-- step a game is on and its exact position within it; startgg_scraper_staging
-- holds the data a stage has gathered so far, so a resumed run continues
-- without fetching it again. A stage's staging rows are removed when the
-- stage completes.

BEGIN;

ALTER TABLE startgg_scraper_meta ADD COLUMN IF NOT EXISTS current_step TEXT;
ALTER TABLE startgg_scraper_meta ADD COLUMN IF NOT EXISTS step_progress JSONB;

CREATE TABLE IF NOT EXISTS startgg_scraper_staging (
    game_id     BIGINT  NOT NULL,
    stage       TEXT    NOT NULL,
    kind        TEXT    NOT NULL,   -- what the row holds, e.g. 'phase', 'set', 'entrant'
    item_id     BIGINT  NOT NULL,   -- start.gg ID of the item
    parent_id   BIGINT,             -- ID of the item it belongs to, e.g. a set's event
    data        JSONB   NOT NULL DEFAULT '{}',
    done        BOOLEAN NOT NULL DEFAULT FALSE,
    PRIMARY KEY (game_id, stage, kind, item_id)
);

CREATE INDEX IF NOT EXISTS idx_scraper_staging_pending
    ON startgg_scraper_staging (game_id, stage, kind, done, item_id);

COMMIT;
