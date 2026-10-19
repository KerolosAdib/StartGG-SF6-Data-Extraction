/**
 * start.gg pipeline orchestrator.
 *
 * Runs five pipeline stages in order for a single game:
 *   1. Tournaments
 *   2. Events
 *   3. Entrants (+ players)
 *   4. Sets
 *   5. Player Verification (detect and fix merged/stale player IDs)
 *
 * Supports two modes:
 *   - Full sync:        Process everything from the tournament cursor onward.
 *   - Incremental sync: Only process recently updated tournaments/events.
 *
 * Each stage is split into steps that save their position and gathered data
 * as they go, so a run that stops for any reason resumes where it left off.
 */

const logger = require('../../lib/logger');
const checkpoint = require('../../lib/checkpoint');
const { upsert } = require('../../db/postgres');
const StartGGClient = require('./client');

const { scrapeTournaments } = require('./stages/tournaments');
const { scrapeEvents } = require('./stages/events');
const { scrapeEntrants } = require('./stages/entrants');
const { scrapeSets } = require('./stages/sets');
const { verifyPlayers } = require('./stages/playerVerification');

const STAGES = ['tournaments', 'events', 'entrants', 'sets', 'playerVerification'];

let activeGameId = null;

/**
 * Run the full start.gg pipeline for a single game.
 *
 * @param {number}  gameId      - start.gg video game ID.
 * @param {string}  gameName    - Display name for logging.
 * @param {'full'|'incremental'} syncType
 */
async function runPipeline(gameId, gameName, syncType = 'full') {
    const pipelineStart = Date.now();
    const incremental = syncType === 'incremental';

    logger.info(`Pipeline starting`, { gameId, gameName, syncType });

    // Ensure the video game exists in the DB
    await ensureVideogame(gameId, gameName);

    // Acquire lock
    const locked = await checkpoint.acquireLock(gameId);
    if (!locked) {
        logger.warn('Pipeline skipped — another run is active', { gameId });
        return;
    }
    activeGameId = gameId;

    try {
        const cp = await checkpoint.loadCheckpoint(gameId);

        // Determine which stage to resume from
        const resumeStage = cp.current_stage || STAGES[0];
        const resumeIndex = STAGES.indexOf(resumeStage);
        const startIndex = resumeIndex >= 0 ? resumeIndex : 0;

        const client = new StartGGClient(process.env.START_GG_AUTH_TOKEN);

        for (let i = startIndex; i < STAGES.length; i++) {
            const stage = STAGES[i];
            const freshCp = await checkpoint.enterStage(gameId, stage);

            logger.info(`Starting stage: ${stage}`, { gameId, syncType });

            switch (stage) {
                case 'tournaments':
                    await scrapeTournaments(client, gameId, freshCp, incremental);
                    break;
                case 'events':
                    await scrapeEvents(client, gameId, freshCp, incremental);
                    break;
                case 'entrants':
                    await scrapeEntrants(client, gameId, freshCp);
                    break;
                case 'sets':
                    await scrapeSets(client, gameId, freshCp);
                    break;
                case 'playerVerification':
                    await verifyPlayers(client, gameId, freshCp);
                    break;
            }

            logger.info(`Stage complete: ${stage}`, { gameId });
        }

        // All stages done
        await checkpoint.completeSyncSuccess(gameId, syncType);

        const elapsed = ((Date.now() - pipelineStart) / 1000 / 60).toFixed(1);
        const stats = client.getStats();
        logger.info(`Pipeline complete`, {
            gameId,
            gameName,
            syncType,
            elapsedMinutes: elapsed,
            totalApiRequests: stats.totalRequests,
            maxQueryComplexity: stats.maxComplexitySeen,
        });

    } catch (err) {
        logger.error(`Pipeline failed`, {
            gameId,
            stage: (await checkpoint.loadCheckpoint(gameId)).current_stage,
            error: err.message,
            stack: err.stack,
        });
        await checkpoint.completeSyncFailure(gameId, err.message);
        throw err; // Re-throw so the process exits non-zero
    } finally {
        activeGameId = null;
    }
}

/**
 * Release the lock of the game currently running, keeping its saved
 * position. Used when the process is told to stop.
 */
async function releaseActiveLock(reason) {
    if (activeGameId === null) return;
    await checkpoint.releaseLock(activeGameId, reason);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function ensureVideogame(gameId, gameName) {
    try {
        await upsert('startgg_videogames', [{ id: gameId, name: gameName }], ['id']);
    } catch (err) {
        throw new Error(`Failed to upsert videogame: ${err.message}`);
    }
}

module.exports = { runPipeline, releaseActiveLock };
