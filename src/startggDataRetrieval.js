const PG = require('pg');
const path = require('path');
const fs = require('fs');

const {
    GET_TOURNAMENTS,
    EventsQueryCreation,
    PhaseQueryCreation,
    SetIDQueryCreation,
    SetQueryCreation,
    PlayersFromSetsQueryCreation,
    EntrantQueryCreation,
    RetrieveParticipantIDsQuery,
    RetrievePlayerIDsQuery,
    GetPhaseGroupsFromPhasesQuery,
    RetrieveSetIDsWithPhaseGroups,
    RetrievePlayerInfoQuery,
} = require('./graphQLQueries');

const sqlDir = './src/sql_files/';

require('dotenv').config();

function waitUntil(targetTime) {
    const now = new Date();
    const remainingTime = targetTime.getTime() - now.getTime();

    if (remainingTime > 0) {
        return new Promise((resolve) => setTimeout(resolve, remainingTime));
    } else {
        return Promise.resolve();
    }
}

async function CheckConnection(pg) {
    try {
        const client = await pg.connect();
        console.log('Successfully connected to PostgreSQL database!');
        client.release();
    } catch (err) {
        console.error('Error connecting to PostgreSQL database: ', err);
    }
}

function checkArrayOfStrings(string, words) {
    return words.some((word) => string.includes(word));
}

async function ViewPlayers(pg) {
    try {
        let table = 'SELECT * FROM Players';

        const res = await pg.query(table);
        console.log(res.rows);
    } catch (err) {
        console.error(err);
    }
}

async function FetchTournaments(pg, name, exludedWords) {
    let hasMore = true;
    let tournamentIds = [];
    let date = new Date(1000);
    let i = 1;
    const getCurrentTournamentInfo = 'SELECT * FROM Tournaments;';
    const res = await pg.query(getCurrentTournamentInfo);
    const map = res.rows.reduce((map, obj) => {
        const { tournamentid, latestupdate, tournamentname, slug } = obj;
        map[tournamentid] = { latestupdate, tournamentname, slug };
        return map;
    }, {});

    while (hasMore) {
        let page = 1;
        let lastCall = 0;
        while (page <= 20 && hasMore) {
            lastCall = Date.now();
            let results = await fetch('https://api.start.gg/gql/alpha', {
                method: 'POST',

                headers: {
                    'Content-Type': 'application/json',
                    Authorization: 'Bearer ' + process.env.AUTH_TOKEN,
                },

                body: JSON.stringify({
                    query: GET_TOURNAMENTS,
                    variables: {
                        page: page,
                        perPage: 500,
                        SF6: 43868,
                        AfterDate: date.getTime() / 1000,
                    },
                }),
            });
            results = await results.json();
            console.log(results);
            hasMore = results.data.tournaments.nodes.length == 500;
            let j = 1;
            results.data.tournaments.nodes.forEach((tournament) => {
                let totalIds = (i - 1) * 10000 + (page - 1) * 500 + j;
                //let idIndex = Math.floor((totalIds - 1) / 10);
                if (
                    (name && tournament.name.toLowerCase().includes(name)) /*&&
                        !checkArrayOfStrings(
                            tournament.name.toLowerCase(),
                            exludedWords
                        )*/ ||
                    !name
                ) {
                    console.log(totalIds);
                    if (
                        !map[tournament.id] ||
                        (map[tournament.id] &&
                            map[tournament.id].latestupdate / 1000 <
                                tournament.updatedAt)
                    ) {
                        let log = `
                            {
                                CurrentEntry: ${totalIds}
                                id: ${tournament.id},
                                Name: ${tournament.name},
                                Slug: ${tournament.slug},
                                startAt: ${tournament.startAt},
                            }
                        `;

                        // fs.appendFile("log.txt", log, (err) => {
                        //     if (err) throw err;
                        // });

                        const insert = `
                            INSERT INTO Tournaments(TournamentID, StartedAt, CreatedAt, LatestUpdate, TournamentName, Slug)
                            VALUES($1, TO_TIMESTAMP($2), TO_TIMESTAMP($3), TO_TIMESTAMP($4), $5, $6)
                            ON CONFLICT(TournamentID)
                            DO UPDATE
                            SET StartedAt = EXCLUDED.StartedAt,
                                CreatedAt = EXCLUDED.CreatedAt,
                                LatestUpdate = EXCLUDED.LatestUpdate,
                                TournamentName = EXCLUDED.TournamentName,
                                Slug = EXCLUDED.Slug
                            WHERE Tournaments.LatestUpdate != EXCLUDED.LatestUpdate;
                        `;
                        pg.query(insert, [
                            tournament.id,
                            tournament.startAt,
                            tournament.createdAt,
                            tournament.updatedAt,
                            tournament.name,
                            tournament.slug,
                        ]);
                        tournamentIds.push(tournament.id);
                    }
                }
                j++;
            });

            if (page == 20 && hasMore) {
                date.setTime(
                    results.data.tournaments.nodes[499].startAt * 1000
                );
            }
            page++;
            await waitUntil(new Date(lastCall + 1000));
        }
        i++;
    }
    return tournamentIds;
}

async function RetrieveEventsBasedOnTournaments(
    pg,
    tournamentIds,
    excludedWords
) {
    let outdatedEvents = {};
    let totalEvents = 0;
    let i = 0;
    let lastCall = new Date(1000);
    const groupedIds = [];
    let args = [];
    let highestQueryComplexity = 0;
    const getEventsQuery = 'SELECT * FROM Events WHERE TournamentID = $1';
    while (i < tournamentIds.length || args.length != 0) {
        let queryArgs = {};
        const existingEvents = [];

        while (i < tournamentIds.length && args.length < 150) {
            args.push(tournamentIds[i]);
            i++;
        }

        for (let j = 0; j < args.length; j++) {
            queryArgs[`T${j + 1}`] = args[j];
            let res = await pg.query(getEventsQuery, [args[j]]);
            if (res.rows.length != 0) existingEvents.push(res.rows);
        }

        const eventsMap = {};
        for (let j = 0; j < existingEvents.length; j++) {
            eventsMap[existingEvents[j].eventid] = {
                LatestUpdate: existingEvents[j].latestupdate,
                EventName: existingEvents[j].eventname,
                Slug: existingEvents[j].slug,
            };
        }

        queryArgs[`SF6`] = 43868;

        const query = EventsQueryCreation(args.length);
        lastCall = Date.now();
        let results = await fetch('https://api.start.gg/gql/alpha', {
            method: 'POST',

            headers: {
                'Content-Type': 'application/json',
                Authorization: 'Bearer ' + process.env.AUTH_TOKEN,
            },

            body: JSON.stringify({
                query: query,
                variables: queryArgs,
            }),
        });

        try {
            results = await results.json();
            console.log(results);

            highestQueryComplexity = Math.max(
                highestQueryComplexity,
                results.extensions.queryComplexity
            );

            const data = results.data;
            for (const key in data) {
                const tournament = data[key];
                if (tournament) {
                    const id = tournament.id;
                    tournament.events.forEach((event) => {
                        // if (
                        //     !excludedWords ||
                        //     !checkArrayOfStrings(
                        //         event.name.toLowerCase(),
                        //         excludedWords
                        //     )
                        // ) {
                        const eventID = event.id;
                        if (
                            !eventsMap[eventID] ||
                            (eventsMap[eventID] &&
                                eventsMap[eventID].LatestUpdate / 1000 <
                                    event.updatedAt)
                        ) {
                            console.log(`EventID: ${event.id}`);
                            console.log(`updatedAt: ${event.updatedAt}`);
                            console.log(`EventName: ${event.name}`);
                            console.log(`Slug: ${event.slug}`);
                            console.log(`Total Events: ${totalEvents}`);
                            totalEvents++;
                            const insertOrUpdateEvent = `
                                INSERT INTO Events(TournamentID, EventID, StartedAt, LatestUpdate, EventName, Slug)
                                VALUES($1, $2, TO_TIMESTAMP($3), TO_TIMESTAMP($4), $5, $6)
                                ON CONFLICT(EventID)
                                DO UPDATE
                                SET StartedAt = EXCLUDED.StartedAt,
                                    LatestUpdate = EXCLUDED.LatestUpdate,
                                    EventName = EXCLUDED.EventName,
                                    Slug = EXCLUDED.Slug
                                WHERE Events.LatestUpdate != EXCLUDED.LatestUpdate
                            `;

                            pg.query(insertOrUpdateEvent, [
                                id,
                                event.id,
                                event.startAt,
                                event.updatedAt,
                                event.name,
                                event.slug,
                            ]);

                            outdatedEvents[event.id] = id;
                        }
                        // }
                    });
                    args.splice(args.indexOf(id), 1);
                }

                console.log(
                    'Highest Query Complexity: ' + highestQueryComplexity
                );
            }
        } catch (err) {
            console.error(err);
        }
        await waitUntil(new Date(lastCall + 1000));
    }

    return outdatedEvents;
}

async function RetrievePhasesBasedEvents(eventTournaments, eventPhases) {
    let highestQueryComplexity = 0;
    let i = 0;
    let args = [];
    let eventIDs = Object.keys(eventTournaments);
    let lastCall = new Date(1000);
    while (i < eventIDs.length || args.length != 0) {
        while (i < eventIDs.length && args.length < 200) {
            args.push(eventIDs[i]);
            i++;
        }

        let queryArgs = {};
        for (let j = 0; j < args.length; j++) {
            queryArgs[`E${j + 1}`] = args[j];
        }

        const query = PhaseQueryCreation(args.length);
        lastCall = Date.now();
        let results = await fetch('https://api.start.gg/gql/alpha', {
            method: 'POST',

            headers: {
                'Content-Type': 'application/json',
                Authorization: 'Bearer ' + process.env.AUTH_TOKEN,
            },

            body: JSON.stringify({
                query: query,
                variables: queryArgs,
            }),
        });

        try {
            results = await results.json();
            console.log(results);

            highestQueryComplexity = Math.max(
                highestQueryComplexity,
                results.extensions.queryComplexity
            );

            const data = results.data;
            for (const key in data) {
                const event = data[key];
                const eventID = event.id;

                if (event.phases) {
                    event.phases.forEach((phase) => {
                        eventPhases[phase.id] = event.id;
                        console.log(phase.id);
                    });
                }

                args.splice(args.indexOf(eventID), 1);
            }
            console.log('Highest Query Complexity: ' + highestQueryComplexity);
            console.log(i + '/' + eventIDs.length);
        } catch (err) {
            console.error(err);
        }
        await waitUntil(new Date(lastCall + 1000));
    }
}

async function RetrieveEntrantsFromEvents(eventTournaments, playerEventStats) {
    const entrants = [];
    let numEntrants = 0;
    let highestQueryComplexity = 0;
    let i = 0;
    let args = {};
    let lastCall = new Date(1000);
    let entrantsPerEvent = {};
    const events = Object.keys(eventTournaments);
    while (i < events.length || Object.keys(args).length != 0) {
        while (Object.keys(args).length < 300 && i < events.length) {
            args[events[i]] = 1;
            i++;
        }

        const query = EntrantQueryCreation(Object.keys(args).length);

        let queryArgs = {};

        let j = 1;
        for (const eventID in args) {
            queryArgs[`E${j}`] = eventID;
            queryArgs[`P${j}`] = args[eventID];
            j++;
        }

        queryArgs['perPage'] = 100;

        lastCall = Date.now();
        let results = await fetch('https://api.start.gg/gql/alpha', {
            method: 'POST',

            headers: {
                'Content-Type': 'application/json',
                Authorization: 'Bearer ' + process.env.AUTH_TOKEN,
            },

            body: JSON.stringify({
                query: query,
                variables: queryArgs,
            }),
        });

        try {
            results = await results.json();

            console.log(
                'Query Complexity: ' + results.extensions.queryComplexity
            );

            highestQueryComplexity = Math.max(
                highestQueryComplexity,
                results.extensions.queryComplexity
            );

            let data = results.data;

            for (const event in data) {
                if (data[event]) {
                    if (!entrantsPerEvent[data[event].id]) {
                        entrantsPerEvent[data[event].id] = 0;
                    }
                    data[event].entrants.nodes.forEach((entrant) => {
                        numEntrants++;
                        entrantsPerEvent[data[event].id]++;

                        entrants.push(entrant.id);
                        if (playerEventStats) {
                            playerEventStats[entrant.id] = {};
                            playerEventStats[entrant.id].EventID =
                                data[event].id;
                        }

                        console.log(`EntrantID: ${entrant.id}`);
                    });
                    if (
                        args[data[event].id] <
                        data[event].entrants.pageInfo.totalPages
                    ) {
                        args[data[event].id] += 1;
                    } else {
                        if (
                            data[event].numEntrants &&
                            data[event].numEntrants !=
                                entrantsPerEvent[data[event].id]
                        ) {
                            args[data[event].id] = 1;
                            entrantsPerEvent[data[event].id] = 0;
                        } else delete args[data[event].id];
                    }
                }
            }
            console.log(i + '/' + events.length);
        } catch (err) {
            console.log(err);
        }
        await waitUntil(new Date(lastCall + 1000));
    }
    console.log('Entrants: ' + numEntrants);
    console.log('Highest Query Complexity: ' + highestQueryComplexity);
    return entrants;
}

async function RetrieveParticipantIDsFromEntrants(entrants, playerEventStats) {
    const participantEntrants = {};
    let highestQueryComplexity = 0;
    let i = 0;
    let args = [];
    let lastCall = new Date(1000);
    while (i < entrants.length || args.length != 0) {
        while (i < entrants.length && args.length < 195) {
            args.push(entrants[i]);
            i++;
        }

        let queryArgs = {};
        for (let j = 0; j < args.length; j++) {
            queryArgs[`E${j + 1}`] = args[j];
        }

        const query = RetrieveParticipantIDsQuery(args.length);

        lastCall = Date.now();

        let results = await fetch('https://api.start.gg/gql/alpha', {
            method: 'POST',

            headers: {
                'Content-Type': 'application/json',
                Authorization: 'Bearer ' + process.env.AUTH_TOKEN,
            },

            body: JSON.stringify({
                query: query,
                variables: queryArgs,
            }),
        });

        try {
            results = await results.json();

            console.log(results);

            highestQueryComplexity = Math.max(
                highestQueryComplexity,
                results.extensions.queryComplexity
            );

            let data = results.data;
            for (const key in data) {
                const entrant = data[key];
                if (entrant.participants && entrant.participants[0]) {
                    if (!participantEntrants[entrant.participants[0].id])
                        participantEntrants[entrant.participants[0].id] = [];
                    participantEntrants[entrant.participants[0].id].push(
                        entrant.id
                    );
                }
                // if (
                //     entrant.participants &&
                //     entrant.participants[0] &&
                //     entrant.participants[0].player
                // ) {
                //     const player = entrant.participants[0].player;
                //     const playerID = player.id;
                //     const playerGamerTag = player.gamerTag;
                //     let playerSlug = '';

                //     entrantPlayers[entrant.id] = playerID;

                //     if (entrant.participants[0].player.user)
                //         playerSlug = player.user.slug;

                //     const insertOrUpdatePlayer = `
                //             INSERT INTO Players(PlayerID, GamerTag, Slug)
                //             VALUES($1, $2, $3)
                //             ON CONFLICT(PlayerID)
                //             DO UPDATE
                //             SET GamerTag = EXCLUDED.GamerTag,
                //                 Slug = EXCLUDED.Slug
                //     `;

                //     await pg.query(insertOrUpdatePlayer, [
                //         playerID,
                //         playerGamerTag,
                //         playerSlug,
                //     ]);
                // } else {
                //     console.log(entrant.id);
                // }
                if (playerEventStats) {
                    if (entrant.initialSeedNum)
                        playerEventStats[entrant.id].Seeding =
                            entrant.initialSeedNum;
                    if (entrant.standing && entrant.standing.placement)
                        playerEventStats[entrant.id].Placement =
                            entrant.standing.placement;
                    if (entrant.isdisqualified)
                        playerEventStats[entrant.id].IsDisqualified = true;
                    else playerEventStats[entrant.id].IsDisqualified = false;
                }
                args.splice(args.indexOf(entrant.id), 1);
            }
        } catch (err) {
            console.error(err);
        }
        console.log(`Entrants: ${i}/${entrants.length}`);
        await waitUntil(new Date(lastCall + 1000));
    }
    return participantEntrants;
}

async function RetrievePlayerIDsFromParticipantIDs(
    participantEntrants,
    playerEventStats
) {
    const entrantPlayers = {};
    let highestQueryComplexity = 0;
    let i = 0;
    let args = [];
    let lastCall = new Date(1000);
    const participants = Object.keys(participantEntrants);
    while (i < participants.length || args.length != 0) {
        while (i < participants.length && args.length < 333) {
            args.push(participants[i]);
            i++;
        }

        let queryArgs = {};
        for (let j = 0; j < args.length; j++) {
            queryArgs[`P${j + 1}`] = args[j];
        }

        const query = RetrievePlayerIDsQuery(args.length);

        lastCall = Date.now();

        let results = await fetch('https://api.start.gg/gql/alpha', {
            method: 'POST',

            headers: {
                'Content-Type': 'application/json',
                Authorization: 'Bearer ' + process.env.AUTH_TOKEN,
            },

            body: JSON.stringify({
                query: query,
                variables: queryArgs,
            }),
        });

        try {
            results = await results.json();

            console.log(results);

            highestQueryComplexity = Math.max(
                highestQueryComplexity,
                results.extensions.queryComplexity
            );

            let data = results.data;
            for (const key in data) {
                const participant = data[key];
                if (participant.player) {
                    const player = participant.player;
                    for (
                        let j = 0;
                        j < participantEntrants[participant.id].length;
                        j++
                    ) {
                        entrantPlayers[participantEntrants[participant.id][j]] =
                            player.id;
                        if (playerEventStats) {
                            playerEventStats[
                                participantEntrants[participant.id][j]
                            ].PlayerID = player.id;
                        }
                    }
                }
                args.splice(args.indexOf(participants.id), 1);
            }
        } catch (err) {
            console.error(err);
        }
        console.log(`Participants: ${i}/${participants.length}`);
        await waitUntil(new Date(lastCall + 1000));
    }
    return entrantPlayers;
}

async function RetrievePlayerInfo(pg, entrantPlayers) {
    const players = [];
    const entrantIDs = Object.keys(entrantPlayers);
    for (let i = 0; i < entrantIDs.length; i++) {
        if (!players.includes(entrantPlayers[entrantIDs[i]])) {
            players.push(entrantPlayers[entrantIDs[i]]);
        }
    }

    const nullPlayers = [];
    let i = 0;
    let args = [];
    let lastCall = new Date(1000);
    while (i < players.length || args.length != 0) {
        while (i < players.length && args.length < 400) {
            args.push(players[i]);
            i++;
        }

        const query = RetrievePlayerInfoQuery(args.length);
        let queryArgs = {};

        for (let j = 0; j < args.length; j++) {
            queryArgs['P' + (j + 1)] = args[j];
        }

        lastCall = Date.now();

        let results = await fetch('https://api.start.gg/gql/alpha', {
            method: 'POST',

            headers: {
                'Content-Type': 'application/json',
                Authorization: 'Bearer ' + process.env.AUTH_TOKEN,
            },

            body: JSON.stringify({
                query: query,
                variables: queryArgs,
            }),
        });

        try {
            results = await results.json();

            console.log(results);

            let data = results.data;

            for (const id in data) {
                const player = data[id];
                if (player) {
                    const playerID = player.id;
                    const gamerTag = player.gamerTag;
                    let slug;
                    let image;

                    if (player.user) {
                        const user = player.user;
                        if (user.slug) {
                            slug = user.slug;
                        }
                        if (user.images[0]) {
                            const parsedURL = new URL(user.images[0].url);
                            image = `${parsedURL.origin}${parsedURL.pathname}`;
                        }
                    }

                    const insertOrUpdatePlayer = `
                        INSERT INTO Players(PlayerID, GamerTag, Slug, ProfilePicture)
                        VALUES($1, $2, $3, $4)
                        ON CONFLICT(PlayerID)
                        DO UPDATE
                        SET GamerTag = EXCLUDED.GamerTag,
                            Slug = EXCLUDED.Slug,
                            ProfilePicture = EXCLUDED.ProfilePicture
                    `;

                    await pg.query(insertOrUpdatePlayer, [
                        playerID,
                        gamerTag,
                        slug,
                        image,
                    ]);
                } else {
                    nullPlayers.push(args[0]);
                }
                args.shift();
            }
            console.log('Players: ' + i + '/' + players.length);
        } catch (err) {
            console.error(err);
        }
        await waitUntil(new Date(lastCall + 1000));
    }
    return nullPlayers;
}

async function RetrieveSetIDsFromEventPhases(
    eventPhases,
    setIDEvents,
    exceededEntries
) {
    let args = {};
    let i = 0;
    let highestQueryComplexity = 0;
    let lastCall = new Date(1000);
    let numSets = 0;
    let phaseIDs = Object.keys(eventPhases);

    while (i < phaseIDs.length || Object.keys(args).length != 0) {
        while (i < phaseIDs.length && Object.keys(args).length < 200) {
            args[phaseIDs[i]] = 1;
            i++;
        }

        const query = SetIDQueryCreation(Object.keys(args).length);

        let queryArgs = {};
        let j = 1;
        for (const id in args) {
            queryArgs[`phaseID${j}`] = id;
            queryArgs[`page${j}`] = args[id];
            j++;
        }

        queryArgs[`perPage`] = 100;

        lastCall = Date.now();
        let results = await fetch('https://api.start.gg/gql/alpha', {
            method: 'POST',

            headers: {
                'Content-Type': 'application/json',
                Authorization: 'Bearer ' + process.env.AUTH_TOKEN,
            },

            body: JSON.stringify({
                query: query,
                variables: queryArgs,
            }),
        });

        try {
            results = await results.json();

            console.log(results);

            highestQueryComplexity = Math.max(
                highestQueryComplexity,
                results.extensions.queryComplexity
            );

            let data = results.data;

            if (results.error) {
                console.log(results.error);
            }

            for (const key in data) {
                const phase = data[key];
                const phaseID = phase.id;
                const eventID = eventPhases[phaseID];

                if (phase.sets.pageInfo.totalPages <= 100) {
                    phase.sets.nodes.forEach((set) => {
                        if (!set.id.toString().includes('preview')) {
                            setIDEvents[set.id] = eventID;
                            numSets++;
                        }
                    });

                    if (args[phaseID] < phase.sets.pageInfo.totalPages)
                        args[phaseID]++;
                    else delete args[phaseID];
                } else {
                    exceededEntries[phaseID] = eventID;
                    delete args[phaseID];
                }
            }

            console.log('Number of Sets: ' + numSets);
            console.log('Highest Query Complexity: ' + highestQueryComplexity);
            console.log(i + '/' + phaseIDs.length);
        } catch (err) {
            console.error(err);
        }
        await waitUntil(new Date(lastCall + 1000));
    }
}

async function RetrievePhaseGroupsFromPhases(exceededEntries) {
    let i = 0;
    let entryKeys = Object.keys(exceededEntries);
    let highestQueryComplexity = 0;
    let phaseGroupEvents = {};
    let lastCall = new Date(1000);
    while (i < entryKeys.length) {
        let args = [];
        while (i < entryKeys.length && Object.keys(args).length < 500) {
            args.push(entryKeys[i]);
            i++;
        }

        let queryArgs = {};
        for (let j = 0; j < args.length; j++) {
            queryArgs[`phaseID${j + 1}`] = args[j];
        }

        let query = GetPhaseGroupsFromPhasesQuery(args.length);

        lastCall = Date.now();

        let results = await fetch('https://api.start.gg/gql/alpha', {
            method: 'POST',

            headers: {
                'Content-Type': 'application/json',
                Authorization: 'Bearer ' + process.env.AUTH_TOKEN,
            },

            body: JSON.stringify({
                query: query,
                variables: queryArgs,
            }),
        });

        try {
            results = await results.json();

            console.log(results);

            highestQueryComplexity = Math.max(
                highestQueryComplexity,
                results.extensions.queryComplexity
            );

            let data = results.data;

            for (const phase in data) {
                if (data[phase]) {
                    let id = data[phase].id;
                    data[phase].phaseGroups.nodes.forEach((phaseGroup) => {
                        phaseGroupEvents[phaseGroup.id] = exceededEntries[id];
                    });
                }
            }
            console.log('Highest Query Complexity: ' + highestQueryComplexity);
            console.log(i + '/' + entryKeys.length);
        } catch (err) {
            console.error(err);
        }
        await waitUntil(new Date(lastCall + 1000));
    }
    return phaseGroupEvents;
}

async function RetrieveSetIDsFromEventPhaseGroups(
    phaseGroupEvents,
    setIDEvents
) {
    const groupKeys = Object.keys(phaseGroupEvents);

    let i = 0;
    let args = {};
    let highestQueryComplexity = 0;
    let lastCall = new Date(1000);
    while (i < groupKeys.length || Object.keys(args).length != 0) {
        while (i < groupKeys.length && Object.keys(args).length < 500) {
            args[groupKeys[i]] = 1;
            i++;
        }

        let queryArgs = {};
        let j = 1;
        for (const phaseGroupID in args) {
            queryArgs[`groupID${j}`] = phaseGroupID;
            queryArgs[`page${j}`] = args[phaseGroupID];
            j++;
        }

        queryArgs[`perPage`] = 100;

        const query = RetrieveSetIDsWithPhaseGroups(Object.keys(args).length);

        lastCall = Date.now();
        let results = await fetch('https://api.start.gg/gql/alpha', {
            method: 'POST',

            headers: {
                'Content-Type': 'application/json',
                Authorization: 'Bearer ' + process.env.AUTH_TOKEN,
            },

            body: JSON.stringify({
                query: query,
                variables: queryArgs,
            }),
        });

        try {
            results = await results.json();

            console.log(results);

            highestQueryComplexity = Math.max(
                highestQueryComplexity,
                results.extensions.queryComplexity
            );

            let data = results.data;

            for (const phaseGroup in data) {
                if (data[phaseGroup]) {
                    let id = data[phaseGroup].id;
                    data[phaseGroup].sets.nodes.forEach((set) => {
                        setIDEvents[set.id] = phaseGroupEvents[id];
                    });

                    if (data[phaseGroup].sets.nodes.length == 100) {
                        args[id] += 1;
                    } else {
                        delete args[id];
                    }
                }
            }
        } catch (err) {
            console.error(err);
        }
        await waitUntil(new Date(lastCall + 1000));
    }
}

async function RetrieveSetInfoWithSetIDs(pg, entrantPlayers, setIDEvents) {
    let i = 0;
    let highestQueryComplexity = 0;
    let lastCall = Date.now();
    const setIDs = Object.keys(setIDEvents);
    let setIDArgs = [];
    while (i < setIDs.length) {
        while (i < setIDs.length && setIDArgs.length < 140) {
            setIDArgs.push(setIDs[i]);
            i++;
        }

        let query = SetQueryCreation(setIDArgs.length);
        let queryArgs = {};

        for (let j = 0; j < setIDArgs.length; j++) {
            queryArgs['setID' + (j + 1)] = setIDArgs[j];
        }

        lastCall = Date.now();

        let results = await fetch('https://api.start.gg/gql/alpha', {
            method: 'POST',

            headers: {
                'Content-Type': 'application/json',
                Authorization: 'Bearer ' + process.env.AUTH_TOKEN,
            },

            body: JSON.stringify({
                query: query,
                variables: queryArgs,
            }),
        });
        try {
            results = await results.json();

            console.log(results);
            for (let j = 0; j < setIDArgs.length; j++) {
                console.log(`S${j + 1}: ${setIDArgs[j]}`);
            }
            highestQueryComplexity = Math.max(
                highestQueryComplexity,
                results.extensions.queryComplexity
            );

            let data = results.data;

            for (const set in data) {
                let j = 1;
                let entrants = [];
                let setID = data[set].id;
                if (typeof setID != 'string' && data[set].winnerId) {
                    if (data[set].slots) {
                        data[set].slots.forEach((slot) => {
                            if (slot.entrant) {
                                entrants.push(slot.entrant.id);
                                console.log(
                                    `ID ${j}: ${
                                        entrantPlayers[slot.entrant.id]
                                    }`
                                );
                                console.log(
                                    `Player ${j}: ${slot.entrant.name}`
                                );
                            } else {
                                console.log(data[set].id);
                            }
                            j++;
                        });
                    }
                    if (
                        entrants[0] &&
                        entrantPlayers[entrants[0]] &&
                        entrants[1] &&
                        entrantPlayers[entrants[1]]
                    ) {
                        let playerOneID = entrantPlayers[entrants[0]];
                        let playerTwoID = entrantPlayers[entrants[1]];
                        let playerOneScore = 0;
                        let playerTwoScore = 0;
                        let hasDQ = false;
                        let winnerId;
                        const score = data[set].displayScore;

                        console.log(score);
                        if (score && score != 'DQ' && !score.includes('-1')) {
                            const scores = score.split(' - ');
                            if (
                                !isNaN(parseInt(scores[0])) &&
                                !isNaN(parseInt(scores[1]))
                            ) {
                                if (data[set].winnerId == entrants[0]) {
                                    playerOneScore = Math.max(
                                        parseInt(scores[0]),
                                        parseInt(scores[1])
                                    );
                                    playerTwoScore = Math.min(
                                        parseInt(scores[0]),
                                        parseInt(scores[1])
                                    );
                                } else if (data[set].winnerId == entrants[1]) {
                                    playerOneScore = Math.min(
                                        parseInt(scores[0]),
                                        parseInt(scores[1])
                                    );
                                    playerTwoScore = Math.max(
                                        parseInt(scores[0]),
                                        parseInt(scores[1])
                                    );
                                }
                            }
                        } else if (
                            (score && score == 'DQ') ||
                            (score && score.includes('-1'))
                        ) {
                            hasDQ = true;
                        }

                        if (data[set].winnerId)
                            winnerId = entrantPlayers[data[set].winnerId];

                        const insertOrUpdateSet = `
                            INSERT INTO Sets(SetID, EventID, PlayerOneID, PlayerTwoID, PlayerOneWins, PlayerTwoWins, WinnerID, HasDQ)
                            VALUES($1, $2, $3, $4, $5, $6, $7, $8)
                            ON CONFLICT(SetID)
                            DO UPDATE
                            SET PlayerOneID = EXCLUDED.PlayerOneID,
                                PlayerTwoID = EXCLUDED.PlayerTwoID,
                                PlayerOneWins = EXCLUDED.PlayerOneWins,
                                PlayerTwoWins = EXCLUDED.PlayerTwoWins,
                                WinnerID = EXCLUDED.WinnerID,
                                HasDQ = EXCLUDED.HasDQ
                        `;

                        await pg.query(insertOrUpdateSet, [
                            setID,
                            setIDEvents[setID],
                            playerOneID,
                            playerTwoID,
                            playerOneScore,
                            playerTwoScore,
                            winnerId,
                            hasDQ,
                        ]);

                        console.log(data[set].winnerId);
                    }
                }
                setIDArgs.splice(setIDArgs.indexOf(setID), 1);
            }
            console.log('Highest Query Complexity: ' + highestQueryComplexity);
            console.log(i + '/' + setIDs.length);
        } catch (err) {
            console.error(err);
        }
        await waitUntil(new Date(lastCall + 1000));
    }
}

async function UpdatePlayerInfo(pg) {
    const query = 'SELECT PlayerID FROM Players';
    const res = await pg.query(query);
    const rows = res.rows;
    let lastCall = Date.now();
    const nullPlayers = [];

    let i = 0;
    let playerIDArgs = [];
    while (i < rows.length || playerIDArgs.length != 0) {
        while (i < rows.length && playerIDArgs.length < 400) {
            playerIDArgs.push(rows[i].playerid);
            i++;
        }

        const query = RetrievePlayerInfoQuery(playerIDArgs.length);
        let queryArgs = {};

        for (let j = 0; j < playerIDArgs.length; j++) {
            queryArgs['P' + (j + 1)] = playerIDArgs[j];
        }

        lastCall = Date.now();

        let results = await fetch('https://api.start.gg/gql/alpha', {
            method: 'POST',

            headers: {
                'Content-Type': 'application/json',
                Authorization: 'Bearer ' + process.env.AUTH_TOKEN,
            },

            body: JSON.stringify({
                query: query,
                variables: queryArgs,
            }),
        });

        try {
            results = await results.json();
            console.log(results);
            let data = results.data;

            for (const id in data) {
                const player = data[id];
                if (player) {
                    const playerID = player.id;
                    const gamerTag = player.gamerTag;
                    if (player.user) {
                        let slug;
                        let image;
                        if (player.user) {
                            const user = player.user;
                            if (user.slug) {
                                slug = user.slug;
                            }
                            if (user.images[0]) {
                                const parsedURL = new URL(user.images[0].url);
                                image = `${parsedURL.origin}${parsedURL.pathname}`;
                            }
                        }

                        const updateQuery = `
                            UPDATE Players
                            SET GamerTag = $1,
                                Slug = $2,
                                ProfilePicture = $3
                            WHERE PlayerID = $4;
                        `;

                        await pg.query(updateQuery, [
                            gamerTag,
                            slug,
                            image,
                            playerID,
                        ]);
                    }
                } else {
                    nullPlayers.push(queryArgs[id]);
                }
                playerIDArgs.shift();
            }
            console.log(i + '/' + rows.length);
        } catch (err) {
            console.error(err);
        }
        await waitUntil(new Date(lastCall + 1000));
    }
    return nullPlayers;
}

async function GetSetIDsWithPlayerIDs(pg, players) {
    const outdatedSetIDs = [];
    const query =
        'SELECT SetID FROM Sets WHERE PlayerOneID=$1 OR PlayerTwoID=$1';
    try {
        for (let i = 0; i < players.length; i++) {
            const res = await pg.query(query, [players[i]]);
            const setIDs = res.rows;
            for (let j = 0; j < setIDs.length; j++) {
                outdatedSetIDs.push(setIDs[j].setid);
            }
        }
    } catch (err) {
        console.error(err);
    }
    return outdatedSetIDs;
}

async function UpdateSetsWithCorrectPlayers(pg, outdatedSetIDs) {
    const args = [];
    let i = 0;
    let highestQueryComplexity = 0;
    while (i < outdatedSetIDs.length || args.length != 0) {
        while (i < outdatedSetIDs.length && args.length < 75) {
            args.push(outdatedSetIDs[i]);
            i++;
        }

        const query = PlayersFromSetsQueryCreation(args.length);
        let queryArgs = {};

        for (let j = 0; j < args.length; j++) {
            queryArgs['S' + (j + 1)] = args[j];
        }

        lastCall = Date.now();

        let results = await fetch('https://api.start.gg/gql/alpha', {
            method: 'POST',

            headers: {
                'Content-Type': 'application/json',
                Authorization: 'Bearer ' + process.env.AUTH_TOKEN,
            },

            body: JSON.stringify({
                query: query,
                variables: queryArgs,
            }),
        });

        try {
            results = await results.json();

            console.log(results);
            for (let j = 0; j < args.length; j++) {
                console.log(`S${j + 1}: ${args[j]}`);
            }
            highestQueryComplexity = Math.max(
                highestQueryComplexity,
                results.extensions.queryComplexity
            );

            let data = results.data;

            for (const id in data) {
                const set = data[id];
                const setID = set.id;
                const eventID = set.event.id;
                const entrantPlayers = [];
                if (set.slots) {
                    await set.slots.forEach(async (slot) => {
                        if (
                            slot.entrant &&
                            slot.entrant.participants[0] &&
                            slot.entrant.participants[0].player
                        ) {
                            const entrantID = slot.entrant.id;
                            const player = slot.entrant.participants[0].player;
                            const playerID = player.id;
                            const gamerTag = player.gamerTag;
                            let slug;
                            let image;

                            entrantPlayers.push({
                                entrantID: entrantID,
                                playerID: playerID,
                            });

                            if (player.user) {
                                const user = player.user;
                                if (user.slug) {
                                    slug = user.slug;
                                }
                                if (user.images[0]) {
                                    const parsedURL = new URL(
                                        user.images[0].url
                                    );
                                    image = `${parsedURL.origin}${parsedURL.pathname}`;
                                }
                            }

                            const insertOrUpdatePlayer = `
                                INSERT INTO Players(PlayerID, GamerTag, Slug, ProfilePicture)
                                VALUES($1, $2, $3, $4)
                                ON CONFLICT(PlayerID)
                                DO UPDATE
                                SET GamerTag = EXCLUDED.GamerTag,
                                    Slug = EXCLUDED.Slug,
                                    ProfilePicture = EXCLUDED.ProfilePicture
                            `;

                            await pg.query(insertOrUpdatePlayer, [
                                playerID,
                                gamerTag,
                                slug,
                                image,
                            ]);
                        }
                    });
                }

                if (entrantPlayers.length == 2) {
                    let playerOneID = entrantPlayers[0].playerID;
                    let playerTwoID = entrantPlayers[1].playerID;
                    let playerOneScore = 0;
                    let playerTwoScore = 0;
                    let hasDQ = false;
                    let winnerId;
                    const score = set.displayScore;

                    console.log(score);
                    if (score && score != 'DQ' && !score.includes('-1')) {
                        const scores = score.split(' - ');
                        if (
                            !isNaN(parseInt(scores[0])) &&
                            !isNaN(parseInt(scores[1]))
                        ) {
                            if (set.winnerId == entrantPlayers[0].entrantID) {
                                playerOneScore = Math.max(
                                    parseInt(scores[0]),
                                    parseInt(scores[1])
                                );
                                playerTwoScore = Math.min(
                                    parseInt(scores[0]),
                                    parseInt(scores[1])
                                );
                            } else if (
                                set.winnerId == entrantPlayers[1].entrantID
                            ) {
                                playerOneScore = Math.min(
                                    parseInt(scores[0]),
                                    parseInt(scores[1])
                                );
                                playerTwoScore = Math.max(
                                    parseInt(scores[0]),
                                    parseInt(scores[1])
                                );
                            }
                        }
                    } else if (
                        (score && score == 'DQ') ||
                        (score && score.includes('-1'))
                    ) {
                        hasDQ = true;
                    }

                    if (set.winnerId == entrantPlayers[0].entrantID)
                        winnerId = entrantPlayers[0].playerID;
                    else if (set.winnerId == entrantPlayers[1].entrantID)
                        winnerId = entrantPlayers[1].playerID;

                    const insertOrUpdateSet = `
                        INSERT INTO Sets(SetID, EventID, PlayerOneID, PlayerTwoID, PlayerOneWins, PlayerTwoWins, WinnerID, HasDQ)
                        VALUES($1, $2, $3, $4, $5, $6, $7, $8)
                        ON CONFLICT(SetID)
                        DO UPDATE
                        SET PlayerOneID = EXCLUDED.PlayerOneID,
                            PlayerTwoID = EXCLUDED.PlayerTwoID,
                            PlayerOneWins = EXCLUDED.PlayerOneWins,
                            PlayerTwoWins = EXCLUDED.PlayerTwoWins,
                            WinnerID = EXCLUDED.WinnerID,
                            HasDQ = EXCLUDED.HasDQ
                    `;

                    await pg.query(insertOrUpdateSet, [
                        setID,
                        eventID,
                        playerOneID,
                        playerTwoID,
                        playerOneScore,
                        playerTwoScore,
                        winnerId,
                        hasDQ,
                    ]);
                }
                args.shift();
            }

            console.log('Highest Query Complexity: ' + highestQueryComplexity);
            console.log(i + '/' + outdatedSetIDs.length);
        } catch (err) {
            console.error(err);
        }
        await waitUntil(new Date(lastCall + 1000));
    }
}

async function GetEntrantIDsToUpdate(pg, nullPlayers) {
    const entrantQuery = `
        SELECT EntrantID FROM PlayerEventStats WHERE PlayerID = ANY($1);
    `;
    let entrantIDs = [];
    try {
        const res = await pg.query(entrantQuery, [nullPlayers]);
        entrantIDs = res.rows.map((entrant) => entrant.entrantid);
    } catch (err) {
        console.error(err);
    }
    return entrantIDs;
}

async function InsertOrUpdatePlayerEventStats(pg, playerEventStats) {
    const query = `
        INSERT INTO PlayerEventStats(EntrantID, PlayerID, EventID, SeedPlacement, FinalPlacement, IsDisqualified)
        VALUES($1, $2, $3, $4, $5, $6)
        ON CONFLICT(EntrantID)
        DO UPDATE
        SET PlayerID = EXCLUDED.PlayerID,
            EventID = EXCLUDED.EventID,
            SeedPlacement = EXCLUDED.SeedPlacement,
            FinalPlacement = EXCLUDED.FinalPlacement,
            IsDisqualified = EXCLUDED.IsDisqualified
    `;
    try {
        for (const entrantID in playerEventStats) {
            const stats = playerEventStats[entrantID];
            await pg.query(query, [
                entrantID,
                stats.PlayerID,
                stats.EventID,
                stats.Seeding,
                stats.Placement,
                stats.IsDisqualified,
            ]);
        }
    } catch (err) {
        console.error(err);
    }
}

async function UpdateNullPlayersInPlayerEventStats(pg, entrantPlayers) {
    const query = `
        UPDATE PlayerEventStats
        SET PlayerID = $1
        WHERE EntrantID = $2;
    `;
    try {
        for (const entrantID in entrantPlayers) {
            const playerID = entrantPlayers[entrantID];
            await pg.query(query, [playerID, entrantID]);
        }
    } catch (err) {
        console.error(err);
    }
}

async function RemoveOutdatedPlayers(pg, outdatedPlayers) {
    const deletePlayerFromHeadToHeadStats = `
        DELETE FROM HeadToHeadStats WHERE PlayerOneID = $1 OR PlayerTwoID = $1;
    `;
    const deletePlayerFromPlayerStats = `
        DELETE FROM PlayerStats WHERE PlayerID = $1;
    `;
    const deletePlayerFromPlayers = `
        DELETE FROM Players WHERE PlayerID = $1;
    `;

    for (let i = 0; i < outdatedPlayers.length; i++) {
        const playerID = outdatedPlayers[i];
        await pg.query(deletePlayerFromHeadToHeadStats, [playerID]);
        await pg.query(deletePlayerFromPlayerStats, [playerID]);
        await pg.query(deletePlayerFromPlayers, [playerID]);
    }
}

async function Test(pg) {
    try {
        let query =
            'SELECT SetID FROM Sets WHERE PlayerOneID=$1 OR PlayerTwoID=$1';
        const res = await pg.query(query, [4436169]);
        console.log(res.rows);
    } catch (err) {
        console.error(err);
    }
}

async function ExecuteQuery(pg, fileName) {
    try {
        const query = fs
            .readFileSync(path.resolve(__dirname, `sql_files/${fileName}`))
            .toString();

        await pg.query(query);
    } catch (err) {
        console.error(err);
        return false;
    }
    return true;
}

async function GetSQLFileNames(sqlQueries) {
    fs.readdirSync(sqlDir).forEach((file) => {
        sqlQueries.push(file);
    });
}

module.exports = {
    CheckConnection,
    ViewPlayers,
    FetchTournaments,
    RetrieveEventsBasedOnTournaments,
    RetrievePhasesBasedEvents,
    RetrieveSetIDsFromEventPhases,
    RetrieveEntrantsFromEvents,
    RetrieveParticipantIDsFromEntrants,
    RetrievePlayerIDsFromParticipantIDs,
    RetrievePlayerInfo,
    RetrievePhaseGroupsFromPhases,
    RetrieveSetIDsFromEventPhaseGroups,
    RetrieveSetInfoWithSetIDs,
    UpdatePlayerInfo,
    GetSetIDsWithPlayerIDs,
    UpdateSetsWithCorrectPlayers,
    GetEntrantIDsToUpdate,
    InsertOrUpdatePlayerEventStats,
    UpdateNullPlayersInPlayerEventStats,
    RemoveOutdatedPlayers,
    Test,
    ExecuteQuery,
    GetSQLFileNames,
};
