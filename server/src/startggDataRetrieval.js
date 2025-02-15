const PG = require("pg");
const path = require("path");
const fs = require("fs");

const {
    GET_TOURNAMENTS,
    GET_EVENTS,
    SetIDQueryCreation,
    SetQueryCreation,
    PlayerQueryCreation,
    GetPhaseGroupsFromPhasesQuery,
    RetrieveSetIDsWithPhaseGroups,
} = require("./graphQLQueries");

const sqlDir = "./src/sql_files/";

require("dotenv").config();

// const pg = new PG.Pool({
//     user: process.env.PGUSER,
//     password: process.env.PGPASSWORD,
//     host: process.env.PGHOST,
//     database: process.env.PGDATABASE,
//     port: process.env.PGPORT,
// });

// const pgRR = new PG.Pool({
//     user: process.env.PGUSER,
//     password: process.env.PGPASSWORD,
//     host: process.env.PGHOST,
//     database: process.env.PGDATABASERR,
//     port: process.env.PGPORT,
// });

const delay = (time) => new Promise((resolve) => setTimeout(resolve, time));

async function CheckConnection(pg) {
    try {
        const client = await pg.connect();
        console.log("Successfully connected to PostgreSQL database!");
        client.release();
    } catch (err) {
        console.error("Error connecting to PostgreSQL database: ", err);
    }
}

async function ViewPlayers(pg) {
    try {
        let table = "SELECT * FROM Players";

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
    const getCurrentTournamentInfo = "SELECT * FROM Tournaments;";
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
            let results = await fetch("https://api.start.gg/gql/alpha", {
                method: "POST",

                headers: {
                    "Content-Type": "application/json",
                    Authorization: "Bearer " + process.env.AUTH_TOKEN,
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
            await delay(1000);
        }
        i++;
    }
    return tournamentIds;
}

// async function RetrieveRRTournaments(pg) {
//     let hasMore = true;
//     let tournamentIds = [];
//     let date = new Date(1000);
//     let i = 1;
//     const getCurrentTournamentInfo = "SELECT * FROM Tournaments;";
//     const res = await pgRR.query(getCurrentTournamentInfo);
//     const map = res.rows.reduce((map, obj) => {
//         const { tournamentid, latestupdate, tournamentname, slug } = obj;
//         map[tournamentid] = { latestupdate, tournamentname, slug };
//         return map;
//     }, {});

//     while (hasMore) {
//         let page = 1;
//         while (page <= 20 && hasMore) {
//             let results = await fetch("https://api.start.gg/gql/alpha", {
//                 method: "POST",

//                 headers: {
//                     "Content-Type": "application/json",
//                     Authorization: "Bearer " + process.env.AUTH_TOKEN,
//                 },

//                 body: JSON.stringify({
//                     query: GET_TOURNAMENTS,
//                     variables: {
//                         page: page,
//                         perPage: 500,
//                         SF6: 43868,
//                         AfterDate: date.getTime() / 1000,
//                     },
//                 }),
//             });
//             results = await results.json();
//             console.log(results);
//             hasMore = results.data.tournaments.nodes.length == 500;
//             let j = 1;
//             results.data.tournaments.nodes.forEach((tournament) => {
//                 let totalIds = (i - 1) * 10000 + (page - 1) * 500 + j;
//                 //let idIndex = Math.floor((totalIds - 1) / 10);
//                 if (
//                     tournament.name.toLowerCase().includes("rainier rushdown")
//                 ) {
//                     console.log(totalIds);
//                     if (
//                         !map[tournament.id] ||
//                         (map[tournament.id] &&
//                             map[tournament.id].latestupdate / 1000 <
//                                 tournament.updatedAt)
//                     ) {
//                         let log = `
//                     {
//                         CurrentEntry: ${totalIds}
//                         id: ${tournament.id},
//                         Name: ${tournament.name},
//                         Slug: ${tournament.slug},
//                         startAt: ${tournament.startAt},
//                     }
//                     `;

//                         // fs.appendFile("log.txt", log, (err) => {
//                         //     if (err) throw err;
//                         // });

//                         const insert = `
//                         INSERT INTO Tournaments(TournamentID, CreatedAt, LatestUpdate, TournamentName, Slug)
//                         VALUES($1, TO_TIMESTAMP($2), TO_TIMESTAMP($3), $4, $5)
//                         ON CONFLICT(TournamentID)
//                         DO UPDATE
//                         SET LatestUpdate = EXCLUDED.LatestUpdate,
//                             TournamentName = EXCLUDED.TournamentName,
//                             Slug = EXCLUDED.Slug
//                         WHERE Tournaments.LatestUpdate != EXCLUDED.LatestUpdate;
//                     `;
//                         pgRR.query(insert, [
//                             tournament.id,
//                             tournament.createdAt,
//                             tournament.updatedAt,
//                             tournament.name,
//                             tournament.slug,
//                         ]);
//                         tournamentIds.push(tournament.id);
//                     }
//                 }
//                 j++;
//             });

//             if (page == 20 && hasMore) {
//                 date.setTime(
//                     results.data.tournaments.nodes[499].startAt * 1000
//                 );
//             }
//             page++;
//             await delay(750);
//         }
//         i++;
//     }
//     return tournamentIds;
// }

async function RetrieveEventsBasedOnTournaments(
    pg,
    tournamentIds,
    eventPhases
) {
    let outdatedEvents = [];
    let totalEvents = 0;
    let i = 0;
    let groupSize = 350;
    const groupedIds = [];
    for (let i = 0; i < tournamentIds.length; i += groupSize) {
        groupedIds.push(tournamentIds.slice(i, i + groupSize));
    }

    while (i < groupedIds.length) {
        const getEventsQuery = "SELECT * FROM Events WHERE TournamentID = $1";
        const existingEvents = [];
        let j = 0;
        while (j < groupedIds[i].length) {
            let res = await pg.query(getEventsQuery, [groupedIds[i][j]]);
            if (res.rows) existingEvents.push(res.rows);
            j++;
        }

        const eventsMap = existingEvents.reduce((map, obj) => {
            const { eventid, latestupdate, eventname, slug } = obj;
            map[eventid] = { latestupdate, eventname, slug };
            return map;
        }, {});

        let results = await fetch("https://api.start.gg/gql/alpha", {
            method: "POST",

            headers: {
                "Content-Type": "application/json",
                Authorization: "Bearer " + process.env.AUTH_TOKEN,
            },

            body: JSON.stringify({
                query: GET_EVENTS,
                variables: {
                    perPage: 350,
                    tournamentIDs: groupedIds[i],
                    SF6: 43868,
                },
            }),
        });

        results = await results.json();
        console.log(results);
        results.data.tournaments.nodes.forEach((tournament) => {
            let id = tournament.id;
            tournament.events.forEach((event) => {
                if (
                    !eventsMap[event.id] ||
                    (eventsMap[event.id] &&
                        eventsMap[event.id].latestupdate / 1000 <
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
                    //tournamentIds.get(id).set(event.id, new Map());
                    outdatedEvents.push({
                        EventID: event.id,
                        TournamentID: id,
                    });

                    let phaseIDs = [];
                    if (event.phases) {
                        event.phases.forEach((phase) => {
                            phaseIDs.push(phase.id);
                        });
                    }

                    eventPhases[event.id] = {
                        PhaseIDs: phaseIDs,
                    };

                    console.log(phaseIDs);
                }
            });
        });
        i++;
        await delay(750);
    }
    return outdatedEvents;
}

async function RetrievePlayersFromEvents(pg, events) {
    const entrantPlayers = {};
    let numEntrants = 0;
    let highestQueryComplexity = 0;
    let i = 0;
    let args = {};
    while (i < events.length || Object.keys(args).length != 0) {
        let start = i;
        while (Object.keys(args).length < 20 && i < events.length) {
            args[events[i].EventID] = {
                page: 1,
            };
            i++;
        }

        const query = PlayerQueryCreation(Object.keys(args).length);

        let queryArgs = {};

        let j = 1;
        for (const eventID in args) {
            queryArgs[`E${j}`] = eventID;
            queryArgs[`P${j}`] = args[eventID].page;
            j++;
        }

        queryArgs["perPage"] = 15;

        let results = await fetch("https://api.start.gg/gql/alpha", {
            method: "POST",

            headers: {
                "Content-Type": "application/json",
                Authorization: "Bearer " + process.env.AUTH_TOKEN,
            },

            body: JSON.stringify({
                query: query,
                variables: queryArgs,
            }),
        });

        try {
            results = await results.json();

            console.log(
                "Query Complexity: " + results.extensions.queryComplexity
            );

            highestQueryComplexity = Math.max(
                highestQueryComplexity,
                results.extensions.queryComplexity
            );

            let data = results.data;

            for (const event in data) {
                if (data[event]) {
                    data[event].entrants.nodes.forEach((entrant) => {
                        if (
                            entrant.participants[0] &&
                            entrant.participants[0].player
                        ) {
                            numEntrants++;
                            let playerID = entrant.participants[0].player.id;
                            let playerGamerTag =
                                entrant.participants[0].player.gamerTag;
                            let playerSlug = "";
                            if (entrant.participants[0].player.user) {
                                playerSlug =
                                    entrant.participants[0].player.user.slug;
                            }

                            const insertOrUpdatePlayer = `
                                    INSERT INTO Players(PlayerID, GamerTag, Slug)
                                    VALUES($1, $2, $3)
                                    ON CONFLICT(PlayerID)
                                    DO UPDATE
                                    SET GamerTag = EXCLUDED.GamerTag,
                                        Slug = EXCLUDED.Slug
                                    `;

                            pg.query(insertOrUpdatePlayer, [
                                playerID,
                                playerGamerTag,
                                playerSlug,
                            ]);

                            entrantPlayers[entrant.id] = playerID;

                            console.log(
                                `${playerID}: ${entrant.participants[0].player.gamerTag}`
                            );
                        }
                    });
                    if (data[event].entrants.nodes.length != 15) {
                        delete args[data[event].id];
                    } else {
                        args[data[event].id].page += 1;
                    }
                }
            }
            console.log(i + "/" + events.length);
        } catch (err) {
            console.log(err);
            hasMore = true;
        }
        await delay(750);
    }
    console.log("Entrants: " + numEntrants);
    console.log("Highest Query Complexity: " + highestQueryComplexity);
    return entrantPlayers;
}

async function RetrieveSetIDsFromEventPhases(
    eventPhases,
    setIDEvents,
    exceededEntries
) {
    let args = {};
    let i = 0;
    let setIDs = [];
    let highestQueryComplexity = 0;
    const eventKeys = Object.keys(eventPhases);
    while (i < eventKeys.length || Object.keys(args).length != 0) {
        while (Object.keys(args).length < 500 && i < eventKeys.length) {
            if (eventPhases[eventKeys[i]].PhaseIDs.length != 0) {
                args[eventKeys[i]] = {
                    PhasePos: 0,
                    page: 1,
                };
            }
            i++;
        }

        let queryArgs = {};
        let j = 1;
        for (const eventID in args) {
            queryArgs[`eventID${j}`] = eventID;
            queryArgs[`phaseID${j}`] =
                eventPhases[eventID].PhaseIDs[args[eventID].PhasePos];
            queryArgs[`page${j}`] = args[eventID].page;
            j++;
        }

        queryArgs[`perPage`] = 100;

        let query = SetIDQueryCreation(Object.keys(args).length);

        let results = await fetch("https://api.start.gg/gql/alpha", {
            method: "POST",

            headers: {
                "Content-Type": "application/json",
                Authorization: "Bearer " + process.env.AUTH_TOKEN,
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

            for (const event in data) {
                if (data[event]) {
                    let id = data[event].id;
                    console.log("EventID: " + id);
                    console.log(
                        `Phase position: ${args[id].PhasePos} and PhaseID: ${
                            eventPhases[id].PhaseIDs[args[id].PhasePos]
                        }`
                    );
                    console.log("Current page: " + args[id].page);

                    if (data[event].sets.pageInfo.totalPages > 100) {
                        exceededEntries[
                            eventPhases[id].PhaseIDs[args[id].PhasePos]
                        ] = id;
                        delete args[id];
                    } else {
                        data[event].sets.nodes.forEach((set) => {
                            setIDs.push(set.id);
                            setIDEvents[set.id] = id;
                        });

                        if (
                            args[id].pages <
                            data[event].sets.pageInfo.totalPages
                        ) {
                            args[id].page += 1;
                        } else if (
                            args[id].PhasePos + 1 <
                            eventPhases[id].PhaseIDs.length
                        ) {
                            args[id].PhasePos += 1;
                            args[id].page = 1;
                        } else {
                            delete args[id];
                        }
                    }
                }
            }

            console.log("Highest Query Complexity: " + highestQueryComplexity);
            console.log(i + "/" + eventKeys.length);
        } catch (err) {
            console.error(err);
        }
        await delay(750);
    }
    return setIDs;
}

async function RetrievePhaseGroupsFromPhases(exceededEntries) {
    let i = 0;
    let entryKeys = Object.keys(exceededEntries);
    let highestQueryComplexity = 0;
    let phaseGroupEvents = {};
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

        let results = await fetch("https://api.start.gg/gql/alpha", {
            method: "POST",

            headers: {
                "Content-Type": "application/json",
                Authorization: "Bearer " + process.env.AUTH_TOKEN,
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
            console.log("Highest Query Complexity: " + highestQueryComplexity);
            console.log(i + "/" + entryKeys.length);
        } catch (err) {
            console.error(err);
        }
        await delay(750);
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

        let results = await fetch("https://api.start.gg/gql/alpha", {
            method: "POST",

            headers: {
                "Content-Type": "application/json",
                Authorization: "Bearer " + process.env.AUTH_TOKEN,
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
    }
}

async function RetrieveSetInfoWithSetIDs(pg, entrantPlayers, setIDEvents) {
    let i = 0;
    let highestQueryComplexity = 0;
    const setIDs = Object.keys(setIDEvents);
    while (i < setIDs.length) {
        let setIDArgs = [];
        while (i < setIDs.length && setIDArgs.length < 150) {
            setIDArgs.push(setIDs[i]);
            i++;
        }

        let query = SetQueryCreation(setIDArgs.length);
        let queryArgs = {};

        for (let j = 0; j < setIDArgs.length; j++) {
            queryArgs["setID" + (j + 1)] = setIDArgs[j];
        }

        let results = await fetch("https://api.start.gg/gql/alpha", {
            method: "POST",

            headers: {
                "Content-Type": "application/json",
                Authorization: "Bearer " + process.env.AUTH_TOKEN,
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
                if (typeof setID != "string" && data[set].winnerId) {
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

                    let playerOneID;
                    let playerTwoID;
                    let playerOneScore = 0;
                    let playerTwoScore = 0;
                    let hasDQ = false;
                    let winnerId;
                    if (entrants[0]) {
                        playerOneID = entrantPlayers[entrants[0]];
                    }

                    if (entrants[1]) {
                        playerTwoID = entrantPlayers[entrants[1]];
                    }
                    const score = data[set].displayScore;

                    console.log(score);
                    if (score && score != "DQ") {
                        const scoreRegex =
                            /^(.*)\s(\d+|W|L)\s-\s(.*)\s(\d+|W|L)$/i;
                        const match = score.match(scoreRegex);
                        if (match[2] != "W" && match[2] != "L") {
                            playerOneScore = match[2];
                        }

                        if (match[4] != "W" && match[4] != "L") {
                            playerTwoScore = match[4];
                        }
                    } else if (score && score == "DQ") {
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
            console.log("Highest Query Complexity: " + highestQueryComplexity);
            console.log(i + "/" + setIDs.length);
        } catch (err) {
            console.error(err);
        }
        await delay(750);
    }
}

async function Test(pg) {
    let date = new Date(1);
    console.log(date);
    date.setTime(1734307200 * 1000);
    console.log(date);

    try {
        let query = "SELECT TournamentID, LatestUpdate FROM Tournaments;";
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
    //RetrieveRRTournaments,
    RetrieveEventsBasedOnTournaments,
    RetrieveSetIDsFromEventPhases,
    RetrievePlayersFromEvents,
    RetrievePhaseGroupsFromPhases,
    RetrieveSetIDsFromEventPhaseGroups,
    RetrieveSetInfoWithSetIDs,
    Test,
    ExecuteQuery,
    GetSQLFileNames,
};
