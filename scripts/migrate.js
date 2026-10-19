/**
 * Apply database migrations.
 *
 * Runs every .sql file in migrations/, in filename order, that
 * hasn't been applied yet, and records each one in schema_migrations.
 *
 * Databases created before schema_migrations existed already have
 * migrations 000-003 applied. Those are recorded without being run again,
 * because 002 truncates every table.
 *
 * Usage: node scripts/migrate.js
 */

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { pool } = require('../src/db/postgres');

const MIGRATIONS_DIR = path.join(__dirname, '..', 'migrations');
const PRE_TRACKING_MIGRATIONS = [
    '00000000000000_schema.sql',
    '001_schema_updates.sql',
    '002_entrant_based_sets.sql',
    '003_set_game_selections.sql',
];

(async () => {
    await pool.query(`
        CREATE TABLE IF NOT EXISTS schema_migrations (
            filename   TEXT PRIMARY KEY,
            applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )`);

    let { rows: applied } = await pool.query('SELECT filename FROM schema_migrations');

    // Existing database from before migrations were tracked
    if (applied.length === 0) {
        const { rows } = await pool.query(
            "SELECT to_regclass('public.startgg_set_game_selections') AS t"
        );
        if (rows[0].t) {
            for (const file of PRE_TRACKING_MIGRATIONS) {
                await pool.query(
                    'INSERT INTO schema_migrations (filename) VALUES ($1) ON CONFLICT DO NOTHING',
                    [file]
                );
            }
            console.log('Existing schema found; recorded 000-003 as already applied');
            ({ rows: applied } = await pool.query('SELECT filename FROM schema_migrations'));
        }
    }

    const done = new Set(applied.map((r) => r.filename));
    const files = fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
    const pending = files.filter((f) => !done.has(f));

    if (pending.length === 0) {
        console.log('No pending migrations');
    }

    for (const file of pending) {
        const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
        console.log(`Applying ${file}`);
        await pool.query(sql);
        await pool.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [file]);
    }

    await pool.end();
    console.log('Schema ready');
})().catch(async (err) => {
    console.error(err);
    await pool.end();
    process.exit(1);
});
