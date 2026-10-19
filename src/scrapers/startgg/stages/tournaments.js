/**
 * Stage 1: Fetch tournaments from start.gg and upsert to Postgres.
 *
 * Paginates through all tournaments for a video game, sorted by startAt.
 * Compares updatedAt with stored values to skip unchanged tournaments.
 * Saves its position after every batch so a stopped run resumes from it,
 * and records tournament_cursor so the next full sync starts from there.
 */

const { query, upsert } = require('../../../db/postgres');
const logger = require('../../../lib/logger');
const { runSteps } = require('../../../lib/checkpoint');
const { STARTGG } = require('../../../config');
const { GET_TOURNAMENTS } = require('../queries');

const STAGE = 'tournaments';

/**
 * @param {StartGGClient} client
 * @param {number} gameId
 * @param {Object} checkpoint  - Current checkpoint row from DB.
 * @param {boolean} incremental - If true, only fetch recent tournaments.
 */
async function scrapeTournaments(client, gameId, checkpoint, incremental = false) {
    await runSteps(gameId, STAGE, checkpoint, [
        { name: 'fetchTournaments', run: (ctx) => fetchTournaments(client, ctx, incremental) },
    ]);
}

async function fetchTournaments(client, ctx, incremental) {
    const startTime = Date.now();
    const gameId = ctx.gameId;

    // Determine starting point: saved position, else a 7-day lookback
    // (incremental) or the last full sync's cursor (full)
    let afterDate;
    if (ctx.cursor.afterDate) {
        afterDate = ctx.cursor.afterDate;
    } else if (incremental) {
        afterDate = Math.floor(Date.now() / 1000) - (7 * 24 * 60 * 60);
    } else {
        afterDate = ctx.checkpoint.tournament_cursor || 1000;
    }

    // Load existing tournaments into a lookup map for change detection
    const existingMap = await loadExistingTournaments();

    let hasMore = true;
    let totalFetched = 0;
    let totalUpserted = 0;

    while (hasMore) {
        const batch = [];

        for (let page = 1; page <= 20 && hasMore; page++) {
            const data = await client.query(GET_TOURNAMENTS, {
                page,
                perPage: STARTGG.batchSizes.tournamentsFromGame.tournamentsPerPage,
                videogameId: gameId,
                afterDate,
            }, `${STAGE}:page${page}`);

            const nodes = data.tournaments.nodes;
            totalFetched += nodes.length;
            hasMore = nodes.length === STARTGG.batchSizes.tournamentsFromGame.tournamentsPerPage;

            for (const t of nodes) {
                // Skip if unchanged
                const existing = existingMap[t.id];
                if (existing && existing.getTime() / 1000 >= t.updatedAt) {
                    continue;
                }

                batch.push({
                    tournamentid: t.id,
                    tournamentname: t.name,
                    slug: t.slug,
                    startdate: epochToISO(t.startAt),
                    createdat: epochToISO(t.createdAt),
                    latestupdate: epochToISO(t.updatedAt),
                });
            }

            // Advance afterDate for next outer loop if we hit the 20-page cap
            if (page === 20 && hasMore) {
                afterDate = nodes[nodes.length - 1].startAt;
            }

            logger.progress(STAGE, totalFetched, '?', {
                page,
                batchSize: batch.length,
            });
        }

        // Save the batch and the position together
        try {
            await ctx.save({ cursor: { afterDate }, progress: { fetched: totalFetched } }, async (tx) => {
                if (batch.length > 0) await upsert('startgg_tournaments', batch, ['tournamentid'], tx);
                if (!incremental) {
                    await query(
                        'UPDATE startgg_scraper_meta SET tournament_cursor = $1 WHERE game_id = $2',
                        [afterDate, gameId],
                        tx
                    );
                }
            });
        } catch (err) {
            throw new Error(`Tournament upsert failed: ${err.message}`);
        }
        totalUpserted += batch.length;

        // Update the lookup map with new entries
        for (const t of batch) {
            existingMap[t.tournamentid] = new Date(t.latestupdate);
        }
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    logger.info(`${STAGE} complete`, {
        totalFetched,
        totalUpserted,
        elapsedSeconds: elapsed,
    });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function loadExistingTournaments() {
    const map = {};
    let from = 0;
    const pageSize = 1000;
    let hasMore = true;

    while (hasMore) {
        let data;
        try {
            data = await query(
                `SELECT tournamentid, latestupdate FROM startgg_tournaments
                 ORDER BY tournamentid LIMIT $1 OFFSET $2`,
                [pageSize, from]
            );
        } catch (err) {
            throw new Error(`Failed to load tournaments: ${err.message}`);
        }

        for (const row of data) {
            map[row.tournamentid] = row.latestupdate ? new Date(row.latestupdate) : new Date(0);
        }

        hasMore = data.length === pageSize;
        from += pageSize;
    }

    return map;
}

function epochToISO(epoch) {
    return epoch ? new Date(epoch * 1000).toISOString() : null;
}

module.exports = { scrapeTournaments };
