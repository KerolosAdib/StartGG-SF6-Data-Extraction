/**
 * Staging storage for data a stage has gathered but not finished with.
 *
 * Rows live in `startgg_scraper_staging`, keyed by game, stage, kind and
 * item ID. Each row has an optional parent ID, a JSONB `data` object and a
 * `done` flag. Stages read their input back from here in item ID order, so
 * a resumed run continues from what was already gathered.
 */

const { query, pool } = require('../db/postgres');

const TABLE = 'startgg_scraper_staging';

/**
 * Staging helpers for one game's stage.
 * @param {number} gameId
 * @param {string} stage
 */
function forStage(gameId, stage) {
    return {
        /**
         * Insert or update rows of one kind.
         * `data` is merged into any existing data, and `done` stays true
         * once set.
         *
         * @param {string} kind
         * @param {Array<{id: number, parent?: number, data?: Object, done?: boolean}>} rows
         * @param {Object} [client] - transaction client
         */
        async put(kind, rows, client = pool) {
            if (!rows.length) return;

            // Merge duplicates so one statement never touches a row twice
            const byId = new Map();
            for (const r of rows) {
                const prev = byId.get(r.id);
                byId.set(r.id, {
                    item_id: r.id,
                    parent_id: r.parent ?? prev?.parent_id ?? null,
                    data: { ...(prev?.data || {}), ...(r.data || {}) },
                    done: Boolean(r.done || prev?.done),
                });
            }

            await query(
                `INSERT INTO ${TABLE} (game_id, stage, kind, item_id, parent_id, data, done)
                 SELECT $1, $2, $3, x.item_id, x.parent_id, x.data, x.done
                 FROM jsonb_to_recordset($4::jsonb)
                      AS x(item_id BIGINT, parent_id BIGINT, data JSONB, done BOOLEAN)
                 ON CONFLICT (game_id, stage, kind, item_id) DO UPDATE SET
                     parent_id = COALESCE(EXCLUDED.parent_id, ${TABLE}.parent_id),
                     data = ${TABLE}.data || EXCLUDED.data,
                     done = ${TABLE}.done OR EXCLUDED.done`,
                [gameId, stage, kind, JSON.stringify([...byId.values()])],
                client
            );
        },

        /**
         * Read rows of one kind in item ID order.
         *
         * @param {string} kind
         * @param {Object} [opts]
         * @param {number} [opts.afterId]  - only rows with a higher item ID
         * @param {number} [opts.limit]
         * @param {boolean} [opts.pending] - only rows not marked done
         * @param {Object} [opts.match]    - only rows whose data contains these values
         * @returns {Promise<Array<{id: number, parent: number, data: Object, done: boolean}>>}
         */
        async read(kind, { afterId = null, limit = 1000, pending = false, match = null } = {}) {
            const params = [gameId, stage, kind, limit];
            let where = 'game_id = $1 AND stage = $2 AND kind = $3';
            if (afterId !== null && afterId !== undefined) {
                params.push(afterId);
                where += ` AND item_id > $${params.length}`;
            }
            if (pending) where += ' AND done = FALSE';
            if (match) {
                params.push(JSON.stringify(match));
                where += ` AND data @> $${params.length}::jsonb`;
            }
            const rows = await query(
                `SELECT item_id, parent_id, data, done FROM ${TABLE}
                 WHERE ${where} ORDER BY item_id LIMIT $4`,
                params
            );
            return rows.map((r) => ({ id: r.item_id, parent: r.parent_id, data: r.data, done: r.done }));
        },

        /** Read rows of one kind by item ID. */
        async getByIds(kind, ids) {
            if (!ids.length) return [];
            const rows = await query(
                `SELECT item_id, parent_id, data, done FROM ${TABLE}
                 WHERE game_id = $1 AND stage = $2 AND kind = $3 AND item_id = ANY($4)`,
                [gameId, stage, kind, ids]
            );
            return rows.map((r) => ({ id: r.item_id, parent: r.parent_id, data: r.data, done: r.done }));
        },

        /** Count rows of one kind, optionally only those not done. */
        async count(kind, { pending = false } = {}) {
            const [row] = await query(
                `SELECT COUNT(*) AS n FROM ${TABLE}
                 WHERE game_id = $1 AND stage = $2 AND kind = $3` +
                (pending ? ' AND done = FALSE' : ''),
                [gameId, stage, kind]
            );
            return row.n;
        },

        /** Remove all of this stage's rows. */
        async clear(client = pool) {
            await query(`DELETE FROM ${TABLE} WHERE game_id = $1 AND stage = $2`, [gameId, stage], client);
        },
    };
}

/** Remove all staging rows for a game. */
async function clearGame(gameId, client = pool) {
    await query(`DELETE FROM ${TABLE} WHERE game_id = $1`, [gameId], client);
}

module.exports = { forStage, clearGame };
