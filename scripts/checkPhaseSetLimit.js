/**
 * Check whether start.gg still caps how many sets you can page through
 * in a single phase (previously ~10,000), using a known huge event.
 *
 * For each phase of the event it prints the total sets start.gg reports.
 * Then, for the biggest phase and each page size in PER_PAGES, it requests
 * the pages around the 10,000th set, including the one that straddles it
 * when the size doesn't divide 10,000 evenly, and shows how far it got.
 *
 * It then does the same for phase groups: lists every group of every phase
 * (checking the 500-groups-per-phase listing gets them all), finds the
 * biggest group by set count, and runs the same test on it if it's large
 * enough to reach 10,000.
 *
 * Usage:
 *   node scripts/checkPhaseSetLimit.js
 *   EVENT_SLUG=tournament/evo-2023/event/street-fighter-6 node scripts/checkPhaseSetLimit.js
 *   PER_PAGES=160,300 node scripts/checkPhaseSetLimit.js
 */

require('dotenv').config();

const API = 'https://api.start.gg/gql/alpha';
const TOKEN = process.env.START_GG_AUTH_TOKEN;
const SLUG = process.env.EVENT_SLUG || 'tournament/evo-2023/event/street-fighter-6';
const PER_PAGES = (process.env.PER_PAGES || '99,160,150,300,333')
    .split(',').map((n) => parseInt(n.trim(), 10)).filter((n) => n > 0);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function gql(query, variables) {
    await sleep(1100); // stay under the rate limit
    const res = await fetch(API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
        body: JSON.stringify({ query, variables }),
        signal: AbortSignal.timeout(35000),
    });
    const text = await res.text();
    if (!res.ok) return { httpStatus: res.status, body: text.slice(0, 200) };
    return JSON.parse(text);
}

/**
 * For each page size, request the page that straddles the 10,000th set
 * (plus the pages either side). With a size that doesn't divide 10,000
 * evenly, e.g. 160, page 63 covers sets 9,921-10,080: does start.gg return
 * all 160, cut it off at 10,000, or refuse the whole page?
 *
 * @param {'phase'|'phaseGroup'} field - which GraphQL field to page through
 * @param {string|number} id
 */
async function straddleTest(field, id) {
    console.log(`\n${field} ${id}: page that straddles set 10,000, for each page size:\n`);
    for (const perPage of PER_PAGES) {
        const straddle = Math.ceil(10000 / perPage);
        for (const page of [straddle - 1, straddle, straddle + 1]) {
            if (page < 1) continue;
            const first = (page - 1) * perPage + 1;
            const last = page * perPage;
            const r = await gql(
                `query ($id: ID!, $page: Int!, $perPage: Int!) { node: ${field}(id: $id) {
                    sets(page: $page, perPage: $perPage) { nodes { id } } } }`,
                { id, page, perPage }
            );
            const n = r.data?.node?.sets?.nodes?.length;
            const err = r.errors ? r.errors.map((e) => e.message).join('; ') : (r.httpStatus ? `HTTP ${r.httpStatus}` : '');
            const reached = n ? first + n - 1 : null;
            console.log(`  perPage ${String(perPage).padStart(4)}  page ${String(page).padStart(4)}` +
                `  (sets ${first}-${last}): ` +
                (n != null ? `${n} returned` + (reached ? `, up to set #${reached}` : '') : 'no data') +
                (reached > 10000 ? '   <-- PAST 10,000' : '') +
                (err ? `   ERROR: ${err}` : ''));
        }
        console.log('');
    }
}

(async () => {
    if (!TOKEN) throw new Error('Missing START_GG_AUTH_TOKEN');

    const ev = await gql(
        `query ($slug: String) { event(slug: $slug) { id name numEntrants
            phases { id name numSeeds groupCount } } }`,
        { slug: SLUG }
    );
    const event = ev.data?.event;
    if (!event) { console.log('Event not found:', JSON.stringify(ev).slice(0, 300)); return; }
    console.log(`\n${event.name} (event ${event.id}), ${event.numEntrants} entrants\n`);

    // Total sets per phase
    const phases = [];
    for (const p of event.phases) {
        const r = await gql(
            `query ($id: ID!) { phase(id: $id) { sets(page: 1, perPage: 1) { pageInfo { total totalPages } } } }`,
            { id: p.id }
        );
        const total = r.data?.phase?.sets?.pageInfo?.total ?? null;
        phases.push({ ...p, totalSets: total });
        console.log(`  phase ${p.id}  ${p.name.padEnd(20)} seeds=${p.numSeeds}  groups=${p.groupCount}  sets=${total}` +
            (r.errors ? `  ERROR: ${r.errors.map((e) => e.message).join('; ')}` : ''));
    }

    // ---- Phases ----------------------------------------------------------
    const big = phases.filter((p) => p.totalSets).sort((a, b) => b.totalSets - a.totalSets)[0];
    if (!big) return;
    console.log(`\nBiggest phase: ${big.name} (${big.id}), ${big.totalSets} sets reported`);
    if (big.totalSets > 10000) {
        await straddleTest('phase', big.id);
    } else {
        console.log('It has 10,000 sets or fewer, so it can\'t test the phase cap. Try another EVENT_SLUG.');
    }

    // ---- Phase groups ------------------------------------------------------
    // The scraper lists groups with phaseGroups(query: { perPage: 500 }), so
    // also check that every group comes back, not just the first 500.
    console.log('\nPhase groups of each phase:\n');
    let biggestGroup = null;
    for (const p of phases) {
        const r = await gql(
            `query ($id: ID!) { phase(id: $id) { phaseGroups(query: { perPage: 500 }) {
                pageInfo { total } nodes { id displayIdentifier } } } }`,
            { id: p.id }
        );
        const pg = r.data?.phase?.phaseGroups;
        const listed = pg?.nodes?.length ?? 0;
        const total = pg?.pageInfo?.total ?? p.groupCount;
        console.log(`  phase ${p.id}  ${p.name.padEnd(20)} groups listed=${listed}  total=${total}` +
            (total > listed ? '   <-- NOT ALL GROUPS LISTED (more than 500)' : '') +
            (r.errors ? `  ERROR: ${r.errors.map((e) => e.message).join('; ')}` : ''));

        // Set count of every group in this phase, 1.1 s apart, so this is the
        // slow part for huge phases (~200 groups = ~4 minutes)
        for (const g of pg?.nodes || []) {
            const gr = await gql(
                `query ($id: ID!) { phaseGroup(id: $id) { sets(page: 1, perPage: 1) { pageInfo { total } } } }`,
                { id: g.id }
            );
            const sets = gr.data?.phaseGroup?.sets?.pageInfo?.total ?? 0;
            if (!biggestGroup || sets > biggestGroup.sets) {
                biggestGroup = { id: g.id, name: g.displayIdentifier, phase: p.name, sets };
            }
        }
    }

    if (!biggestGroup) return;
    console.log(`\nBiggest phase group: ${biggestGroup.name} in ${biggestGroup.phase} ` +
        `(${biggestGroup.id}), ${biggestGroup.sets} sets`);
    if (biggestGroup.sets > 10000) {
        await straddleTest('phaseGroup', biggestGroup.id);
    } else {
        console.log('No group in this event comes near 10,000 sets, so groups never hit the cap here.');
    }

    console.log('\nIf a straddling page returns its full size, the cap can be stepped past by up to perPage - 1 sets.');
    console.log('If it returns only up to #10,000 or errors, the cap is exact.');
})().catch((err) => { console.error(err); process.exit(1); });
