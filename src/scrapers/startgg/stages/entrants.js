/**
 * Stage 3: Fetch entrants, resolve them to players, and upsert.
 *
 * Steps (each saves its progress after every request, so a stopped run
 * resumes where it left off):
 *   1. entrantIds     Entrant IDs of every unsynced event
 *   2. participants   Participant IDs of each entrant
 *   3. playerIds      Player ID of each participant
 *   4. seeding        Seed, placement and DQ status of each entrant
 *   5. newPlayers     Info for players not yet in startgg_players
 *   6. saveEntrants   startgg_entrants rows and entrant-player links
 *
 * Gathered IDs are kept in the staging table between steps.
 */

// Imported as `db` because this file uses local variables named `query`
const db = require('../../../db/postgres');
const logger = require('../../../lib/logger');
const { runSteps } = require('../../../lib/checkpoint');
const { STARTGG } = require('../../../config');
const {
    buildEntrantsQuery,
    buildParticipantIdsQuery,
    buildPlayerIdsQuery,
    buildSeedingStandingQuery,
    buildPlayerInfoQuery,
} = require('../queries');

const STAGE = 'entrants';
const SIZES = STARTGG.batchSizes;
const SAVE_BATCH = 500;

/**
 * @param {StartGGClient} client
 * @param {number} gameId
 * @param {Object} checkpoint
 * @returns {Promise<void>}
 */
async function scrapeEntrants(client, gameId, checkpoint) {
    const startTime = Date.now();

    await runSteps(gameId, STAGE, checkpoint, [
        { name: 'entrantIds', run: (ctx) => fetchEntrantIds(client, ctx) },
        { name: 'participants', run: (ctx) => resolveParticipants(client, ctx) },
        { name: 'playerIds', run: (ctx) => resolvePlayers(client, ctx) },
        { name: 'seeding', run: (ctx) => fetchSeedingInfo(client, ctx) },
        { name: 'newPlayers', run: (ctx) => fetchNewPlayers(client, ctx) },
        { name: 'saveEntrants', run: (ctx) => saveEntrants(ctx) },
    ]);

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    logger.info(`${STAGE} complete`, { elapsedSeconds: elapsed });
}

// ---------------------------------------------------------------------------
// Steps
// ---------------------------------------------------------------------------

/** Step 1: record the entrant IDs of every unsynced event. */
async function fetchEntrantIds(client, ctx) {
    const eventIds = await getUnsyncedEventIds(ctx.gameId);
    const after = ctx.cursor.lastEventId ?? 0;
    const remaining = eventIds.filter((id) => id > after);
    const batchSize = SIZES.entrantsFromEvents.eventsPerRequest;
    logger.info(`${STAGE}: fetching entrants for ${remaining.length} of ${eventIds.length} events`);

    let done = eventIds.length - remaining.length;
    for (let i = 0; i < remaining.length; i += batchSize) {
        const batch = remaining.slice(i, i + batchSize);
        const entrantToEvent = {};
        await fetchEntrantIdsForEvents(client, batch, entrantToEvent);

        const rows = Object.entries(entrantToEvent).map(([entrantId, eventId]) => ({
            id: Number(entrantId), parent: eventId,
        }));

        done += batch.length;
        await ctx.save(
            { cursor: { lastEventId: batch[batch.length - 1] }, progress: { done, total: eventIds.length } },
            (tx) => ctx.staging.put('entrant', rows, tx)
        );
        logger.progress(`${STAGE}:fetching`, done, eventIds.length, { entrantIds: rows.length });
    }
}

/**
 * Step 2: resolve entrants to participants. Each entrant's participant IDs
 * are stored on its row, and each participant gets its own row for step 3.
 */
async function resolveParticipants(client, ctx) {
    const batchSize = SIZES.participantsFromEntrants.entrantsPerRequest;
    const total = await ctx.staging.count('entrant');
    let done = ctx.cursor.done ?? 0;
    let afterId = ctx.cursor.afterId ?? null;

    for (;;) {
        const entrants = await ctx.staging.read('entrant', { afterId, limit: batchSize });
        if (entrants.length === 0) break;

        const participantsOf = await fetchParticipants(client, entrants.map((e) => e.id));

        const entrantUpdates = entrants.map((e) => ({
            id: e.id, data: { participants: participantsOf[e.id] || [] },
        }));
        const participantRows = [...new Set(Object.values(participantsOf).flat())].map((id) => ({ id }));

        afterId = entrants[entrants.length - 1].id;
        done += entrants.length;
        await ctx.save({ cursor: { afterId, done }, progress: { done, total } }, async (tx) => {
            await ctx.staging.put('entrant', entrantUpdates, tx);
            await ctx.staging.put('participant', participantRows, tx);
        });
        logger.progress(`${STAGE}:participants`, done, total);
    }
}

/** Step 3: resolve participants to player IDs. */
async function resolvePlayers(client, ctx) {
    const batchSize = SIZES.playersFromParticipants.participantsPerRequest;
    const total = await ctx.staging.count('participant');
    let done = ctx.cursor.done ?? 0;
    let afterId = ctx.cursor.afterId ?? null;

    for (;;) {
        const participants = await ctx.staging.read('participant', { afterId, limit: batchSize });
        if (participants.length === 0) break;

        const variables = {};
        participants.forEach((p, j) => { variables[`P${j + 1}`] = p.id; });
        const data = await client.query(
            buildPlayerIdsQuery(participants.length), variables, `${STAGE}:playerIds`
        );

        const updates = [];
        for (const key in data) {
            const participant = data[key];
            if (participant?.player) {
                updates.push({ id: participant.id, data: { playerId: participant.player.id } });
            }
        }

        afterId = participants[participants.length - 1].id;
        done += participants.length;
        await ctx.save(
            { cursor: { afterId, done }, progress: { done, total } },
            (tx) => ctx.staging.put('participant', updates, tx)
        );
        logger.progress(`${STAGE}:playerIds`, done, total);
    }
}

/** Step 4: fetch seed, placement and DQ status for each entrant. */
async function fetchSeedingInfo(client, ctx) {
    const batchSize = SIZES.standingsFromEntrants.entrantsPerRequest;
    const total = await ctx.staging.count('entrant');
    let done = ctx.cursor.done ?? 0;
    let afterId = ctx.cursor.afterId ?? null;

    for (;;) {
        const entrants = await ctx.staging.read('entrant', { afterId, limit: batchSize });
        if (entrants.length === 0) break;

        const variables = {};
        entrants.forEach((e, j) => { variables[`E${j + 1}`] = e.id; });
        const data = await client.query(
            buildSeedingStandingQuery(entrants.length), variables, `${STAGE}:seeding`
        );

        const updates = [];
        for (const key in data) {
            const entrant = data[key];
            if (!entrant) continue;
            updates.push({
                id: entrant.id,
                data: {
                    seed: entrant.initialSeedNum || null,
                    placement: entrant.standing?.placement || null,
                    isDQ: entrant.isDisqualified || false,
                },
            });
        }

        afterId = entrants[entrants.length - 1].id;
        done += entrants.length;
        await ctx.save(
            { cursor: { afterId, done }, progress: { done, total } },
            (tx) => ctx.staging.put('entrant', updates, tx)
        );
        logger.progress(`${STAGE}:seeding`, done, total);
    }
}

/**
 * Step 5: fetch info for resolved players that aren't in startgg_players
 * yet, and save them.
 */
async function fetchNewPlayers(client, ctx) {
    const batchSize = SIZES.playerDetails.playersPerRequest;
    let afterId = ctx.cursor.afterId ?? 0;

    for (;;) {
        // Next batch of distinct resolved player IDs
        const candidates = (await db.query(
            `SELECT DISTINCT (data->>'playerId')::BIGINT AS playerid
             FROM startgg_scraper_staging
             WHERE game_id = $1 AND stage = $2 AND kind = 'participant'
               AND data ? 'playerId' AND (data->>'playerId')::BIGINT > $3
             ORDER BY 1 LIMIT $4`,
            [ctx.gameId, STAGE, afterId, batchSize]
        )).map((r) => r.playerid);
        if (candidates.length === 0) break;

        const existing = new Set((await db.query(
            'SELECT playerid FROM startgg_players WHERE playerid = ANY($1)', [candidates]
        )).map((r) => r.playerid));
        const newIds = candidates.filter((id) => !existing.has(id));

        const playerRows = newIds.length > 0 ? await fetchPlayerRows(client, newIds) : [];

        afterId = candidates[candidates.length - 1];
        await ctx.save({ cursor: { afterId } }, async (tx) => {
            if (playerRows.length > 0) await db.upsert('startgg_players', playerRows, ['playerid'], tx);
        });
        logger.info(`${STAGE}: saved ${playerRows.length} new players`);
    }
}

/**
 * Step 6: save entrants and their player links. Entrants without a
 * resolved player are skipped, and links to players missing from
 * startgg_players are left out.
 */
async function saveEntrants(ctx) {
    const total = await ctx.staging.count('entrant');
    let done = ctx.cursor.done ?? 0;
    let afterId = ctx.cursor.afterId ?? null;

    for (;;) {
        const entrants = await ctx.staging.read('entrant', { afterId, limit: SAVE_BATCH });
        if (entrants.length === 0) break;

        const participantIds = [...new Set(entrants.flatMap((e) => e.data.participants || []))];
        const playerOf = new Map(
            (await ctx.staging.getByIds('participant', participantIds))
                .filter((p) => p.data.playerId)
                .map((p) => [p.id, p.data.playerId])
        );

        const linkedPlayers = new Map();
        for (const e of entrants) {
            const players = [...new Set((e.data.participants || [])
                .map((pid) => playerOf.get(pid))
                .filter(Boolean))];
            if (players.length > 0) linkedPlayers.set(e.id, players);
        }

        const allPlayers = [...new Set([...linkedPlayers.values()].flat())];
        const knownPlayers = new Set((await db.query(
            'SELECT playerid FROM startgg_players WHERE playerid = ANY($1)', [allPlayers]
        )).map((r) => r.playerid));

        const entrantRows = [];
        const linkRows = [];
        for (const e of entrants) {
            const players = linkedPlayers.get(e.id);
            if (!players) continue;
            entrantRows.push({
                entrantid: e.id,
                eventid: e.parent,
                seed_placement: e.data.seed ?? null,
                final_placement: e.data.placement ?? null,
                is_disqualified: e.data.isDQ ?? false,
            });
            for (const playerId of players) {
                if (knownPlayers.has(playerId)) linkRows.push({ entrantid: e.id, playerid: playerId });
            }
        }

        afterId = entrants[entrants.length - 1].id;
        done += entrants.length;
        await ctx.save({ cursor: { afterId, done }, progress: { done, total } }, async (tx) => {
            if (entrantRows.length > 0) await db.upsert('startgg_entrants', entrantRows, ['entrantid'], tx);
            if (linkRows.length > 0) {
                await db.upsert('startgg_entrant_players', linkRows, ['entrantid', 'playerid'], tx);
            }
        });
        logger.progress(`${STAGE}:save`, done, total, { entrants: entrantRows.length });
    }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Fetch entrant IDs for a batch of events in a single query.
 * Events paginate independently — completed events drop out of the
 * active set while others continue to the next page.
 */
async function fetchEntrantIdsForEvents(client, eventIds, entrantToEvent) {
    // Initialize page counters for all events
    const pages = {}; // eventId → current page
    for (const id of eventIds) {
        pages[id] = 1;
    }

    while (Object.keys(pages).length > 0) {
        const activeIds = Object.keys(pages);
        const query = buildEntrantsQuery(activeIds.length);

        const variables = { perPage: STARTGG.batchSizes.entrantsFromEvents.entrantsPerPage };
        for (let j = 0; j < activeIds.length; j++) {
            variables[`E${j + 1}`] = activeIds[j];
            variables[`P${j + 1}`] = pages[activeIds[j]];
        }

        const data = await client.query(query, variables, `${STAGE}:entrants`);

        for (let j = 0; j < activeIds.length; j++) {
            const key = `E${j + 1}`;
            const event = data[key];
            const eventId = Number(activeIds[j]);

            if (!event || !event.entrants) {
                delete pages[activeIds[j]];
                continue;
            }

            for (const node of event.entrants.nodes) {
                entrantToEvent[node.id] = eventId;
            }

            if (pages[activeIds[j]] < event.entrants.pageInfo.totalPages) {
                pages[activeIds[j]]++;
            } else {
                delete pages[activeIds[j]];
            }
        }
    }
}

/**
 * Resolve entrant IDs to participant IDs.
 * If a batch fails it's split in half and each half retried.
 * @returns {Promise<Object>} entrantId → [participantId, ...]
 */
async function fetchParticipants(client, entrantIds) {
    const participantsOf = {};

    async function fetchBatch(batch) {
        const variables = {};
        for (let j = 0; j < batch.length; j++) {
            variables[`E${j + 1}`] = batch[j];
        }

        let data;
        try {
            const query = buildParticipantIdsQuery(batch.length);
            data = await client.query(query, variables, `${STAGE}:participants`);
        } catch (err) {
            // Splitting can't help while start.gg is unreachable
            if (err.outage) throw err;
            if (batch.length > 1) {
                const mid = Math.ceil(batch.length / 2);
                logger.warn(`${STAGE}:participants batch of ${batch.length} failed, splitting`, {
                    error: err.message,
                });
                await fetchBatch(batch.slice(0, mid));
                await fetchBatch(batch.slice(mid));
                return;
            }
            throw err;
        }

        for (const key in data) {
            const entrant = data[key];
            if (!entrant?.participants) continue;
            for (const participant of entrant.participants) {
                if (!participant?.id) continue;
                (participantsOf[entrant.id] ||= []).push(participant.id);
            }
        }
    }

    await fetchBatch(entrantIds);
    return participantsOf;
}

/** Fetch player info and build startgg_players rows. */
async function fetchPlayerRows(client, playerIds) {
    const variables = {};
    playerIds.forEach((id, j) => { variables[`P${j + 1}`] = id; });
    const data = await client.query(buildPlayerInfoQuery(playerIds.length), variables, `${STAGE}:playerInfo`);

    const rows = [];
    for (const key in data) {
        const player = data[key];
        if (!player) continue;

        let slug = null;
        let profilePicture = null;
        if (player.user) {
            slug = player.user.slug || null;
            if (player.user.images?.[0]?.url) {
                try {
                    const parsed = new URL(player.user.images[0].url);
                    profilePicture = `${parsed.origin}${parsed.pathname}`;
                } catch { /* ignore bad URLs */ }
            }
        }

        rows.push({
            playerid: player.id,
            gamertag: player.gamerTag,
            slug,
            profilepicture: profilePicture,
        });
    }
    return rows;
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

async function getUnsyncedEventIds(gameId) {
    // Events with synced_at NULL: new events, and events the events stage
    // found updated (it clears synced_at when it upserts a newer version).
    const rows = await db.query(
        `SELECT eventid FROM startgg_events
         WHERE videogameid = $1 AND synced_at IS NULL
         ORDER BY eventid`,
        [gameId]
    );
    return rows.map((r) => r.eventid);
}

module.exports = { scrapeEntrants };
