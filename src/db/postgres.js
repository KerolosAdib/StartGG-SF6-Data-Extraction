/**
 * Postgres connection pool for Aurora.
 * Connection settings come from PG* environment variables.
 */
const fs = require('fs');
const { Pool, types, defaults } = require('pg');

// Return BIGINT columns (game IDs, cursors, counts) as numbers.
// Safe for values up to 2^53, far above anything start.gg uses.
types.setTypeParser(20, (val) => parseInt(val, 10));

// Read TIMESTAMP (without time zone) columns as UTC, so change detection
// behaves the same on your PC and in the container.
types.setTypeParser(1114, (val) => new Date(val.replace(' ', 'T') + 'Z'));

// Send JS Dates to Postgres in UTC too. Otherwise pg sends local time
// (e.g. -07:00 on your PC), and TIMESTAMP columns silently drop the offset,
// which would break the incremental-sync cutoff comparisons.
defaults.parseInputDatesAsUTC = true;

const caPath = process.env.DB_SSL_CA; // set in the container

const pool = new Pool({
    max: 5,
    // Aurora takes ~15-30s to wake from a pause, so allow for it
    connectionTimeoutMillis: 45000,
    idleTimeoutMillis: 10000,
    ssl: caPath
        ? { ca: fs.readFileSync(caPath, 'utf8'), rejectUnauthorized: true }
        : false, // local Postgres without SSL
});

/**
 * Run one query and return its rows. Pass a client from withTransaction()
 * to run it inside that transaction.
 */
async function query(text, params = [], client = pool) {
    const result = await client.query(text, params);
    return result.rows;
}

/**
 * Run fn(client) inside a transaction. Commits if fn resolves, rolls back
 * and rethrows if it throws.
 */
async function withTransaction(fn) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const result = await fn(client);
        await client.query('COMMIT');
        return result;
    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw err;
    } finally {
        client.release();
    }
}

/**
 * Insert many rows, updating on conflict.
 * Keeps each statement under Postgres's 65,535-parameter limit.
 */
async function upsert(table, rows, conflictCols, client = pool) {
    if (!rows.length) return;
    const cols = Object.keys(rows[0]);
    const maxRows = Math.floor(60000 / cols.length);
    const updates = cols
        .filter((c) => !conflictCols.includes(c))
        .map((c) => `${c} = EXCLUDED.${c}`)
        .join(', ');

    for (let i = 0; i < rows.length; i += maxRows) {
        const chunk = rows.slice(i, i + maxRows);
        const params = [];
        const values = chunk.map((row) => {
            const slots = cols.map((c) => {
                params.push(row[c] ?? null);
                return `$${params.length}`;
            });
            return `(${slots.join(', ')})`;
        });
        const sql =
            `INSERT INTO ${table} (${cols.join(', ')}) VALUES ${values.join(', ')} ` +
            `ON CONFLICT (${conflictCols.join(', ')}) ` +
            (updates ? `DO UPDATE SET ${updates}` : 'DO NOTHING');
        await client.query(sql, params);
    }
}

/**
 * Plain multi-row insert (no conflict handling).
 * Same batching as upsert.
 */
async function insert(table, rows, client = pool) {
    if (!rows.length) return;
    const cols = Object.keys(rows[0]);
    const maxRows = Math.floor(60000 / cols.length);

    for (let i = 0; i < rows.length; i += maxRows) {
        const chunk = rows.slice(i, i + maxRows);
        const params = [];
        const values = chunk.map((row) => {
            const slots = cols.map((c) => {
                params.push(row[c] ?? null);
                return `$${params.length}`;
            });
            return `(${slots.join(', ')})`;
        });
        await client.query(
            `INSERT INTO ${table} (${cols.join(', ')}) VALUES ${values.join(', ')}`,
            params
        );
    }
}

module.exports = { pool, query, withTransaction, upsert, insert };