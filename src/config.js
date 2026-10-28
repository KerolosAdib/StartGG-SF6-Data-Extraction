/**
 * Central configuration for the scraper pipeline.
 * Game IDs come from start.gg's videogame registry.
 */

const GAMES = [
    { id: 43868, name: 'Street Fighter 6' },
        // Future games:
    { id: 49783, name: 'Tekken 8' },
    { id: 33945, name: 'Guilty Gear: Strive' },
    // { id: 287,   name: 'Marvel vs. Capcom Fighting Collection' },
    { id: 64423, name: '2XKO' },
    { id: 50203, name: 'Under Night In-Birth II Sys:Celes'},
    { id: 37, name: 'BlazBlue: Central Fiction'},
    { id: 32, name: 'Skullgirls: 2nd Encore'},
    { id: 48548, name: 'Granblue Fantasy Versus: Rising'}
];

const STARTGG = {
    apiUrl: 'https://api.start.gg/gql/alpha',
    /** Max requests per second to the start.gg API. */
    requestsPerSecond: 1,
    /**
     * When requests keep failing and start.gg doesn't answer a minimal
     * query either, wait for it to come back instead of failing the run.
     */
    outage: {
        probeIntervalSeconds: 60,
        maxWaitMinutes: 30,
    },
    /** start.gg imposes a query complexity ceiling (~1000). Stay under. */
    maxQueryComplexity: 950,
    /**
     * Batch sizes control how many entities are packed into a single
     * GraphQL query via aliases. Higher = fewer requests but higher
     * query complexity. These values are tuned to stay under the limit.
     */
    batchSizes: {
        tournamentsFromGame: {
            tournamentsPerPage: 500,
        },
        eventsFromTournaments: {
            tournamentsPerRequest: 150,
        },
        phasesFromEvents: {
            eventsPerRequest: 200,
        },
        setsFromPhases: {
            phasesPerRequest: 10,
            setsPerPage: 160,
        },
        groupsFromPhases: {
            phasesPerRequest: 200,  // lists each big phase's groups
        },
        setsFromGroups: {
            groupsPerRequest: 10,
            setsPerPage: 80,        // a pool group is ~30 sets, so one page
        },
        setDetails: {
            setsPerRequest: 150,
        },
        gamesFromSets: {
            setsPerRequest: 66,     // splits itself in half if too complex
        },
        entrantsFromEvents: {
            eventsPerRequest: 200,
            entrantsPerPage: 100,
        },
        participantsFromEntrants: {
            entrantsPerRequest: 499,
        },
        playersFromParticipants: {
            participantsPerRequest: 333,
        },
        playerDetails: {
            playersPerRequest: 400,
        },
        standingsFromEntrants: {
            entrantsPerRequest: 249,
        },
    },
};

/**
 * How long a 'running' lock can be stale before we consider it abandoned.
 * If a previous run crashed without clearing its status, the next run
 * will proceed after this timeout.
 */
const STALE_LOCK_HOURS = 12;

/**
 * Before a run starts, keep retrying the database for up to this long,
 * so a paused Aurora cluster has time to resume.
 */
const DATABASE_WAKE = {
    maxWaitSeconds: 300,
    retryIntervalSeconds: 10,
};

/**
 * For incremental syncs: how far back (in seconds) to look for
 * recently started/updated tournaments.
 */
const INCREMENTAL_LOOKBACK_SECONDS = 7 * 24 * 60 * 60; // 7 days

module.exports = {
    GAMES,
    STARTGG,
    STALE_LOCK_HOURS,
    DATABASE_WAKE,
    INCREMENTAL_LOOKBACK_SECONDS,
};
