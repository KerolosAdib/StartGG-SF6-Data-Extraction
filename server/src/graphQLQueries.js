const GET_TOURNAMENTS = `
    query ($page: Int! $perPage: Int! $SF6: ID! $AfterDate: Timestamp!) {
        tournaments(
            query: {
                filter: { 
                    videogameIds: [
                        $SF6
                    ]
                    past: true
                    afterDate: $AfterDate
                }
                page: $page
                perPage: $perPage
                sortBy: "startAt asc"
            }
        ) {
            nodes {
                id
                name
                slug
                startAt
                createdAt
                updatedAt
            }
        }
    }
`;

const GET_EVENTS = `
    query ($perPage: Int! $tournamentIDs: [ID]! $SF6: ID!) {
        tournaments(
            query: {
                filter: {
                    ids: $tournamentIDs
                }  
                perPage: $perPage
            }
        ) {
            nodes {
                id
                events(filter: {
                    videogameId: [$SF6]
                    published: true
                    type: 1
                }) {
                    id
                    name
                    slug
                    updatedAt
                    phases {
                        id
                    }
                }
            }
        }
    }
`;

function SetIDQueryCreation(numEvents) {
    let query = `query (`;
    for (let i = 0; i < numEvents; i++) {
        query += `$eventID${i + 1}: ID! $phaseID${i + 1}: ID! $page${
            i + 1
        }: Int! `;
    }

    query += `$perPage: Int!) {`;

    for (let i = 0; i < numEvents; i++) {
        query += `E${i + 1}: event(id: $eventID${i + 1}) {
            id
            sets(page: $page${i + 1} perPage: $perPage filters: {
                phaseIds: [$phaseID${i + 1}]
            }) {
                pageInfo {
                    totalPages
                }
                nodes {
                    id
                }
            }
        }`;
    }
    query += `}`;
    return query;
}

function SetQueryCreation(numSets) {
    let query = `query (`;
    for (let i = 0; i < numSets; i++) {
        query += `$setID${i + 1}: ID! `;
    }

    query += `) {`;

    for (let i = 0; i < numSets; i++) {
        query += `S${i + 1}: set(id: $setID${i + 1}) {
            id
            slots {
                entrant {
                    id
                    name
                }
            }
            displayScore
            winnerId
        }`;
    }
    query += `}`;
    return query;
}

function PlayerQueryCreation(numEvents) {
    let query = `query (`;
    for (let i = 0; i < numEvents; i++) {
        query += `$E${i + 1}: ID! $P${i + 1}: Int! `;
    }

    query += `$perPage: Int!) {`;
    for (let i = 0; i < numEvents; i++) {
        query += `
            E${i + 1}: event(id: $E${i + 1}) {
                id
                entrants(query: {
                    perPage: $perPage
                    page: $P${i + 1}
                }) {
                    nodes {
                        id
                        participants {
                            player {
                                id
                                gamerTag
                                user {
                                    slug
                                }
                            }
                        }
                    }
                }
            }
        `;
    }
    query += `}`;
    return query;
}

function GetPhaseGroupsFromPhasesQuery(numPhases) {
    let query = `query (`;
    for (let i = 0; i < numPhases; i++) {
        query += `$phaseID${i + 1}: ID! `;
    }

    query += `) {`;

    for (let i = 0; i < numPhases; i++) {
        query += `
            Phase${i + 1}: phase(id: $phaseID${i + 1}) {
                id
                phaseGroups(query: {
                    perPage: 500
                }) {
                    nodes {
                        id
                    }
                }
            }
        `;
    }

    query += `}`;
    return query;
}

function RetrieveSetIDsWithPhaseGroups(numPhaseGroups) {
    let query = `query (`;
    for (let i = 0; i < numPhaseGroups; i++) {
        query += `$groupID${i + 1}: ID! $page${i + 1}: Int! `;
    }

    query += `$perPage: Int!) {`;

    for (let i = 0; i < numPhaseGroups; i++) {
        query += `
            PG${i + 1}: phaseGroup(id: $groupID${i + 1}) {
                id
                sets(page: $page${i + 1} perPage: $perPage) {
                    nodes {
                        id
                    }
                }
            }
        `;
    }
    query += `}`;
    return query;
}

module.exports = {
    GET_TOURNAMENTS,
    GET_EVENTS,
    SetIDQueryCreation,
    SetQueryCreation,
    PlayerQueryCreation,
    GetPhaseGroupsFromPhasesQuery,
    RetrieveSetIDsWithPhaseGroups,
};
