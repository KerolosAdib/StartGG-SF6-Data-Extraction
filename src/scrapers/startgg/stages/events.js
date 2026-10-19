/**
 * Stage 2: Fetch events for tournaments and upsert to Postgres.
 *
 * For each tournament, queries start.gg for its events filtered by video game.
 * Compares updatedAt to detect changed events.
 * Saves its position after every batch so a stopped run resumes from it.
 */

// Imported as `db` because this file uses a local variable named `query`
const db = require('../../../db/postgres');
const logger = require('../../../lib/logger');
const { runSteps } = require('../../../lib/checkpoint');
const { STARTGG } = require('../../../config');
const { buildEventsQuery } = require('../queries');

const STAGE = 'events';
const BATCH_SIZE = STARTGG.batchSizes.eventsFromTournaments.tournamentsPerRequest;

/**
 * @param {StartGGClient} client
 * @param {number} gameId
 * @param {Object} checkpoint
 * @param {boolean} incremental
 */
async function scrapeEvents(client, gameId, checkpoint, incremental = false) {
    await runSteps(gameId, STAGE, checkpoint, [
        { name: 'fetchEvents', run: (ctx) => fetchEvents(client, ctx, incremental) },
    ]);
}

async function fetchEvents(client, ctx, incremental) {
    const startTime = Date.now();
    const gameId = ctx.gameId;

    // Tournament IDs to process, after the saved position
    const allTournamentIds = await getTournamentIds(gameId, incremental, ctx.checkpoint);
    const after = ctx.cursor.lastTournamentId ?? 0;
    const tournamentIds = allTournamentIds.filter((id) => id > after);
    logger.info(`${STAGE}: ${tournamentIds.length} of ${allTournamentIds.length} tournaments to check`);

    const updatedEventIds = new Set();
    let totalUpserted = 0;

    for (let i = 0; i < tournamentIds.length; i += BATCH_SIZE) {
        const batchIds = tournamentIds.slice(i, i + BATCH_SIZE);

        // Load existing events for these tournaments
        const existingMap = await loadExistingEvents(batchIds);

        // Build query variables
        const variables = { videogameId: gameId };
        for (let j = 0; j < batchIds.length; j++) {
            variables[`T${j + 1}`] = batchIds[j];
        }

        const query = buildEventsQuery(batchIds.length);
        const data = await client.query(query, variables, `${STAGE}:batch`);

        const eventObjects = [];

        for (const key in data) {
            const tournament = data[key];
            if (!tournament || !tournament.events) continue;

            for (const event of tournament.events) {
                // Skip unchanged
                const existing = existingMap[event.id];
                if (existing && existing.getTime() / 1000 >= event.updatedAt) {
                    continue;
                }

                eventObjects.push({
                    eventid: event.id,
                    tournamentid: tournament.id,
                    eventname: event.name,
                    slug: event.slug,
                    numentrants: event.numEntrants,
                    startdate: event.startAt
                        ? new Date(event.startAt * 1000).toISOString()
                        : null,
                    latestupdate: new Date(event.updatedAt * 1000).toISOString(),
                    videogameid: gameId,
                    synced_at: null, // Reset so entrants + sets stages reprocess this event
                });

                updatedEventIds.add(event.id);
            }
        }

        // Save the batch and the position together
        try {
            await ctx.save(
                {
                    cursor: { lastTournamentId: batchIds[batchIds.length - 1] },
                    progress: { done: i + batchIds.length, total: tournamentIds.length },
                },
                async (tx) => {
                    if (eventObjects.length > 0) await db.upsert('startgg_events', eventObjects, ['eventid'], tx);
                }
            );
        } catch (err) {
            throw new Error(`Event upsert failed: ${err.message}`);
        }
        totalUpserted += eventObjects.length;

        logger.progress(STAGE, i + batchIds.length, tournamentIds.length, {
            upserted: totalUpserted,
        });
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    logger.info(`${STAGE} complete`, {
        totalUpserted,
        updatedEvents: updatedEventIds.size,
        elapsedSeconds: elapsed,
    });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Get tournament IDs to check for events.
 * Full sync: all tournaments.
 * Incremental: only recently updated tournaments.
 */
async function getTournamentIds(gameId, incremental, checkpoint) {
    const ids = [];
    let from = 0;
    const pageSize = 1000;
    let hasMore = true;

    // For incremental: use last_full_sync_at if available, otherwise
    // fall back to a 7-day lookback (matching the tournaments stage).
    let incrementalCutoff = null;
    if (incremental) {
        if (checkpoint.last_full_sync_at) {
            incrementalCutoff = checkpoint.last_full_sync_at;
        } else {
            incrementalCutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
        }
    }

    while (hasMore) {
        let data;
        try {
            data = incrementalCutoff
                ? await db.query(
                    `SELECT tournamentid FROM startgg_tournaments
                     WHERE latestupdate >= $1
                     ORDER BY tournamentid LIMIT $2 OFFSET $3`,
                    [incrementalCutoff, pageSize, from]
                )
                : await db.query(
                    `SELECT tournamentid FROM startgg_tournaments
                     ORDER BY tournamentid LIMIT $1 OFFSET $2`,
                    [pageSize, from]
                );
        } catch (err) {
            throw new Error(`Failed to load tournament IDs: ${err.message}`);
        }
        for (const row of data) ids.push(row.tournamentid);
        hasMore = data.length === pageSize;
        from += pageSize;
    }

    return ids;
}

async function loadExistingEvents(tournamentIds) {
    const map = {};
    let data;
    try {
        // One query for the whole batch instead of one per tournament
        data = await db.query(
            `SELECT eventid, latestupdate FROM startgg_events
             WHERE tournamentid = ANY($1)`,
            [tournamentIds]
        );
    } catch {
        // Same as before: on failure, treat events as new and re-upsert them
        return map;
    }
    for (const row of data) {
        map[row.eventid] = row.latestupdate ? new Date(row.latestupdate) : new Date(0);
    }
    return map;
}

module.exports = { scrapeEvents };
