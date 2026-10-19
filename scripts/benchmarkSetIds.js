/**
 * Benchmark the two set-ID queries against the real start.gg API.
 *
 * For every (batch size, per-page) combination it sends REPEATS requests,
 * one at a time, with no retries, and records how long each took, how many
 * set IDs actually came back, and whether it failed (504, timeout, etc.).
 *
 * Each request is logged as one JSON line with "bench": true, so the results
 * can be charted with CloudWatch Logs Insights. A summary table is printed at
 * the end as well.
 *
 * Settings (all optional, via environment variables):
 *   GAME_ID        start.gg videogame ID to sample events from (default 43868, SF6)
 *   BENCH_KIND     phases | groups | both                          (default both)
 *   BATCHES        comma-separated phases/groups per request        (default 10,20,40,80)
 *   PER_PAGES      comma-separated sets per page                    (default 20,40,80)
 *   REPEATS        requests per combination                         (default 5)
 *   TIMEOUT_MS     client-side timeout per request                  (default 90000)
 *   SAMPLE_EVENTS  how many events to sample phases from            (default 150)
 *   SAMPLE_MODE    random | largest: a realistic spread of event sizes,
 *                  or only the biggest events (default random for phases,
 *                  largest for groups)
 *   SEED           changes which events the random sample picks     (default 1)
 *   MIN_PHASE_SETS groups come from phases with more sets than this (default 10000,
 *                  the same threshold the scraper uses for its phase-group fallback)
 *
 * Usage: node scripts/benchmarkSetIds.js
 */

require('dotenv').config();

const { pool, query } = require('../src/db/postgres');
const { STARTGG } = require('../src/config');
const {
    buildPhasesQuery,
    buildPhaseGroupsQuery,
    buildSetIdsFromPhasesQuery,
    buildSetIdsFromPhaseGroupsQuery,
} = require('../src/scrapers/startgg/queries');

const list = (v, d) => (v || d).split(',').map((n) => parseInt(n.trim(), 10)).filter((n) => n > 0);

const GAME_ID = parseInt(process.env.GAME_ID || '43868', 10);
const KIND = process.env.BENCH_KIND || 'both';
const BATCHES = list(process.env.BATCHES, '10,20,40,80');
const PER_PAGES = list(process.env.PER_PAGES, '20,40,80');
const REPEATS = parseInt(process.env.REPEATS || '5', 10);
const TIMEOUT_MS = parseInt(process.env.TIMEOUT_MS || '90000', 10);
const SAMPLE_EVENTS = parseInt(process.env.SAMPLE_EVENTS || '150', 10);
// random  = a spread of event sizes, like a real full run (most phases are small)
// largest = only the biggest events, the worst case for timeouts
const SAMPLE_MODE = process.env.SAMPLE_MODE || (KIND === 'groups' ? 'largest' : 'random');
const SEED = process.env.SEED || '1'; // same seed = same random sample, so runs are comparable
// Groups are sampled from phases bigger than this (the scraper's fallback threshold)
const MIN_PHASE_SETS = parseInt(process.env.MIN_PHASE_SETS || '10000', 10);
const TOKEN = process.env.START_GG_AUTH_TOKEN;

// Stay under start.gg's rate limit: at least 1.1 s between request starts
const MIN_GAP_MS = 1100;
let lastStart = 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** One raw request: no retries, so failures show up as failures. */
async function send(gqlQuery, variables) {
    const wait = lastStart + MIN_GAP_MS - Date.now();
    if (wait > 0) await sleep(wait);
    lastStart = Date.now();

    const started = Date.now();
    try {
        const res = await fetch(STARTGG.apiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
            body: JSON.stringify({ query: gqlQuery, variables }),
            signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        const text = await res.text();
        const ms = Date.now() - started;
        if (!res.ok) return { ok: false, ms, status: res.status, bytes: text.length };
        const json = JSON.parse(text);
        if (json.errors && !json.data) {
            return { ok: false, ms, status: 'graphql', bytes: text.length,
                error: json.errors.map((e) => e.message).join('; ').slice(0, 200) };
        }
        return { ok: true, ms, status: res.status, bytes: text.length, data: json.data,
            complexity: json.extensions?.queryComplexity ?? null };
    } catch (err) {
        return { ok: false, ms: Date.now() - started,
            status: err.name === 'TimeoutError' ? 'timeout' : 'network', error: err.message };
    }
}

/** Run a setup query in chunks, retrying a couple of times if start.gg hiccups. */
async function setup(builder, ids, varName, chunk) {
    const results = [];
    for (let i = 0; i < ids.length; i += chunk) {
        const part = ids.slice(i, i + chunk);
        const vars = {};
        part.forEach((id, j) => { vars[`${varName}${j + 1}`] = id; });
        let r;
        for (let attempt = 0; attempt < 3; attempt++) {
            r = await send(builder(part.length), vars);
            if (r.ok) break;
        }
        if (!r.ok) throw new Error(`Setup query failed: ${r.status} ${r.error || ''}`);
        results.push(...Object.values(r.data).filter(Boolean));
    }
    return results;
}

function countReturned(data) {
    let n = 0;
    for (const v of Object.values(data || {})) n += v?.sets?.nodes?.length || 0;
    return n;
}

/**
 * How many phases (or groups) in the response are fully fetched by this one
 * request, i.e. won't need a second page. In a real run these drop out of the
 * queue, so "finished per second" is how fast you work through 40,000 phases.
 */
function countFinished(data, perPage) {
    let n = 0;
    for (const v of Object.values(data || {})) {
        if (!v?.sets) continue;
        const pages = v.sets.pageInfo?.totalPages;
        if (pages != null ? pages <= 1 : (v.sets.nodes?.length || 0) < perPage) n++;
    }
    return n;
}

const pct = (arr, p) => {
    if (!arr.length) return null;
    const s = [...arr].sort((a, b) => a - b);
    return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
};

async function runGrid(kind, idPool, builder, varName) {
    const summary = [];
    for (const batch of BATCHES) {
        for (const perPage of PER_PAGES) {
            const rows = [];
            for (let r = 0; r < REPEATS; r++) {
                // Each repeat uses a different slice of the sample, so one
                // unusually large phase doesn't decide the whole result
                const start = (r * batch) % idPool.length;
                const ids = [];
                for (let k = 0; k < batch; k++) ids.push(idPool[(start + k) % idPool.length]);

                const vars = { perPage };
                ids.forEach((id, j) => { vars[`${varName}${j + 1}`] = id; vars[`page${j + 1}`] = 1; });

                // A 429 means start.gg's rate limit, not a result for this
                // batch size: wait it out and retry the same request
                let res = await send(builder(batch), vars);
                for (let wait = 0; res.status === 429 && wait < 5; wait++) {
                    console.log(JSON.stringify({ benchRateLimited: true, batch, perPage, waitSeconds: 60 }));
                    await sleep(60000);
                    res = await send(builder(batch), vars);
                }
                const row = {
                    bench: true, kind, gameId: GAME_ID, batch, perPage, repeat: r + 1,
                    ok: res.ok, status: res.status, ms: res.ms, bytes: res.bytes ?? 0,
                    returned: res.ok ? countReturned(res.data) : 0,
                    finished: res.ok ? countFinished(res.data, perPage) : 0,
                    reportedComplexity: res.complexity ?? null,
                    ...(res.error ? { error: res.error } : {}),
                };
                console.log(JSON.stringify(row));
                rows.push(row);
            }
            const okRows = rows.filter((x) => x.ok);
            summary.push({
                kind, batch, perPage,
                ok: `${okRows.length}/${rows.length}`,
                p50_s: okRows.length ? (pct(okRows.map((x) => x.ms), 50) / 1000).toFixed(1) : '-',
                p95_s: okRows.length ? (pct(okRows.map((x) => x.ms), 95) / 1000).toFixed(1) : '-',
                max_s: (Math.max(0, ...rows.map((x) => x.ms)) / 1000).toFixed(1),
                avgReturned: okRows.length ? Math.round(okRows.reduce((a, x) => a + x.returned, 0) / okRows.length) : 0,
                // Throughput: set IDs fetched per second of waiting (higher = faster full run)
                idsPerSec: okRows.length
                    ? Math.round(okRows.reduce((a, x) => a + x.returned, 0) / (okRows.reduce((a, x) => a + x.ms, 0) / 1000))
                    : 0,
                // Phases (or groups) per request that needed only this one page
                avgFinished: okRows.length
                    ? +(okRows.reduce((a, x) => a + x.finished, 0) / okRows.length).toFixed(1)
                    : 0,
                // Throughput through the phase list: phases completed per second
                finishedPerSec: okRows.length
                    ? +(okRows.reduce((a, x) => a + x.finished, 0) / (okRows.reduce((a, x) => a + x.ms, 0) / 1000)).toFixed(1)
                    : 0,
                failures: rows.filter((x) => !x.ok).map((x) => x.status).join(',') || '-',
            });
        }
    }
    return summary;
}

(async () => {
    if (!TOKEN) throw new Error('Missing START_GG_AUTH_TOKEN');
    console.log(JSON.stringify({ benchConfig: true, GAME_ID, KIND, BATCHES, PER_PAGES, REPEATS, TIMEOUT_MS, SAMPLE_EVENTS, SAMPLE_MODE, SEED, MIN_PHASE_SETS }));

    // Pick events: the biggest ones (worst case) or a fixed pseudo-random
    // spread of sizes (what a real full run looks like). md5 of the ID plus a
    // seed gives a random-looking order that's identical between runs.
    const events = SAMPLE_MODE === 'largest'
        ? await query(
            `SELECT eventid FROM startgg_events
             WHERE videogameid = $1 AND numentrants IS NOT NULL
             ORDER BY numentrants DESC LIMIT $2`,
            [GAME_ID, SAMPLE_EVENTS])
        : await query(
            `SELECT eventid FROM startgg_events
             WHERE videogameid = $1
             ORDER BY md5(eventid::text || $3) LIMIT $2`,
            [GAME_ID, SAMPLE_EVENTS, SEED]);
    if (!events.length) throw new Error(`No events stored for game ${GAME_ID}; run the events stage first`);

    const eventData = await setup(buildPhasesQuery, events.map((e) => e.eventid), 'E', 50);
    const phaseIds = eventData.flatMap((e) => (e.phases || []).map((p) => p.id));
    console.log(JSON.stringify({ benchSetup: true, events: events.length, phases: phaseIds.length }));

    const summary = [];
    if (KIND === 'phases' || KIND === 'both') {
        summary.push(...await runGrid('phases', phaseIds, buildSetIdsFromPhasesQuery, 'phaseID'));
    }
    if (KIND === 'groups' || KIND === 'both') {
        // The scraper only uses phase groups for phases over 10,000 sets, so
        // benchmark the groups of those phases, not every small bracket's.
        // Set counts per phase, 10 phases per request:
        const sizes = [];
        for (let i = 0; i < phaseIds.length; i += 10) {
            const part = phaseIds.slice(i, i + 10);
            const fields = part.map((id, j) =>
                `P${j}: phase(id: $p${j}) { id sets(page: 1, perPage: 1) { pageInfo { total } } }`).join(' ');
            const varDefs = part.map((_, j) => `$p${j}: ID!`).join(' ');
            const vars = {};
            part.forEach((id, j) => { vars[`p${j}`] = id; });
            const r = await send(`query (${varDefs}) { ${fields} }`, vars);
            if (!r.ok) continue;
            for (const ph of Object.values(r.data)) {
                if (ph) sizes.push({ id: ph.id, sets: ph.sets?.pageInfo?.total || 0 });
            }
        }
        sizes.sort((x, y) => y.sets - x.sets);
        let bigPhases = sizes.filter((x) => x.sets > MIN_PHASE_SETS);
        if (bigPhases.length === 0) {
            // None over the threshold in this sample: use the 10 largest instead
            bigPhases = sizes.slice(0, 10);
        }
        console.log(JSON.stringify({ benchSetup: true, groupSourcePhases: bigPhases.length,
            minPhaseSets: MIN_PHASE_SETS, largestPhaseSets: sizes[0]?.sets ?? 0 }));

        const phaseData = await setup(buildPhaseGroupsQuery, bigPhases.map((x) => x.id), 'phaseID', 10);
        const groupIds = phaseData.flatMap((p) => (p.phaseGroups?.nodes || []).map((g) => g.id));
        console.log(JSON.stringify({ benchSetup: true, phaseGroups: groupIds.length }));
        summary.push(...await runGrid('groups', groupIds, buildSetIdsFromPhaseGroupsQuery, 'groupID'));
    }

    console.log('\n=== Summary (times are for successful requests) ===');
    console.table(summary);
    await pool.end();
})().catch(async (err) => {
    console.error(err);
    await pool.end();
    process.exit(1);
});
