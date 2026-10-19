/**
 * Stage 5: Verify player IDs and fix stale/merged references.
 *
 * start.gg occasionally merges or reassigns player IDs. When this happens,
 * the old player ID returns null from the API, but the player still exists
 * under a new ID. This stage checks ALL player IDs in the database against
 * the API and fixes any that have gone stale.
 *
 * Steps (each saves its progress, so a stopped run resumes where it left off):
 *   1. verify  Query the API in batches to find player IDs that return null
 *   2. fix     For each stale ID: re-resolve via entrant → participant →
 *              player, update references to the new ID, and delete the
 *              orphaned old player row
 *
 * Stale IDs are kept in the staging table between steps.
 */

// Imported as `db` because this file uses local variables named `query`
const db = require('../../../db/postgres');
const logger = require('../../../lib/logger');
const { runSteps } = require('../../../lib/checkpoint');
const { isTransientError } = require('../../../lib/retry');
const { STARTGG } = require('../../../config');
const {
    buildPlayerInfoQuery,
    buildParticipantIdsQuery,
    buildPlayerIdsQuery,
} = require('../queries');

const STAGE = 'playerVerification';

/**
 * @param {StartGGClient} client
 * @param {number} gameId
 * @param {Object} checkpoint
 */
async function verifyPlayers(client, gameId, checkpoint) {
    const startTime = Date.now();

    await runSteps(gameId, STAGE, checkpoint, [
        { name: 'verify', run: (ctx) => findStalePlayerIds(client, ctx) },
        { name: 'fix', run: (ctx) => fixStalePlayers(client, ctx) },
    ]);

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    logger.info(`${STAGE} complete`, { elapsedSeconds: elapsed });
}

// ---------------------------------------------------------------------------
// Steps
// ---------------------------------------------------------------------------

/**
 * Step 1: check every player ID against the API, in player ID order, and
 * record the ones that no longer resolve.
 */
async function findStalePlayerIds(client, ctx) {
    const batchSize = STARTGG.batchSizes.playerDetails.playersPerRequest;
    const [{ n: total }] = await db.query('SELECT COUNT(*) AS n FROM startgg_players');
    let done = ctx.cursor.done ?? 0;
    let afterId = ctx.cursor.afterId ?? 0;
    let staleFound = ctx.cursor.staleFound ?? 0;
    logger.info(`${STAGE}: ${total} player IDs to verify`);

    for (;;) {
        const batch = (await db.query(
            'SELECT playerid FROM startgg_players WHERE playerid > $1 ORDER BY playerid LIMIT $2',
            [afterId, batchSize]
        )).map((r) => r.playerid);
        if (batch.length === 0) break;

        const variables = {};
        batch.forEach((id, j) => { variables[`P${j + 1}`] = id; });
        const data = await client.query(buildPlayerInfoQuery(batch.length), variables, `${STAGE}:verify`);

        const stale = batch.filter((_, j) => !data[`P${j + 1}`]);
        staleFound += stale.length;
        afterId = batch[batch.length - 1];
        done += batch.length;

        await ctx.save(
            { cursor: { afterId, done, staleFound }, progress: { done, total } },
            (tx) => ctx.staging.put('stale', stale.map((id) => ({ id })), tx)
        );
        logger.progress(STAGE, done, total, { staleFoundSoFar: staleFound });
    }
}

/** Step 2: fix each recorded stale player ID, one at a time. */
async function fixStalePlayers(client, ctx) {
    let fixed = ctx.cursor.fixed ?? 0;
    let failed = ctx.cursor.failed ?? 0;
    const total = await ctx.staging.count('stale');

    for (;;) {
        const [stale] = await ctx.staging.read('stale', { pending: true, limit: 1 });
        if (!stale) break;
        const oldPlayerId = stale.id;

        logger.info(`${STAGE}: fixing stale player ${fixed + failed + 1}/${total} (ID: ${oldPlayerId})`);
        try {
            const newPlayerId = await resolveNewPlayerId(client, oldPlayerId);

            if (!newPlayerId) {
                logger.warn(`${STAGE}: could not resolve new ID for player ${oldPlayerId}`);
                failed++;
            } else {
                logger.info(`${STAGE}: remapping player ${oldPlayerId} → ${newPlayerId}`);
                await ensurePlayerExists(client, newPlayerId);
                await remapPlayerReferences(oldPlayerId, newPlayerId);
                await deleteOrphanedPlayer(oldPlayerId);
                fixed++;
            }
        } catch (err) {
            // start.gg unreachable: stop here, this player is retried on resume
            if (isTransientError(err)) throw err;
            logger.error(`${STAGE}: failed to fix player ${oldPlayerId}`, { error: err.message });
            failed++;
        }

        await ctx.save(
            { cursor: { fixed, failed }, progress: { done: fixed + failed, total } },
            (tx) => ctx.staging.put('stale', [{ id: oldPlayerId, done: true }], tx)
        );
    }

    logger.info(`${STAGE}: stale players`, { detected: total, fixed, failed });
}

// ---------------------------------------------------------------------------
// Sub-steps
// ---------------------------------------------------------------------------

/**
 * For a stale player ID, find the correct new player ID by re-resolving
 * through an entrant that previously pointed to this player.
 *
 * Chain: entrant → participant → player (via live API)
 */
async function resolveNewPlayerId(client, oldPlayerId) {
    // Find entrants that reference this old player ID via the junction table
    let entrants = [];
    try {
        entrants = await db.query(
            // Try a few in case some are also broken
            'SELECT entrantid FROM startgg_entrant_players WHERE playerid = $1 LIMIT 5',
            [oldPlayerId]
        );
    } catch {
        entrants = [];
    }

    if (entrants.length === 0) {
        logger.warn(`${STAGE}: no entrants found for stale player ${oldPlayerId}`);
        return null;
    }

    // Try each entrant until we get a valid resolution
    for (const entrant of entrants) {
        // entrant → participant
        const participantQuery = buildParticipantIdsQuery(1);
        const participantData = await client.query(
            participantQuery,
            { E1: entrant.entrantid },
            `${STAGE}:resolveParticipant`
        );

        const participantId = participantData.E1?.participants?.[0]?.id;
        if (!participantId) continue;

        // participant → player
        const playerQuery = buildPlayerIdsQuery(1);
        const playerData = await client.query(
            playerQuery,
            { P1: participantId },
            `${STAGE}:resolvePlayer`
        );

        const newPlayerId = playerData.P1?.player?.id;
        if (newPlayerId && newPlayerId !== oldPlayerId) {
            return newPlayerId;
        }
    }

    return null;
}

/**
 * Ensure the new player ID exists in startgg_players.
 * If it already exists, this is a no-op. Otherwise, fetch and insert.
 */
async function ensurePlayerExists(client, playerId) {
    const [existing] = await db.query(
        'SELECT playerid FROM startgg_players WHERE playerid = $1',
        [playerId]
    );

    if (existing) return; // Already exists

    // Fetch from API and insert
    const query = buildPlayerInfoQuery(1);
    const apiData = await client.query(query, { P1: playerId }, `${STAGE}:fetchPlayer`);

    const player = apiData.P1;
    if (!player) {
        throw new Error(`New player ID ${playerId} also returns null from API`);
    }

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

    try {
        await db.upsert('startgg_players', [{
            playerid: player.id,
            gamertag: player.gamerTag,
            slug,
            profilepicture: profilePicture,
        }], ['playerid']);
    } catch (err) {
        throw new Error(`Failed to upsert new player ${playerId}: ${err.message}`);
    }
}

/**
 * Update all FK references from oldPlayerId → newPlayerId across all tables.
 * With the entrant-based schema, player references only exist in:
 *   - startgg_entrant_players (junction table)
 *   - startgg_playerstats
 *   - startgg_headtoheadplayerstats
 */
async function remapPlayerReferences(oldPlayerId, newPlayerId) {
    // 1. startgg_entrant_players — update junction table
    //    We need to handle potential conflicts: if the new player ID already
    //    has a row for the same entrant, we delete the old row instead.
    //    All steps run in one transaction, so a failure part-way through
    //    leaves the old references intact instead of half-remapped.
    const client = await db.pool.connect();
    try {
        await client.query('BEGIN');

        // Drop old links where the new player is already linked to the same entrant
        await client.query(
            `DELETE FROM startgg_entrant_players old
              WHERE old.playerid = $1
                AND EXISTS (SELECT 1 FROM startgg_entrant_players new
                             WHERE new.entrantid = old.entrantid AND new.playerid = $2)`,
            [oldPlayerId, newPlayerId]
        );
        // Point the remaining links at the new player
        await client.query(
            'UPDATE startgg_entrant_players SET playerid = $2 WHERE playerid = $1',
            [oldPlayerId, newPlayerId]
        );

        // 2. startgg_playerstats — stats will be recalculated, no need to merge
        await client.query('DELETE FROM startgg_playerstats WHERE playerid = $1', [oldPlayerId]);

        // 3. startgg_headtoheadplayerstats — H2H stats will be recalculated
        await client.query(
            'DELETE FROM startgg_headtoheadplayerstats WHERE playeroneid = $1 OR playertwoid = $1',
            [oldPlayerId]
        );

        await client.query('COMMIT');
    } catch (err) {
        await client.query('ROLLBACK');
        throw new Error(`Failed to remap player ${oldPlayerId}: ${err.message}`);
    } finally {
        client.release();
    }

    logger.info(`${STAGE}: remapped all references from ${oldPlayerId} → ${newPlayerId}`);
}

/**
 * Delete the orphaned old player row, but only if no references remain.
 */
async function deleteOrphanedPlayer(oldPlayerId) {
    // Verify no remaining references in the junction table
    const remainingLinks = await db.query(
        'SELECT entrantid FROM startgg_entrant_players WHERE playerid = $1 LIMIT 1',
        [oldPlayerId]
    );

    if (remainingLinks.length > 0) {
        logger.warn(`${STAGE}: skipping delete of player ${oldPlayerId} — references remain`);
        return;
    }

    try {
        await db.query('DELETE FROM startgg_players WHERE playerid = $1', [oldPlayerId]);
        logger.info(`${STAGE}: deleted orphaned player ${oldPlayerId}`);
    } catch (err) {
        logger.warn(`${STAGE}: failed to delete orphaned player ${oldPlayerId}`, {
            error: err.message,
        });
    }
}

module.exports = { verifyPlayers };
