const PG = require('pg');
const path = require('path');
const fs = require('fs');

const {
    GET_TOURNAMENTS,
    EventsQueryCreation,
    PhaseQueryCreation,
    SetIDQueryCreation,
    SetQueryCreation,
    EntrantQueryCreation,
    PlayerQueryCreation,
    GetPhaseGroupsFromPhasesQuery,
    RetrieveSetIDsWithPhaseGroups,
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

async function ViewPlayers(pg) {
    try {
        let table = 'SELECT * FROM Players';

        const res = await pg.query(table);
        console.log(res.rows);
    } catch (err) {
        console.error(err);
    }
}

async function FetchTournaments(pg, name) {
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
                    (name && tournament.name.toLowerCase().includes(name)) ||
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
                            INSERT INTO Tournaments(TournamentID, CreatedAt, LatestUpdate, TournamentName, Slug)
                            VALUES($1, TO_TIMESTAMP($2), TO_TIMESTAMP($3), $4, $5)
                            ON CONFLICT(TournamentID)
                            DO UPDATE
                            SET LatestUpdate = EXCLUDED.LatestUpdate,
                                TournamentName = EXCLUDED.TournamentName,
                                Slug = EXCLUDED.Slug
                            WHERE Tournaments.LatestUpdate != EXCLUDED.LatestUpdate;
                        `;
                        pg.query(insert, [
                            tournament.id,
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

async function RetrieveEventsBasedOnTournaments(pg, tournamentIds) {
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
                                INSERT INTO Events(TournamentID, EventID, LatestUpdate, EventName, Slug)
                                VALUES($1, $2, TO_TIMESTAMP($3), $4, $5)
                                ON CONFLICT(EventID)
                                DO UPDATE
                                SET LatestUpdate = EXCLUDED.LatestUpdate,
                                    EventName = EXCLUDED.EventName,
                                    Slug = EXCLUDED.Slug
                                WHERE Events.LatestUpdate != EXCLUDED.LatestUpdate
                            `;

                            pg.query(insertOrUpdateEvent, [
                                id,
                                event.id,
                                event.updatedAt,
                                event.name,
                                event.slug,
                            ]);

                            outdatedEvents[event.id] = id;
                        }
                        args.splice(args.indexOf(id), 1);
                    });
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

async function RetrieveEntrantsFromEvents(eventTournaments) {
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

async function RetrievePlayerInfoFromEntrants(pg, entrants) {
    const entrantPlayers = {};
    let highestQueryComplexity = 0;
    let i = 0;
    let args = [];
    let lastCall = new Date(1000);
    while (i < entrants.length || args.length != 0) {
        while (i < entrants.length && args.length < 225) {
            args.push(entrants[i]);
            i++;
        }

        let queryArgs = {};
        for (let j = 0; j < args.length; j++) {
            queryArgs[`E${j + 1}`] = args[j];
        }

        const query = PlayerQueryCreation(args.length);

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
                if (
                    entrant.participants &&
                    entrant.participants[0] &&
                    entrant.participants[0].player
                ) {
                    const player = entrant.participants[0].player;
                    const playerID = player.id;
                    const playerGamerTag = player.gamerTag;
                    let playerSlug = '';

                    entrantPlayers[entrant.id] = playerID;

                    if (entrant.participants[0].player.user)
                        playerSlug = player.user.slug;

                    const insertOrUpdatePlayer = `
                            INSERT INTO Players(PlayerID, GamerTag, Slug)
                            VALUES($1, $2, $3)
                            ON CONFLICT(PlayerID)
                            DO UPDATE
                            SET GamerTag = EXCLUDED.GamerTag,
                                Slug = EXCLUDED.Slug
                            `;

                    await pg.query(insertOrUpdatePlayer, [
                        playerID,
                        playerGamerTag,
                        playerSlug,
                    ]);
                } else {
                    console.log(entrant.id);
                }
                args.splice(args.indexOf(entrant.id), 1);
            }
        } catch (err) {
            console.error(err);
        }
        console.log(`Entrants: ${i}/${entrants.length}`);
        await waitUntil(new Date(lastCall + 1000));
    }
    return entrantPlayers;
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
        while (i < phaseIDs.length && Object.keys(args).length < 400) {
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
                        setIDEvents[set.id] = eventID;
                        numSets++;
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
                            )
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

async function Test(pg) {
    let date = new Date(1);
    console.log(date);
    date.setTime(1734307200 * 1000);
    console.log(date);

    try {
        let query = 'SELECT TournamentID, LatestUpdate FROM Tournaments;';
        const res = await pg.query(query);
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
    RetrievePlayerInfoFromEntrants,
    RetrievePhaseGroupsFromPhases,
    RetrieveSetIDsFromEventPhaseGroups,
    RetrieveSetInfoWithSetIDs,
    Test,
    ExecuteQuery,
    GetSQLFileNames,
};
