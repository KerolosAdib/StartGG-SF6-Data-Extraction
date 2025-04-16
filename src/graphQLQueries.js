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

function EventsQueryCreation(numTournaments) {
    let query = `query (`;
    for (let i = 0; i < numTournaments; i++) {
        query += `$T${i + 1}: ID! `;
    }

    query += `$SF6: ID!) {`;

    for (let i = 0; i < numTournaments; i++) {
        query += `
            T${i + 1}: tournament(id: $T${i + 1}) {
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
                }
            }
        `;
    }
    query += `}`;
    return query;
}

function PhaseQueryCreation(numEvents) {
    let query = `query (`;
    for (let i = 0; i < numEvents; i++) {
        query += `$E${i + 1}: ID! `;
    }

    query += `) {`;

    for (let i = 0; i < numEvents; i++) {
        query += `
            E${i + 1}: event(id: $E${i + 1}) {
                id
                phases {
                    id
                }
            }
        `;
    }
    query += `}`;
    return query;
}

function SetIDQueryCreation(numEvents) {
    let query = `query (`;
    for (let i = 0; i < numEvents; i++) {
        query += `$phaseID${i + 1}: ID! $page${i + 1}: Int! `;
    }

    query += `$perPage: Int!) {`;

    for (let i = 0; i < numEvents; i++) {
        query += `P${i + 1}: phase(id: $phaseID${i + 1}) {
            id
            sets(page: $page${i + 1} perPage: $perPage) {
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
            slots(includeByes: true) {
                entrant {
                    id
                    name
                }
            }
            displayScore(mainEntrantId: -1)
            winnerId
        }`;
    }
    query += `}`;
    return query;
}

function PlayersFromSetsQueryCreation(numSets) {
    let query = `query (`;
    for (let i = 0; i < numSets; i++) {
        query += `$S${i + 1}: ID! `;
    }

    query += `) {`;

    for (let i = 0; i < numSets; i++) {
        query += `S${i + 1}: set(id: $S${i + 1}) {
            id
            event {
                id
            }
            slots(includeByes: true) {
                entrant {
                    id
                    participants {
                        player {
                            id
                            gamerTag
                            user {
                                images(type: "profile") {
                                    url
                                }
                                slug
                            }
                        }
                    }
                }
            }
            displayScore(mainEntrantId: -1)
            winnerId
        }`;
    }
    query += `}`;
    return query;
}

function EntrantQueryCreation(numEvents) {
    let query = `query (`;
    for (let i = 0; i < numEvents; i++) {
        query += `$E${i + 1}: ID! $P${i + 1}: Int! `;
    }

    query += `$perPage: Int!) {`;
    for (let i = 0; i < numEvents; i++) {
        query += `
            E${i + 1}: event(id: $E${i + 1}) {
                id
                numEntrants
                entrants(query: {
                    perPage: $perPage
                    page: $P${i + 1}
                }) {
                    ...EntrantInfo
                }
            }
        `;
    }
    query += `}`;

    query += `
        fragment EntrantInfo on EntrantConnection {
            pageInfo {
                totalPages
            }
            nodes {
                id
            }
        }
    `;

    return query;
}

function RetrieveParticipantIDsQuery(numEntrants) {
    let query = `query (`;
    for (let i = 0; i < numEntrants; i++) {
        query += `$E${i + 1}: ID! `;
    }

    query += `) {`;
    for (let i = 0; i < numEntrants; i++) {
        query += `
            E${i + 1}: entrant(id: $E${i + 1}) {
                id
                participants {
                    id
                }
            }
        `;
    }
    query += `}`;
    return query;
}

function RetrievePlayerIDsQuery(numParticipants) {
    let query = `query (`;
    for (let i = 0; i < numParticipants; i++) {
        query += `$P${i + 1}: ID! `;
    }

    query += `) {`;
    for (let i = 0; i < numParticipants; i++) {
        query += `
            P${i + 1}: participant(id: $P${i + 1}) {
                id
                player {
                    id
                    gamerTag
                    user {
                        images(type: "profile") {
                            url
                        }
                        slug
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

function RetrievePlayerInfoQuery(numPlayers) {
    let query = `query (`;
    for (let i = 0; i < numPlayers; i++) {
        query += `$P${i + 1}: ID! `;
    }

    query += `) {`;

    for (let i = 0; i < numPlayers; i++) {
        query += `
            P${i + 1}: player(id: $P${i + 1}) {
                id
                gamerTag
                user {
                    images(type: "profile") {
                        url
                    }
                    slug
                }
            }
        `;
    }
    query += `}`;
    return query;
}

module.exports = {
    GET_TOURNAMENTS,
    EventsQueryCreation,
    PhaseQueryCreation,
    SetIDQueryCreation,
    PlayersFromSetsQueryCreation,
    SetQueryCreation,
    EntrantQueryCreation,
    RetrieveParticipantIDsQuery,
    RetrievePlayerIDsQuery,
    GetPhaseGroupsFromPhasesQuery,
    RetrieveSetIDsWithPhaseGroups,
    RetrievePlayerInfoQuery,
};
