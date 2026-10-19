/**
 * Main entry point for the scraper.
 *
 * Dispatches to the correct scraper based on the SCRAPER_MODE env var:
 *   - startgg-full:        Full sync of all start.gg data for configured games.
 *   - startgg-incremental: Quick sync of recently updated tournaments/events.
 *
 * Use npm scripts or env vars to select the mode and (optionally) a
 * single GAME_ID.
 */

require('dotenv').config();

const logger = require('./lib/logger');
const { GAMES } = require('./config');
const { runPipeline, releaseActiveLock } = require('./scrapers/startgg/pipeline');
const { pool } = require('./db/postgres');

/**
 * Close the database pool, then exit. An open connection would keep
 * Aurora from pausing, so always go through this instead of process.exit.
 */
async function shutdown(code) {
    try {
        await pool.end();
    } catch {
        // Ignore: we're exiting anyway
    }
    process.exit(code);
}

async function main() {
    const mode = process.env.SCRAPER_MODE || 'startgg-full';
    const gameIdOverride = process.env.GAME_ID ? parseInt(process.env.GAME_ID, 10) : null;

    logger.info('Scraper starting', { mode, gameIdOverride, pid: process.pid });

    try {
        switch (mode) {
            case 'startgg-full': {
                const games = gameIdOverride
                    ? GAMES.filter((g) => g.id === gameIdOverride)
                    : GAMES;

                if (games.length === 0) {
                    logger.error(`No game found for GAME_ID=${gameIdOverride}`);
                    await shutdown(1);
                }

                for (const game of games) {
                    await runPipeline(game.id, game.name, 'full');
                }
                break;
            }

            case 'startgg-incremental': {
                const games = gameIdOverride
                    ? GAMES.filter((g) => g.id === gameIdOverride)
                    : GAMES;

                if (games.length === 0) {
                    logger.error(`No game found for GAME_ID=${gameIdOverride}`);
                    await shutdown(1);
                }

                for (const game of games) {
                    await runPipeline(game.id, game.name, 'incremental');
                }
                break;
            }

            default:
                logger.error(`Unknown SCRAPER_MODE: ${mode}`);
                await shutdown(1);
        }

        logger.info('Scraper finished successfully', { mode });
        await shutdown(0);

    } catch (err) {
        logger.error('Scraper failed', { error: err.message, stack: err.stack });
        await shutdown(1);
    }
}

/**
 * On SIGTERM (ECS stopping the task) or SIGINT (Ctrl-C), release the
 * running game's lock and exit. Progress is already saved after every
 * batch, so the next run resumes from the last saved position.
 */
let stopping = false;
async function handleStopSignal(signal, exitCode) {
    if (stopping) return;
    stopping = true;
    logger.warn(`Received ${signal}, stopping`);
    try {
        await releaseActiveLock(`Stopped by ${signal}`);
    } catch (err) {
        logger.error('Failed to release lock on stop', { error: err.message });
    }
    await shutdown(exitCode);
}

process.on('SIGTERM', () => handleStopSignal('SIGTERM', 143));
process.on('SIGINT', () => handleStopSignal('SIGINT', 130));

main();
