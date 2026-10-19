/**
 * Stage 4: Fetch sets for events and upsert to Postgres.
 *
 * Steps (each saves its progress after every request, so a stopped run
 * resumes where it left off):
 *   1. phases           Phases of every unsynced event
 *   2. setsFromPhases   Set IDs from each phase, page by page
 *   3. groupsFromPhases Phase groups of phases too large to page through
 *   4. setsFromGroups   Set IDs from those phase groups
 *   5. setDetails       Set details, saved to startgg_sets
 *   6. gamesFromSets    Games and character picks, saved per batch
 *   7. markSynced       Mark the processed events as synced
 *
 * Gathered IDs are kept in the staging table between steps.
 */

// Imported as `db` because this file uses local variables named `query`
const db = require('../../../db/postgres');
const logger = require('../../../lib/logger');
const { runSteps } = require('../../../lib/checkpoint');
const { STARTGG } = require('../../../config');
const {
    buildPhasesQuery,
    buildSetIdsFromPhasesQuery,
    buildPhaseGroupsQuery,
    buildSetIdsFromPhaseGroupsQuery,
    buildSetDetailsQuery,
    buildGameAndCharacterQuery,
} = require('../queries');

const STAGE = 'sets';
const SIZES = STARTGG.batchSizes;

// start.gg refuses to page past the 10,000th set of a phase ("Cannot query
// more than the 10,000th entry"); larger phases are fetched by phase group.
const MAX_SETS_PER_PHASE = 10000;

/**
 * @param {StartGGClient} client
 * @param {number} gameId
 * @param {Object} checkpoint
 */
async function scrapeSets(client, gameId, checkpoint) {
    const startTime = Date.now();

    await runSteps(gameId, STAGE, checkpoint, [
        { name: 'phases', run: (ctx) => fetchPhases(client, ctx) },
        { name: 'setsFromPhases', run: (ctx) => fetchSetIdsFromPhases(client, ctx) },
        { name: 'groupsFromPhases', run: (ctx) => fetchPhaseGroups(client, ctx) },
        { name: 'setsFromGroups', run: (ctx) => fetchSetIdsFromPhaseGroups(client, ctx) },
        { name: 'setDetails', run: (ctx) => fetchSetDetails(client, ctx) },
        { name: 'gamesFromSets', run: (ctx) => fetchGamesAndCharacters(client, ctx) },
        { name: 'markSynced', run: (ctx) => markEventsSynced(ctx) },
    ]);

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    logger.info(`${STAGE} complete`, { elapsedSeconds: elapsed });
}

// ---------------------------------------------------------------------------
// Steps
// ---------------------------------------------------------------------------

/** Step 1: record each unsynced event and its phases. */
async function fetchPhases(client, ctx) {
    const eventIds = await getUnsyncedEventIds(ctx.gameId);
    const after = ctx.cursor.lastEventId ?? 0;
    const remaining = eventIds.filter((id) => id > after);
    const batchSize = SIZES.phasesFromEvents.eventsPerRequest;
    logger.info(`${STAGE}: fetching phases for ${remaining.length} of ${eventIds.length} events`);

    let done = eventIds.length - remaining.length;
    for (let i = 0; i < remaining.length; i += batchSize) {
        const batch = remaining.slice(i, i + batchSize);
        const variables = {};
        batch.forEach((id, j) => { variables[`E${j + 1}`] = id; });

        const data = await client.query(buildPhasesQuery(batch.length), variables, `${STAGE}:phases`);

        const phaseRows = [];
        batch.forEach((eventId, j) => {
            for (const phase of data[`E${j + 1}`]?.phases || []) {
                phaseRows.push({ id: phase.id, parent: eventId, data: { page: 1 } });
            }
        });

        done += batch.length;
        await ctx.save(
            { cursor: { lastEventId: batch[batch.length - 1] }, progress: { done, total: eventIds.length } },
            async (tx) => {
                await ctx.staging.put('event', batch.map((id) => ({ id })), tx);
                await ctx.staging.put('phase', phaseRows, tx);
            }
        );
        logger.progress(`${STAGE}:phases`, done, eventIds.length);
    }
}

/**
 * Step 2: page through each phase's set IDs, a window of phases per request.
 * Each phase's next page is stored on its staging row; finished phases are
 * marked done and replaced by the next ones. Phases over 10,000 sets are
 * marked for the phase-group fallback instead.
 */
async function fetchSetIdsFromPhases(client, ctx) {
    const perRequest = SIZES.setsFromPhases.phasesPerRequest;
    const perPage = SIZES.setsFromPhases.setsPerPage;
    const total = await ctx.staging.count('phase');
    let done = total - await ctx.staging.count('phase', { pending: true });

    for (;;) {
        const active = await ctx.staging.read('phase', { pending: true, limit: perRequest });
        if (active.length === 0) break;

        const variables = { perPage };
        active.forEach((phase, j) => {
            variables[`phaseID${j + 1}`] = phase.id;
            variables[`page${j + 1}`] = phase.data.page || 1;
        });

        const data = await client.query(
            buildSetIdsFromPhasesQuery(active.length), variables, `${STAGE}:setIds`
        );

        const setRows = [];
        const phaseUpdates = [];
        active.forEach((phase, j) => {
            const result = data[`P${j + 1}`];
            if (!result?.sets) {
                phaseUpdates.push({ id: phase.id, done: true, data: { missing: true } });
                done++;
                return;
            }
            if (result.sets.pageInfo.total > MAX_SETS_PER_PHASE) {
                phaseUpdates.push({ id: phase.id, done: true, data: { needsGroups: true } });
                done++;
                return;
            }

            for (const set of result.sets.nodes) {
                if (!set.id.toString().includes('preview')) {
                    setRows.push({ id: set.id, parent: phase.parent });
                }
            }

            const page = phase.data.page || 1;
            if (page < result.sets.pageInfo.totalPages) {
                phaseUpdates.push({ id: phase.id, data: { page: page + 1 } });
            } else {
                phaseUpdates.push({ id: phase.id, done: true });
                done++;
            }
        });

        await ctx.save({ progress: { done, total } }, async (tx) => {
            await ctx.staging.put('set', setRows, tx);
            await ctx.staging.put('phase', phaseUpdates, tx);
        });
        logger.progress(`${STAGE}:setIds`, done, total, { setIds: setRows.length });
    }
}

/** Step 3: list the phase groups of phases marked for the fallback. */
async function fetchPhaseGroups(client, ctx) {
    const batchSize = SIZES.groupsFromPhases.phasesPerRequest;
    let afterId = ctx.cursor.afterId ?? null;

    for (;;) {
        const phases = await ctx.staging.read('phase', {
            afterId, limit: batchSize, match: { needsGroups: true },
        });
        if (phases.length === 0) break;

        const variables = {};
        phases.forEach((phase, j) => { variables[`phaseID${j + 1}`] = phase.id; });
        const data = await client.query(
            buildPhaseGroupsQuery(phases.length), variables, `${STAGE}:phaseGroups`
        );

        const groupRows = [];
        phases.forEach((phase, j) => {
            for (const group of data[`Phase${j + 1}`]?.phaseGroups?.nodes || []) {
                groupRows.push({ id: group.id, parent: phase.id, data: { page: 1, eventId: phase.parent } });
            }
        });

        afterId = phases[phases.length - 1].id;
        await ctx.save({ cursor: { afterId } }, (tx) => ctx.staging.put('group', groupRows, tx));
        logger.info(`${STAGE}: listed ${groupRows.length} phase groups`);
    }
}

/** Step 4: page through each phase group's set IDs. */
async function fetchSetIdsFromPhaseGroups(client, ctx) {
    const perRequest = SIZES.setsFromGroups.groupsPerRequest;
    const perPage = SIZES.setsFromGroups.setsPerPage;
    const total = await ctx.staging.count('group');
    let done = total - await ctx.staging.count('group', { pending: true });

    for (;;) {
        const active = await ctx.staging.read('group', { pending: true, limit: perRequest });
        if (active.length === 0) break;

        const variables = { perPage };
        active.forEach((group, j) => {
            variables[`groupID${j + 1}`] = group.id;
            variables[`page${j + 1}`] = group.data.page || 1;
        });

        const data = await client.query(
            buildSetIdsFromPhaseGroupsQuery(active.length), variables, `${STAGE}:pgSetIds`
        );

        const setRows = [];
        const groupUpdates = [];
        active.forEach((group, j) => {
            const result = data[`PG${j + 1}`];
            if (!result?.sets) {
                groupUpdates.push({ id: group.id, done: true, data: { missing: true } });
                done++;
                return;
            }

            for (const set of result.sets.nodes) {
                if (!set.id.toString().includes('preview')) {
                    setRows.push({ id: set.id, parent: group.data.eventId });
                }
            }

            // A full page means there may be more
            if (result.sets.nodes.length === perPage) {
                groupUpdates.push({ id: group.id, data: { page: (group.data.page || 1) + 1 } });
            } else {
                groupUpdates.push({ id: group.id, done: true });
                done++;
            }
        });

        await ctx.save({ progress: { done, total } }, async (tx) => {
            await ctx.staging.put('set', setRows, tx);
            await ctx.staging.put('group', groupUpdates, tx);
        });
        logger.progress(`${STAGE}:pgSetIds`, done, total, { setIds: setRows.length });
    }
}

/**
 * Step 5: fetch details for each gathered set and save the complete ones
 * whose entrants are both known. Sets that were saved are marked
 * `resolved` for the games step.
 */
async function fetchSetDetails(client, ctx) {
    const batchSize = SIZES.setDetails.setsPerRequest;
    const total = await ctx.staging.count('set');
    let done = ctx.cursor.done ?? 0;
    let afterId = ctx.cursor.afterId ?? null;

    for (;;) {
        const sets = await ctx.staging.read('set', { afterId, limit: batchSize });
        if (sets.length === 0) break;

        const variables = {};
        sets.forEach((set, j) => { variables[`setID${j + 1}`] = set.id; });
        const data = await client.query(
            buildSetDetailsQuery(sets.length), variables, `${STAGE}:setDetails`
        );

        // Entrants of these sets that exist in the DB
        const entrantIds = new Set();
        for (const key in data) {
            for (const slot of data[key]?.slots || []) {
                if (slot.entrant) entrantIds.add(slot.entrant.id);
            }
        }
        const known = new Set(
            (await db.query(
                'SELECT entrantid FROM startgg_entrants WHERE entrantid = ANY($1)',
                [[...entrantIds]]
            )).map((r) => r.entrantid)
        );

        const eventOf = new Map(sets.map((s) => [s.id, s.parent]));
        const setRows = [];
        for (const key in data) {
            const row = buildSetRow(data[key], eventOf, known);
            if (row) setRows.push(row);
        }
        const resolved = new Set(setRows.map((r) => r.setid));

        afterId = sets[sets.length - 1].id;
        done += sets.length;
        await ctx.save({ cursor: { afterId, done }, progress: { done, total } }, async (tx) => {
            if (setRows.length > 0) await db.upsert('startgg_sets', setRows, ['setid'], tx);
            await ctx.staging.put('set', sets.map((s) => ({
                id: s.id, done: true, data: { resolved: resolved.has(s.id) },
            })), tx);
        });
        logger.progress(`${STAGE}:setDetails`, done, total, { saved: setRows.length });
    }
}

/** Build a startgg_sets row, or null if the set is incomplete or unusable. */
function buildSetRow(set, eventOf, knownEntrantIds) {
    if (!set || typeof set.id === 'string') return null; // preview set
    if (!set.winnerId) return null; // not completed

    const entrants = [];
    for (const slot of set.slots || []) {
        if (slot.entrant) entrants.push(slot.entrant.id);
    }
    if (entrants.length !== 2) return null;
    if (!knownEntrantIds.has(entrants[0]) || !knownEntrantIds.has(entrants[1])) return null;

    const { p1Score, p2Score, hasDQ } = parseDisplayScore(
        set.displayScore, set.winnerId, entrants[0], entrants[1]
    );

    let winnerId = null;
    if (set.winnerId === entrants[0]) winnerId = entrants[0];
    else if (set.winnerId === entrants[1]) winnerId = entrants[1];

    return {
        setid: set.id,
        eventid: eventOf.get(set.id),
        entrantoneid: entrants[0],
        entranttwoid: entrants[1],
        playeronewins: p1Score,
        playertwowins: p2Score,
        winnerid: winnerId,
        hasdq: hasDQ,
        latestupdate: set.updatedAt ? new Date(set.updatedAt * 1000).toISOString() : null,
        completedat: set.completedAt ? new Date(set.completedAt * 1000).toISOString() : null,
    };
}

/** Step 6: fetch games and character picks for saved sets. */
async function fetchGamesAndCharacters(client, ctx) {
    const batchSize = SIZES.gamesFromSets.setsPerRequest;
    let done = ctx.cursor.done ?? 0;
    let afterId = ctx.cursor.afterId ?? null;

    for (;;) {
        const sets = await ctx.staging.read('set', { afterId, limit: batchSize, match: { resolved: true } });
        if (sets.length === 0) break;

        const gameRows = [];
        const selectionRows = [];
        await fetchGameCharacterData(client, sets.map((s) => s.id), gameRows, selectionRows);

        afterId = sets[sets.length - 1].id;
        done += sets.length;
        await ctx.save({ cursor: { afterId, done }, progress: { done } }, async (tx) => {
            if (gameRows.length > 0) {
                await db.upsert('startgg_set_games', gameRows, ['setid', 'game_number'], tx);
            }
            if (selectionRows.length > 0) await saveSelections(selectionRows, tx);
        });
        logger.progress(`${STAGE}:gameCharacters`, done, '?', { games: gameRows.length });
    }
}

/** Step 7: mark every event recorded in step 1 as synced. */
async function markEventsSynced(ctx) {
    let afterId = ctx.cursor.afterId ?? null;

    for (;;) {
        const events = await ctx.staging.read('event', { afterId, limit: 500 });
        if (events.length === 0) break;

        afterId = events[events.length - 1].id;
        await ctx.save({ cursor: { afterId } }, (tx) => db.query(
            'UPDATE startgg_events SET synced_at = NOW() WHERE eventid = ANY($1)',
            [events.map((e) => e.id)],
            tx
        ));
    }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Fetch game + character data with dynamic batch splitting.
 * If a query fails (e.g. complexity too high due to sets with many games),
 * the batch is split in half and each half is retried recursively.
 */
async function fetchGameCharacterData(client, setIds, gameRows, selectionRows) {
    async function fetchBatch(batch) {
        const variables = {};
        for (let j = 0; j < batch.length; j++) {
            variables[`setID${j + 1}`] = batch[j];
        }

        let data;
        try {
            const query = buildGameAndCharacterQuery(batch.length);
            data = await client.query(query, variables, `${STAGE}:gameCharacters`);
        } catch (err) {
            // Splitting can't help while start.gg is unreachable
            if (err.outage) throw err;
            if (batch.length > 1) {
                const mid = Math.ceil(batch.length / 2);
                logger.warn(`${STAGE}:gameCharacters batch of ${batch.length} failed, splitting`, {
                    error: err.message,
                });
                await fetchBatch(batch.slice(0, mid));
                await fetchBatch(batch.slice(mid));
                return;
            }
            throw err; // Single set failed — propagate
        }

        for (const key in data) {
            const set = data[key];
            if (!set || !set.games || set.games.length === 0) continue;

            for (let g = 0; g < set.games.length; g++) {
                const game = set.games[g];

                // winnerId from start.gg is already an entrant ID
                gameRows.push({
                    setid: set.id,
                    game_number: g + 1,
                    winnerid: game.winnerId || null,
                });

                for (const selection of game.selections || []) {
                    const entrantId = selection.entrant?.id;
                    const charName = selection.character?.name;
                    if (entrantId && charName) {
                        selectionRows.push({
                            setid: set.id,
                            game_number: g + 1,
                            entrantid: entrantId,
                            character_name: charName,
                        });
                    }
                }
            }
        }
    }

    await fetchBatch(setIds);
}

/**
 * Save character picks, replacing any already stored for the same games.
 * Looks up each game's set_game_id, so the games must be saved first.
 */
async function saveSelections(selectionRows, tx) {
    const setIds = [...new Set(selectionRows.map((r) => r.setid))];
    const setGames = await db.query(
        'SELECT id, setid, game_number FROM startgg_set_games WHERE setid = ANY($1)',
        [setIds],
        tx
    );
    const idLookup = new Map(setGames.map((sg) => [`${sg.setid}_${sg.game_number}`, sg.id]));

    const insertRows = [];
    const setGameIds = new Set();
    for (const row of selectionRows) {
        const setGameId = idLookup.get(`${row.setid}_${row.game_number}`);
        if (!setGameId) continue;
        setGameIds.add(setGameId);
        insertRows.push({
            set_game_id: setGameId,
            entrantid: row.entrantid,
            character_name: row.character_name,
        });
    }
    if (insertRows.length === 0) return;

    await db.query(
        'DELETE FROM startgg_set_game_selections WHERE set_game_id = ANY($1)',
        [[...setGameIds]],
        tx
    );
    await db.insert('startgg_set_game_selections', insertRows, tx);
}

// ---------------------------------------------------------------------------
// Score parsing
// ---------------------------------------------------------------------------

/**
 * Parse start.gg displayScore into numeric game counts.
 *
 * Known formats:
 *   - "3 - 0"              (just numbers)
 *   - "PlayerA 3 - PlayerB 0" (names + numbers)
 *   - "DQ"                 (disqualification)
 *   - Contains "-1"        (forfeit)
 *
 * @returns {{ p1Score: number, p2Score: number, hasDQ: boolean }}
 */
function parseDisplayScore(displayScore, winnerId, entrant1Id, entrant2Id) {
    const result = { p1Score: 0, p2Score: 0, hasDQ: false };

    if (!displayScore) return result;

    // Check for DQ / forfeit
    if (displayScore === 'DQ' || /\b-1\b/.test(displayScore)) {
        result.hasDQ = true;
        return result;
    }

    // Try to extract two numbers from the score string.
    // Match patterns like "3 - 0" or "Name 3 - Name 0"
    const parts = displayScore.split(' - ');
    if (parts.length !== 2) return result;

    // Extract the last number from each part
    const num1 = extractTrailingNumber(parts[0]);
    const num2 = extractTrailingNumber(parts[1]);

    if (num1 === null || num2 === null) return result;

    // Assign scores: winner gets the higher score
    if (winnerId === entrant1Id) {
        result.p1Score = Math.max(num1, num2);
        result.p2Score = Math.min(num1, num2);
    } else if (winnerId === entrant2Id) {
        result.p1Score = Math.min(num1, num2);
        result.p2Score = Math.max(num1, num2);
    }

    return result;
}

/**
 * Extract the trailing number from a score component.
 * "PlayerName 3" → 3
 * "3" → 3
 */
function extractTrailingNumber(str) {
    const trimmed = str.trim();
    const match = trimmed.match(/(\d+)\s*$/);
    if (!match) return null;
    const num = parseInt(match[1], 10);
    return isNaN(num) ? null : num;
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

async function getUnsyncedEventIds(gameId) {
    const rows = await db.query(
        `SELECT eventid FROM startgg_events
         WHERE videogameid = $1 AND synced_at IS NULL
         ORDER BY eventid`,
        [gameId]
    );
    return rows.map((r) => r.eventid);
}

module.exports = { scrapeSets };
