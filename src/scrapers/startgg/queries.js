/**
 * Dynamic GraphQL query builders for the start.gg API.
 *
 * start.gg's API doesn't support batch lookups by ID array, so we pack
 * multiple aliased queries into a single request. For example, to fetch
 * events for 150 tournaments in one call, we generate:
 *
 *   query ($T1: ID! $T2: ID! ... $T150: ID! $gameId: ID!) {
 *       T1: tournament(id: $T1) { events(...) { ... } }
 *       T2: tournament(id: $T2) { events(...) { ... } }
 *       ...
 *   }
 *
 * This is the most API-efficient approach given start.gg's schema.
 */

// ---------------------------------------------------------------------------
// Tournaments (paginated list query — no aliasing needed)
// ---------------------------------------------------------------------------

const GET_TOURNAMENTS = `
    query ($page: Int! $perPage: Int! $videogameId: ID! $afterDate: Timestamp!) {
        tournaments(query: {
            filter: {
                videogameIds: [$videogameId]
                past: true
                afterDate: $afterDate
            }
            page: $page
            perPage: $perPage
            sortBy: "startAt asc"
        }) {
            ...TournamentInfo
        }
    }
    
    fragment TournamentInfo on TournamentConnection {
        nodes {
            id
            name
            slug
            startAt
            createdAt
            updatedAt
        }
    }
`;

// ---------------------------------------------------------------------------
// Helper: generate variable declarations + aliased fields
// ---------------------------------------------------------------------------

function buildAliasedQuery(prefix, count, varDecls, bodyFn) {
    let vars = varDecls.join(' ');
    let fields = '';
    for (let i = 0; i < count; i++) {
        fields += bodyFn(i);
    }
    return `query (${vars}) { ${fields} }`;
}

// ---------------------------------------------------------------------------
// Events for tournaments
// ---------------------------------------------------------------------------

function buildEventsQuery(count) {
    const vars = [];
    for (let i = 0; i < count; i++) vars.push(`$T${i + 1}: ID!`);
    vars.push('$videogameId: ID!');

    let fields = '';
    for (let i = 0; i < count; i++) {
        fields += `
            T${i + 1}: tournament(id: $T${i + 1}) {
                ...TournamentInfo
            }
        `;
    }

    const fragment = `
        fragment TournamentInfo on Tournament {
            id 
            events(filter: { videogameId: [$videogameId], published: true }) {
                id name slug numEntrants startAt updatedAt
            }
        }
    `

    return `query (${vars.join(' ')}) { ${fields} } ${fragment}`;
}

// ---------------------------------------------------------------------------
// Phases for events
// ---------------------------------------------------------------------------

function buildPhasesQuery(count) {
    const vars = [];
    for (let i = 0; i < count; i++) vars.push(`$E${i + 1}: ID!`);

    let fields = '';
    for (let i = 0; i < count; i++) {
        fields += `
            E${i + 1}: event(id: $E${i + 1}) {
                ...EventInfo
            }
        `;
    }

    const fragment = `
        fragment EventInfo on Event {
            id
            phases {
                id
            }
        }
    `

    return `query (${vars.join(' ')}) { ${fields} } ${fragment}`;
}

// ---------------------------------------------------------------------------
// Set IDs from phases
// ---------------------------------------------------------------------------

function buildSetIdsFromPhasesQuery(count) {
    const vars = [];
    for (let i = 0; i < count; i++) {
        vars.push(`$phaseID${i + 1}: ID!`);
        vars.push(`$page${i + 1}: Int!`);
    }
    vars.push('$perPage: Int!');

    let fields = '';
    for (let i = 0; i < count; i++) {
        fields += `
            P${i + 1}: phase(id: $phaseID${i + 1}) {
                id
                sets(page: $page${i + 1} perPage: $perPage) {
                    ...SetInfo
                }
            }
        `;
    }

    const fragment = `
        fragment SetInfo on SetConnection {
            pageInfo { total totalPages }
            nodes { id }
        }
    `

    return `query (${vars.join(' ')}) { ${fields} } ${fragment}`;
}

// ---------------------------------------------------------------------------
// Phase groups from phases (fallback for large phases)
// ---------------------------------------------------------------------------

function buildPhaseGroupsQuery(count) {
    const vars = [];
    for (let i = 0; i < count; i++) vars.push(`$phaseID${i + 1}: ID!`);

    let fields = '';
    for (let i = 0; i < count; i++) {
        fields += `
            Phase${i + 1}: phase(id: $phaseID${i + 1}) {
                id
                ...PhaseInfo
            }
        `;
    }

    const fragment = `
        fragment PhaseInfo on Phase {
            id
            phaseGroups(query: { perPage: 500 }) {
                nodes { id }
            }
        }
    `

    return `query (${vars.join(' ')}) { ${fields} } ${fragment}`;
}

// ---------------------------------------------------------------------------
// Set IDs from phase groups
// ---------------------------------------------------------------------------

function buildSetIdsFromPhaseGroupsQuery(count) {
    const vars = [];
    for (let i = 0; i < count; i++) {
        vars.push(`$groupID${i + 1}: ID!`);
        vars.push(`$page${i + 1}: Int!`);
    }
    vars.push('$perPage: Int!');

    let fields = '';
    for (let i = 0; i < count; i++) {
        fields += `
            PG${i + 1}: phaseGroup(id: $groupID${i + 1}) {
                id
                sets(page: $page${i + 1} perPage: $perPage) {
                    nodes { id }
                }
            }
        `;
    }

    return `query (${vars.join(' ')}) { ${fields} }`;
}

// ---------------------------------------------------------------------------
// Set details
// ---------------------------------------------------------------------------

function buildSetDetailsQuery(count) {
    const vars = [];
    for (let i = 0; i < count; i++) vars.push(`$setID${i + 1}: ID!`);

    let fields = '';
    for (let i = 0; i < count; i++) {
        fields += `
            S${i + 1}: set(id: $setID${i + 1}) {
                ...SetInfo
            }
        `;
    }

    const fragment = `
        fragment SetInfo on Set {
            id
            slots(includeByes: true) {
                entrant {
                    id
                    name
                }
            }
            displayScore(mainEntrantId: -1)
            updatedAt
            completedAt
            winnerId
        }
    `

    return `query (${vars.join(' ')}) { ${fields} } ${fragment}`;
}

function buildGameAndCharacterQuery(count) {
    const vars = [];
    for (let i = 0; i < count; i++) vars.push(`$setID${i + 1}: ID!`);

    let fields = '';
    for (let i = 0; i < count; i++) {
        fields += `
            S${i + 1}: set(id: $setID${i + 1}) {
                ...SetInfo
            }
        `;
    }

    const fragment = `
        fragment SetInfo on Set {
            id
            games {
                selections {
                    entrant {
                        id
                    }
                    character {
                        name
                    }
                }
                winnerId
            }
        }
    `

    return `query (${vars.join(' ')}) { ${fields} } ${fragment}`;
}

// ---------------------------------------------------------------------------
// Entrants for events
// ---------------------------------------------------------------------------

function buildEntrantsQuery(count) {
    const vars = [];
    for (let i = 0; i < count; i++) {
        vars.push(`$E${i + 1}: ID!`);
        vars.push(`$P${i + 1}: Int!`);
    }
    vars.push('$perPage: Int!');

    let fields = '';
    for (let i = 0; i < count; i++) {
        fields += `
            E${i + 1}: event(id: $E${i + 1}) {
                id
                numEntrants
                entrants(query: { perPage: $perPage, page: $P${i + 1} }) {
                    ...EntrantInfo
                }
            }
        `;
    }

    const fragment = `
        fragment EntrantInfo on EntrantConnection {
            pageInfo { totalPages }
            nodes { id }
        }
    `

    return `query (${vars.join(' ')}) { ${fields} } ${fragment}`;
}

// ---------------------------------------------------------------------------
// Participant IDs from entrants
// ---------------------------------------------------------------------------

function buildParticipantIdsQuery(count) {
    const vars = [];
    for (let i = 0; i < count; i++) vars.push(`$E${i + 1}: ID!`);

    let fields = '';
    for (let i = 0; i < count; i++) {
        fields += `
            E${i + 1}: entrant(id: $E${i + 1}) {
                ...EntrantInfo
            }
        `;
    }

    const fragment = `
        fragment EntrantInfo on Entrant {
            id
            participants { id }
        }
    `

    return `query (${vars.join(' ')}) { ${fields} } ${fragment}`;
}

// ---------------------------------------------------------------------------
// Seeding and standing info from entrants
// ---------------------------------------------------------------------------

function buildSeedingStandingQuery(count) {
    const vars = [];
    for (let i = 0; i < count; i++) vars.push(`$E${i + 1}: ID!`);

    let fields = '';
    for (let i = 0; i < count; i++) {
        fields += `
            E${i + 1}: entrant(id: $E${i + 1}) {
                ...EntrantInfo
            }
        `;
    }

    const fragment = `
        fragment EntrantInfo on Entrant {
            id
            isDisqualified
            initialSeedNum
            standing { placement }
        }
    `

    return `query (${vars.join(' ')}) { ${fields} } ${fragment}`;
}

// ---------------------------------------------------------------------------
// Player IDs from participants
// ---------------------------------------------------------------------------

function buildPlayerIdsQuery(count) {
    const vars = [];
    for (let i = 0; i < count; i++) vars.push(`$P${i + 1}: ID!`);

    let fields = '';
    for (let i = 0; i < count; i++) {
        fields += `
            P${i + 1}: participant(id: $P${i + 1}) {
                ...ParticipantInfo
            }
        `;
    }

    const fragment = `
        fragment ParticipantInfo on Participant {
            id
            player { id }
        }
    `

    return `query (${vars.join(' ')}) { ${fields} } ${fragment}`;
}

// ---------------------------------------------------------------------------
// Player info
// ---------------------------------------------------------------------------

function buildPlayerInfoQuery(count) {
    const vars = [];
    for (let i = 0; i < count; i++) vars.push(`$P${i + 1}: ID!`);

    let fields = '';
    for (let i = 0; i < count; i++) {
        fields += `
            P${i + 1}: player(id: $P${i + 1}) {
                ...PlayerInfo
            }
        `;
    }

    const fragment = `
        fragment PlayerInfo on Player {
            id
            gamerTag
            user {
                images(type: "profile") { url }
                slug
            }
        }
    `

    return `query (${vars.join(' ')}) { ${fields} } ${fragment}`;
}

module.exports = {
    GET_TOURNAMENTS,
    buildEventsQuery,
    buildPhasesQuery,
    buildSetIdsFromPhasesQuery,
    buildPhaseGroupsQuery,
    buildSetIdsFromPhaseGroupsQuery,
    buildSetDetailsQuery,
    buildEntrantsQuery,
    buildParticipantIdsQuery,
    buildSeedingStandingQuery,
    buildPlayerIdsQuery,
    buildPlayerInfoQuery,
    buildGameAndCharacterQuery,
};
