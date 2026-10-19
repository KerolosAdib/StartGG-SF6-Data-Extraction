/**
 * Checkpoint manager for resumable pipeline execution.
 *
 * Reads and writes sync state to `startgg_scraper_meta` in Postgres.
 * Provides locking to prevent concurrent runs for the same game, and
 * records the stage, step and exact position each game has reached.
 */

const { query, withTransaction } = require('../db/postgres');
const logger = require('./logger');
const staging = require('./staging');
const { STALE_LOCK_HOURS } = require('../config');

const TABLE = 'startgg_scraper_meta';
const STAGE_DONE = '_done';

/**
 * Load the checkpoint for a game, creating it if it doesn't exist.
 * @param {number} gameId
 * @returns {Promise<Object>} The checkpoint row.
 */
async function loadCheckpoint(gameId) {
    try {
        // Create the row if it doesn't exist yet (no-op if it does)
        await query(
            `INSERT INTO ${TABLE} (game_id) VALUES ($1) ON CONFLICT (game_id) DO NOTHING`,
            [gameId]
        );
        const [row] = await query(`SELECT * FROM ${TABLE} WHERE game_id = $1`, [gameId]);
        return row;
    } catch (err) {
        throw new Error(`Failed to load checkpoint: ${err.message}`);
    }
}

/**
 * Acquire a sync lock for a game. Prevents concurrent pipeline runs.
 * Returns true if the lock was acquired, false if another run is active.
 *
 * Stale locks (older than STALE_LOCK_HOURS) are automatically broken.
 *
 * @param {number} gameId
 * @returns {Promise<boolean>}
 */
async function acquireLock(gameId) {
    const checkpoint = await loadCheckpoint(gameId);

    if (checkpoint.sync_status === 'running') {
        const updatedAt = new Date(checkpoint.updated_at);
        const hoursAgo = (Date.now() - updatedAt.getTime()) / (1000 * 60 * 60);

        if (hoursAgo < STALE_LOCK_HOURS) {
            logger.warn(`Lock already held for game ${gameId}`, {
                since: checkpoint.updated_at,
                stage: checkpoint.current_stage,
            });
            return false;
        }
        logger.warn(`Breaking stale lock for game ${gameId}`, {
            staleSince: checkpoint.updated_at,
        });
    }

    try {
        await query(
            `UPDATE ${TABLE}
                SET sync_status = 'running', error_message = NULL, updated_at = NOW()
              WHERE game_id = $1`,
            [gameId]
        );
    } catch (err) {
        throw new Error(`Failed to acquire lock: ${err.message}`);
    }
    return true;
}

const JSON_COLUMNS = new Set(['stage_cursor', 'step_progress']);

/**
 * Update checkpoint columns for a game.
 * @param {number} gameId
 * @param {Object} updates - column → value
 * @param {Object} [client] - transaction client
 */
async function updateCheckpoint(gameId, updates, client) {
    // Column names come from this module's own callers, never from scraped data
    const columns = Object.keys(updates);
    const values = columns.map((col) =>
        JSON_COLUMNS.has(col) && updates[col] !== null ? JSON.stringify(updates[col]) : updates[col]
    );
    const setClause = columns.map((col, i) => `${col} = $${i + 1}`).join(', ');

    try {
        await query(
            `UPDATE ${TABLE}
                SET ${setClause}${columns.length ? ', ' : ''}updated_at = NOW()
              WHERE game_id = $${columns.length + 1}`,
            [...values, gameId],
            client
        );
    } catch (err) {
        throw new Error(`Failed to update checkpoint: ${err.message}`);
    }
}

/**
 * Move a game to a stage and return its checkpoint.
 *
 * If the game is already on this stage (a resumed run), its step and
 * position are kept. Otherwise the step and position are reset and any
 * staging rows left from other stages are removed.
 *
 * @param {number} gameId
 * @param {string} stage
 * @returns {Promise<Object>} The checkpoint row.
 */
async function enterStage(gameId, stage) {
    const cp = await loadCheckpoint(gameId);
    if (cp.current_stage === stage) return cp;

    await withTransaction(async (client) => {
        await staging.clearGame(gameId, client);
        await updateCheckpoint(gameId, {
            current_stage: stage,
            current_step: null,
            stage_cursor: {},
            step_progress: null,
        }, client);
    });
    return loadCheckpoint(gameId);
}

/**
 * Run a stage's steps in order, resuming from the saved step and position.
 *
 * Each step is `{ name, run(ctx) }`. `ctx` provides:
 *   - cursor:  the step's saved position ({} when starting the step)
 *   - staging: staging helpers for this game and stage
 *   - checkpoint: the checkpoint row the stage started with
 *   - save({ cursor, progress }, write): runs write(client) and saves the
 *     new position in one transaction, so data and position always match
 *
 * A checkpoint with no current step (new stage, or written by an older
 * version of the scraper) starts from the first step with empty staging.
 * When the last step finishes, the stage's staging rows are removed.
 *
 * @param {number} gameId
 * @param {string} stage
 * @param {Object} cp - checkpoint row from enterStage()
 * @param {Array<{name: string, run: Function}>} steps
 */
async function runSteps(gameId, stage, cp, steps) {
    const stageStaging = staging.forStage(gameId, stage);

    let startIndex = 0;
    let cursor = {};

    if (cp.current_stage === stage && cp.current_step) {
        if (cp.current_step === STAGE_DONE) return;
        const index = steps.findIndex((s) => s.name === cp.current_step);
        if (index >= 0) {
            startIndex = index;
            cursor = cp.stage_cursor || {};
            logger.info(`${stage}: resuming at step ${cp.current_step}`, { cursor });
        }
    } else {
        await stageStaging.clear();
    }

    for (let i = startIndex; i < steps.length; i++) {
        const step = steps[i];

        if (i > startIndex || Object.keys(cursor).length === 0) {
            cursor = {};
            await updateCheckpoint(gameId, {
                current_stage: stage,
                current_step: step.name,
                stage_cursor: {},
                step_progress: null,
            });
        }

        const ctx = {
            gameId,
            checkpoint: cp,
            staging: stageStaging,
            cursor,
            async save({ cursor: nextCursor = {}, progress = null } = {}, write = null) {
                await withTransaction(async (client) => {
                    if (write) await write(client);
                    await updateCheckpoint(gameId, {
                        current_step: step.name,
                        stage_cursor: nextCursor,
                        step_progress: progress,
                    }, client);
                });
                ctx.cursor = nextCursor;
            },
        };

        logger.info(`${stage}: step ${step.name}`);
        await step.run(ctx);
    }

    await withTransaction(async (client) => {
        await stageStaging.clear(client);
        await updateCheckpoint(gameId, {
            current_step: STAGE_DONE,
            stage_cursor: {},
            step_progress: null,
        }, client);
    });
}

/**
 * Mark the sync as successfully completed.
 * @param {'full'|'incremental'} syncType
 */
async function completeSyncSuccess(gameId, syncType) {
    const timestampField = syncType === 'full'
        ? 'last_full_sync_at'
        : 'last_incremental_sync_at';

    await updateCheckpoint(gameId, {
        sync_status: 'completed',
        current_stage: null,
        current_step: null,
        stage_cursor: {},
        step_progress: null,
        error_message: null,
        [timestampField]: new Date().toISOString(),
    });
}

/**
 * Mark the sync as failed. The stage, step and position are kept so the
 * next run resumes from them.
 */
async function completeSyncFailure(gameId, errorMessage) {
    await updateCheckpoint(gameId, {
        sync_status: 'failed',
        error_message: errorMessage,
    });
}

/**
 * Release the lock without changing the saved position, e.g. when the
 * process is told to stop.
 */
async function releaseLock(gameId, reason = null) {
    await query(
        `UPDATE ${TABLE}
            SET sync_status = 'idle', error_message = $2, updated_at = NOW()
          WHERE game_id = $1 AND sync_status = 'running'`,
        [gameId, reason]
    );
}

module.exports = {
    loadCheckpoint,
    acquireLock,
    updateCheckpoint,
    enterStage,
    runSteps,
    completeSyncSuccess,
    completeSyncFailure,
    releaseLock,
};
