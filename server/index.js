const sql = require("mssql");
const express = require("express");
const cors = require("cors");
const PG = require("pg");
const fs = require("fs");
const path = require("path");

require("dotenv").config();

const app = express();
app.use(cors());

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

const GET_PLAYERS_WITHIN_EVENT = `
    query ($eventID: ID! $perPage: Int! $page: Int!) {
        event(id: $eventID) {
            slug
            entrants(query: {
                page: $page
                perPage: $perPage
            }) {
                nodes {
                    id
                    name
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
    }
`;

const GET_PLAYERS_WITHIN_EVENT_TEST = `
    query ($tournamentIDs: [ID]! $eventIDs: [ID]! $perPage: Int! $page: Int!) {
        tournaments(query: {
            filter: {
                ids: $tournamentIDs
            }
        }) {
            nodes {
                id
                events(filter: {
                    ids: $eventIDs
                }) {
                    id
                    entrants(query: {
                        perPage: $perPage
                        page: $page
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
            }
        }
    }
`;

const GET_SETS = `
    query ($EventID: ID!) {
        event(id: $EventID) {
            sets {
                nodes { 
                    slots {
                        standing {
                            entrant {
                                id
                                participants {
                                    player {
                                        id
                                        gamerTag
                                    }
                                }
                            }
                        }
                        stats {
                            score {
                                value
                            }
                        }
                    }
                    winnerId
                }
            }
        }
    }
`;

const GET_USERS = `
    query ($page: Int!, $perPage: Int!, $SF6: ID!) {
        tournaments(
            query: {
                filter: { 
                    videogameIds: [
                        $SF6
                    ]
                    past: true
                }
                page: $page
                perPage: $perPage
            }
        ) {
            nodes {
                id
                events(filter: { videogameId: [$SF6] published: true type: 1 }) {
                    id
                    entrants {
                        nodes {
                            id
                            name
                        }
                    }
                }
            }
        }
    }
`;

const GET_SETS_FOR_ENTRANT = `
    query($entrantID: ID!) {
        entrant(id: $EntrantID) {
            id
            name
            paginatedSets {
                nodes {
                    displayScore(mainEntrantId: $EntrantID)
                    winnerId
                    slots {
                        entrant {
                            id
                            name
                            participants {
                                id
                                gamerTag
                                player {
                                    id
                                    gamerTag
                                }
                                user {
                                    id
                                    discriminator
                                    slug
                                }
                            }
                        }
                    }
                }
            }
        }
    }
`;

const pg = new PG.Pool({
    user: process.env.PGUSER,
    password: process.env.PGPASSWORD,
    host: process.env.PGHOST,
    database: process.env.PGDATABASE,
    port: process.env.PGPORT,
});

const delay = (time) => new Promise((resolve) => setTimeout(resolve, time));

async function checkConnection() {
    try {
        const client = await pg.connect();
        console.log("Successfully connected to PostgreSQL database!");
        client.release();
    } catch (err) {
        console.error("Error connecting to PostgreSQL database: ", err);
    }
}

async function CreateTables() {
    try {
        var table = fs
            .readFileSync(path.resolve(__dirname, "./tableCreation.sql"))
            .toString();
        const res = await pg.query(table);
        console.log(res.rows);
    } catch (err) {
        console.error(err);
    }
}

async function ViewPlayers() {
    try {
        var table = "SELECT * FROM Players";

        const res = await pg.query(table);
        console.log(res.rows);
    } catch (err) {
        console.error(err);
    }
}

app.get("/", async (req, res) => {
    // new sql.Request().query("SELECT * FROM Players", (err, result) => {
    //     if (err) {
    //         console.error(err);
    //     } else {
    //         res.send(result.recordset);
    //         console.log(result.recordset);
    //     }
    // });
});

app.get("/GetInfo", async (req, res) => {
    var tournamentIds = await FetchTournaments();
    var eventPhases = {};
    var events = await RetrieveEventsBasedOnTournaments(
        tournamentIds,
        eventPhases
    );
    var setIDs = await RetrieveSetIDsFromEventPhases(eventPhases);
    //var playerMap = await RetrievePlayersFromEvents(events, tournamentIds);
    var players = await RetrievePlayersFromEvents3(events);
    const jsonMap = JSON.stringify([...players]);
    fs.writeFileSync("playerMap.json", jsonMap);
    await SetRetrieval(players);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(tournamentIds));
});

async function FetchTournaments() {
    var hasMore = true;
    var tournamentIds = [];
    var date = new Date(1000);
    var i = 1;
    const getCurrentTournamentInfo = "SELECT * FROM Tournaments;";
    const res = await pg.query(getCurrentTournamentInfo);
    const map = res.rows.reduce((map, obj) => {
        const { tournamentid, latestupdate, tournamentname, slug } = obj;
        map[tournamentid] = { latestupdate, tournamentname, slug };
        return map;
    }, {});

    while (hasMore) {
        var page = 1;
        while (page <= 20 && hasMore) {
            var results = await fetch("https://api.start.gg/gql/alpha", {
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
            var j = 1;
            results.data.tournaments.nodes.forEach((tournament) => {
                var totalIds = (i - 1) * 10000 + (page - 1) * 500 + j;
                //var idIndex = Math.floor((totalIds - 1) / 10);
                console.log(totalIds);
                if (
                    !map[tournament.id] ||
                    (map[tournament.id] &&
                        map[tournament.id].latestupdate / 1000 <
                            tournament.updatedAt)
                ) {
                    var log = `
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
                        INSERT INTO Tournaments(TournamentID, LatestUpdate, TournamentName, Slug)
                        VALUES($1, TO_TIMESTAMP($2), $3, $4)
                        ON CONFLICT(TournamentID)
                        DO UPDATE
                        SET LatestUpdate = EXCLUDED.LatestUpdate,
                            TournamentName = EXCLUDED.TournamentName,
                            Slug = EXCLUDED.Slug
                        WHERE Tournaments.LatestUpdate != EXCLUDED.LatestUpdate;
                    `;
                    pg.query(insert, [
                        tournament.id,
                        tournament.updatedAt,
                        tournament.name,
                        tournament.slug,
                    ]);
                    tournamentIds.push(tournament.id);
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

async function RetrieveEventsBasedOnTournaments(tournamentIds, eventPhases) {
    var outdatedEvents = [];
    var totalEvents = 0;
    var i = 0;
    var groupSize = 350;
    const groupedIds = [];
    for (let i = 0; i < tournamentIds.length; i += groupSize) {
        groupedIds.push(tournamentIds.slice(i, i + groupSize));
    }

    while (i < groupedIds.length) {
        const getEventsQuery = "SELECT * FROM Events WHERE TournamentID = $1";
        const existingEvents = [];
        var j = 0;
        while (j < groupedIds[i].length) {
            var res = await pg.query(getEventsQuery, [groupedIds[i][j]]);
            if (res.rows) existingEvents.push(res.rows);
            j++;
        }

        const eventsMap = existingEvents.reduce((map, obj) => {
            const { eventid, latestupdate, eventname, slug } = obj;
            map[eventid] = { latestupdate, eventname, slug };
            return map;
        }, {});

        var results = await fetch("https://api.start.gg/gql/alpha", {
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
            var id = tournament.id;
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

                    var phaseIDs = [];
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

async function RetrievePlayersFromEvents(eventIds) {
    const players = new Map();
    var i = 0;
    while (i < eventIds.length) {
        var hasMore = true;
        var j = 1;
        while (hasMore) {
            var results = await fetch("https://api.start.gg/gql/alpha", {
                method: "POST",

                headers: {
                    "Content-Type": "application/json",
                    Authorization: "Bearer " + process.env.AUTH_TOKEN,
                },

                body: JSON.stringify({
                    query: GET_PLAYERS_WITHIN_EVENT,
                    variables: {
                        eventID: eventIds[i],
                        perPage: 300,
                        page: j,
                    },
                }),
            });

            console.log(eventIds[i]);
            results = await results.json();
            console.log(results);

            hasMore = results.data.event.entrants.nodes.length != 0;

            results.data.event.entrants.nodes.forEach((entrant) => {
                if (entrant.participants[0]) {
                    var playerId = entrant.participants[0].player.id;
                    var playerGamerTag =
                        entrant.participants[0].player.gamerTag;
                    var playerSlug = "";
                    if (entrant.participants[0].player.user) {
                        playerSlug = entrant.participants[0].player.user.slug;
                    }

                    const insertOrUpdatePlayer = `
                        INSERT INTO Players(PlayerID, GamerTag, TotalWins, TotalLosses, Slug)
                        VALUES($1, $2, $3, $4, $5)
                        ON CONFLICT(PlayerID)
                        DO UPDATE
                        SET GamerTag = EXCLUDED.GamerTag,
                            Slug = EXCLUDED.Slug
                    `;

                    pg.query(insertOrUpdatePlayer, [
                        playerId,
                        playerGamerTag,
                        0,
                        0,
                        playerSlug,
                    ]);

                    console.log(
                        `${playerId}: ${entrant.participants[0].player.gamerTag}`
                    );
                    if (!players.get(eventIds[i]))
                        players.set(eventIds[i], new Map());

                    players.get(eventIds[i]).set(playerId, entrant.id);
                }
            });
            j++;
            await delay(750);
        }
        console.log(`${i}/${eventIds.length}`);
        i++;
    }
    return players;
}

async function RetrievePlayersFromEvents2(events) {
    const players = new Map();

    var i = 0;
    while (i < events.length) {
        const tournamentIDs = [];
        const eventIDs = [];
        var start = i;
        for (; i < events.length && i < start + 20; i++) {
            if (!tournamentIDs[events[i].TournamentID])
                tournamentIDs.push(events[i].TournamentID);
            eventIDs.push(events[i].EventID);
        }

        var hasMore = true;
        var page = 1;
        while (hasMore) {
            hasMore = false;
            var results = await fetch("https://api.start.gg/gql/alpha", {
                method: "POST",

                headers: {
                    "Content-Type": "application/json",
                    Authorization: "Bearer " + process.env.AUTH_TOKEN,
                },

                body: JSON.stringify({
                    query: GET_PLAYERS_WITHIN_EVENT_TEST,
                    variables: {
                        tournamentIDs: tournamentIDs,
                        eventIDs: eventIDs,
                        perPage: 15,
                        page: page,
                    },
                }),
            });

            try {
                results = await results.json();

                console.log(results);
                results.data.tournaments.nodes.forEach((tournament) => {
                    var tournamentID = tournament.id;
                    tournament.events.forEach((event) => {
                        var eventID = event.id;
                        if (event.entrants.nodes.length == 15) hasMore = true;
                        event.entrants.nodes.forEach((entrant) => {
                            if (
                                entrant.participants[0] &&
                                entrant.participants[0].player
                            ) {
                                var playerID =
                                    entrant.participants[0].player.id;
                                var playerGamerTag =
                                    entrant.participants[0].player.gamerTag;
                                var playerSlug = "";
                                if (entrant.participants[0].player.user) {
                                    playerSlug =
                                        entrant.participants[0].player.user
                                            .slug;
                                }

                                const insertOrUpdatePlayer = `
                                    INSERT INTO Players(PlayerID, GamerTag, TotalWins, TotalLosses, Slug)
                                    VALUES($1, $2, $3, $4, $5)
                                    ON CONFLICT(PlayerID)
                                    DO UPDATE
                                    SET GamerTag = EXCLUDED.GamerTag,
                                        Slug = EXCLUDED.Slug
                                `;

                                pg.query(insertOrUpdatePlayer, [
                                    playerID,
                                    playerGamerTag,
                                    0,
                                    0,
                                    playerSlug,
                                ]);

                                players.set(entrant.id, playerID);

                                console.log(
                                    `${playerID}: ${entrant.participants[0].player.gamerTag}`
                                );
                            }
                        });
                    });
                });
                page++;
                console.log(i + "/" + events.length);
            } catch (err) {
                console.log(err);
                hasMore = true;
            }
            await delay(750);
        }
    }

    async function RetrievePlayersFromEvents2(events) {
        const players = new Map();

        var i = 0;
        while (i < events.length) {
            const tournamentIDs = [];
            const eventIDs = [];
            var start = i;
            for (; i < events.length && i < start + 20; i++) {
                if (!tournamentIDs[events[i].TournamentID])
                    tournamentIDs.push(events[i].TournamentID);
                eventIDs.push(events[i].EventID);
            }

            var hasMore = true;
            var page = 1;
            while (hasMore) {
                hasMore = false;
                var results = await fetch("https://api.start.gg/gql/alpha", {
                    method: "POST",

                    headers: {
                        "Content-Type": "application/json",
                        Authorization: "Bearer " + process.env.AUTH_TOKEN,
                    },

                    body: JSON.stringify({
                        query: GET_PLAYERS_WITHIN_EVENT_TEST,
                        variables: {
                            tournamentIDs: tournamentIDs,
                            eventIDs: eventIDs,
                            perPage: 15,
                            page: page,
                        },
                    }),
                });

                try {
                    results = await results.json();

                    console.log(results);
                    results.data.tournaments.nodes.forEach((tournament) => {
                        var tournamentID = tournament.id;
                        tournament.events.forEach((event) => {
                            var eventID = event.id;
                            if (event.entrants.nodes.length == 15)
                                hasMore = true;
                            event.entrants.nodes.forEach((entrant) => {
                                if (
                                    entrant.participants[0] &&
                                    entrant.participants[0].player
                                ) {
                                    var playerID =
                                        entrant.participants[0].player.id;
                                    var playerGamerTag =
                                        entrant.participants[0].player.gamerTag;
                                    var playerSlug = "";
                                    if (entrant.participants[0].player.user) {
                                        playerSlug =
                                            entrant.participants[0].player.user
                                                .slug;
                                    }

                                    const insertOrUpdatePlayer = `
                                    INSERT INTO Players(PlayerID, GamerTag, TotalWins, TotalLosses, Slug)
                                    VALUES($1, $2, $3, $4, $5)
                                    ON CONFLICT(PlayerID)
                                    DO UPDATE
                                    SET GamerTag = EXCLUDED.GamerTag,
                                        Slug = EXCLUDED.Slug
                                `;

                                    pg.query(insertOrUpdatePlayer, [
                                        playerID,
                                        playerGamerTag,
                                        0,
                                        0,
                                        playerSlug,
                                    ]);

                                    players.set(entrant.id, playerID);

                                    console.log(
                                        `${playerID}: ${entrant.participants[0].player.gamerTag}`
                                    );
                                }
                            });
                        });
                    });
                    page++;
                    console.log(i + "/" + events.length);
                } catch (err) {
                    console.log(err);
                    hasMore = true;
                }
                await delay(750);
            }
        }

        // for (var i = 0; i < tournamentIDArray.length; i += 15) {
        //     var currentTournaments = [];
        //     var currentEvents = [];
        //     currentTournaments.push(...tournamentIDArray.slice(i, i + 15));
        //     for (const key of currentTournaments) {
        //         const eventIDArray = Array.from(tournamentIDs.get(key).keys());
        //         //currentEvents.push(...eventIDArray);
        //         for (const event of eventIDArray) {
        //             currentEvents.push(event);
        //             totalEvents++;
        //         }
        //     }
        //     var hasMore = true;
        //     var j = 1;
        //     while (hasMore) {
        //         hasMore = false;
        //         var results = await fetch("https://api.start.gg/gql/alpha", {
        //             method: "POST",

        //             headers: {
        //                 "Content-Type": "application/json",
        //                 Authorization: "Bearer " + process.env.AUTH_TOKEN,
        //             },

        //             body: JSON.stringify({
        //                 query: GET_PLAYERS_WITHIN_EVENT_TEST,
        //                 variables: {
        //                     tournamentIDs: currentTournaments,
        //                     eventIDs: currentEvents,
        //                     perPage: 10,
        //                     page: j,
        //                 },
        //             }),
        //         });

        //         results = await results.json();

        //         console.log(results);
        //         results.data.tournaments.nodes.forEach((tournament) => {
        //             var tournamentID = tournament.id;
        //             tournament.events.forEach((event) => {
        //                 var eventID = event.id;
        //                 if (event.entrants.nodes.length == 10) hasMore = true;
        //                 event.entrants.nodes.forEach((entrant) => {
        //                     if (
        //                         entrant.participants[0] &&
        //                         entrant.participants[0].player
        //                     ) {
        //                         var playerID = entrant.participants[0].player.id;
        //                         var playerGamerTag =
        //                             entrant.participants[0].player.gamerTag;
        //                         var playerSlug = "";
        //                         if (entrant.participants[0].player.user) {
        //                             playerSlug =
        //                                 entrant.participants[0].player.user.slug;
        //                         }

        //                         const insertOrUpdatePlayer = `
        //                             INSERT INTO Players(PlayerID, GamerTag, TotalWins, TotalLosses, Slug)
        //                             VALUES($1, $2, $3, $4, $5)
        //                             ON CONFLICT(PlayerID)
        //                             DO UPDATE
        //                             SET GamerTag = EXCLUDED.GamerTag,
        //                                 Slug = EXCLUDED.Slug
        //                         `;

        //                         pg.query(insertOrUpdatePlayer, [
        //                             playerID,
        //                             playerGamerTag,
        //                             0,
        //                             0,
        //                             playerSlug,
        //                         ]);

        //                         console.log(
        //                             `${playerID}: ${entrant.participants[0].player.gamerTag}`
        //                         );
        //                         if (
        //                             !tournamentIDs
        //                                 .get(tournamentID)
        //                                 .get(eventID)
        //                                 .has(playerID)
        //                         )
        //                             tournamentIDs
        //                                 .get(tournamentID)
        //                                 .get(eventID)
        //                                 .set(playerID, []);
        //                         tournamentIDs
        //                             .get(tournamentID)
        //                             .get(eventID)
        //                             .get(playerID)
        //                             .push(entrant.id);
        //                     }
        //                 });
        //             });
        //         });
        //         j++;
        //         await delay(750);
        //     }
        //     console.log(`${i}/${tournamentIDArray.length}`);
        // }

        return players;
    }
}

async function RetrievePlayersFromEvents3(events) {
    const players = new Map();
    var numEntrants = 0;
    var highestQueryComplexity = 0;
    var i = 0;
    const eventIDMap = new Map();
    while (i < events.length) {
        var start = i;
        while (eventIDMap.size < 20 && i < events.length) {
            eventIDMap.set(events[i].EventID, 1);
            i++;
        }

        const query = PlayerQueryCreation(eventIDMap.size);

        var arguments = {};

        var keys = Array.from(eventIDMap.keys());
        for (var j = 0; j < keys.length; j++) {
            arguments["E" + (j + 1)] = keys[j];
            arguments["P" + (j + 1)] = eventIDMap.get(keys[j]);
        }
        arguments["perPage"] = 15;

        var results = await fetch("https://api.start.gg/gql/alpha", {
            method: "POST",

            headers: {
                "Content-Type": "application/json",
                Authorization: "Bearer " + process.env.AUTH_TOKEN,
            },

            body: JSON.stringify({
                query: query,
                variables: arguments,
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

            var data = results.data;

            for (const event in data) {
                if (data[event]) {
                    data[event].entrants.nodes.forEach((entrant) => {
                        if (
                            entrant.participants[0] &&
                            entrant.participants[0].player
                        ) {
                            numEntrants++;
                            var playerID = entrant.participants[0].player.id;
                            var playerGamerTag =
                                entrant.participants[0].player.gamerTag;
                            var playerSlug = "";
                            if (entrant.participants[0].player.user) {
                                playerSlug =
                                    entrant.participants[0].player.user.slug;
                            }

                            const insertOrUpdatePlayer = `
                                    INSERT INTO Players(PlayerID, GamerTag, TotalWins, TotalLosses, Slug)
                                    VALUES($1, $2, $3, $4, $5)
                                    ON CONFLICT(PlayerID)
                                    DO UPDATE
                                    SET GamerTag = EXCLUDED.GamerTag,
                                        Slug = EXCLUDED.Slug
                                    `;

                            pg.query(insertOrUpdatePlayer, [
                                playerID,
                                playerGamerTag,
                                0,
                                0,
                                playerSlug,
                            ]);

                            players.set(entrant.id, playerID);

                            console.log(
                                `${playerID}: ${entrant.participants[0].player.gamerTag}`
                            );
                        }
                    });
                    if (data[event].entrants.nodes.length != 15) {
                        eventIDMap.delete(data[event].id);
                    } else {
                        eventIDMap.set(
                            data[event].id,
                            eventIDMap.get(data[event].id) + 1
                        );
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
    return players;
}

// async function SetRetrieval(playerMap) {
//     var i = 0;
//     var entrantIDs = Array.from(playerMap.keys());
//     var highestQueryComplexity = 0;
//     var entrants = new Map();
//     while (i < entrantIDs.length) {
//         var arguments = {};
//         while (entrants.size < 40 && i < entrantIDs.length) {
//             entrants.set(entrantIDs[i], 1);
//             i++;
//         }

//         var keys = Array.from(entrants.keys());
//         for (var j = 0; j < keys.length; j++) {
//             arguments["E" + (j + 1)] = keys[j];
//             arguments["P" + (j + 1)] = entrants.get(keys[j]);
//         }
//         arguments["perPage"] = 2;

//         var query = SetQueryCreation(entrants.size);

//         var results = await fetch("https://api.start.gg/gql/alpha", {
//             method: "POST",

//             headers: {
//                 "Content-Type": "application/json",
//                 Authorization: "Bearer " + process.env.AUTH_TOKEN,
//             },

//             body: JSON.stringify({
//                 query: query,
//                 variables: arguments,
//             }),
//         });

//         try {
//             results = await results.json();

//             console.log(results);

//             highestQueryComplexity = Math.max(
//                 highestQueryComplexity,
//                 results.extensions.queryComplexity
//             );

//             var data = results.data;

//             for (const entrant in data) {
//                 if (data[entrant]) {
//                     const mainEntrantID = data[entrant].id;
//                     data[entrant].paginatedSets.nodes.forEach((set) => {
//                         const setID = set.id;
//                         set.slots.forEach((slot) => {
//                             if (
//                                 slot.standing &&
//                                 slot.standing.stats &&
//                                 slot.standing.stats.score
//                             ) {
//                                 console.log(
//                                     "Value: " + slot.standing.stats.score.value
//                                 );
//                                 console.log(
//                                     "Display Value: " +
//                                         slot.standing.stats.score.displayValue
//                                 );
//                             }
//                         });
//                         const winnerEntrantID = set.winnerId;
//                     });

//                     if (data[entrant].paginatedSets.nodes.length == 2) {
//                         entrants.set(
//                             mainEntrantID,
//                             entrants.get(mainEntrantID) + 1
//                         );
//                     } else {
//                         entrants.delete(mainEntrantID);
//                     }
//                 }
//             }
//             console.log("Highest Query Complexity: " + highestQueryComplexity);
//             console.log(i + "/" + entrantIDs.length);
//         } catch (err) {
//             console.log(err);
//         }
//         await delay(750);
//     }
// }

async function SetRetrieval(playerMap) {
    var i = 0;
    var entrantIDs = Array.from(playerMap.keys());
    var highestQueryComplexity = 0;
    var entrants = new Map();
    var setIDs = [];
    while (i < entrantIDs.length) {
        var arguments = {};
        while (entrants.size < 200 && i < entrantIDs.length) {
            entrants.set(entrantIDs[i], 1);
            i++;
        }

        var keys = Array.from(entrants.keys());
        for (var j = 0; j < keys.length; j++) {
            arguments["E" + (j + 1)] = keys[j];
            arguments["P" + (j + 1)] = entrants.get(keys[j]);
        }
        arguments["perPage"] = 15;

        var query = SetQueryCreation(entrants.size);

        var results = await fetch("https://api.start.gg/gql/alpha", {
            method: "POST",

            headers: {
                "Content-Type": "application/json",
                Authorization: "Bearer " + process.env.AUTH_TOKEN,
            },

            body: JSON.stringify({
                query: query,
                variables: arguments,
            }),
        });

        try {
            results = await results.json();

            console.log(results);

            highestQueryComplexity = Math.max(
                highestQueryComplexity,
                results.extensions.queryComplexity
            );

            var data = results.data;

            for (const entrant in data) {
                if (data[entrant]) {
                    const mainEntrantID = data[entrant].id;
                    data[entrant].paginatedSets.nodes.forEach((set) => {
                        if (setIDs.indexOf(set.id) == -1) setIDs.push(set.id);
                    });

                    if (data[entrant].paginatedSets.nodes.length == 15) {
                        entrants.set(
                            mainEntrantID,
                            entrants.get(mainEntrantID) + 1
                        );
                    } else {
                        entrants.delete(mainEntrantID);
                    }
                }
            }
            console.log("Highest Query Complexity: " + highestQueryComplexity);
            console.log(i + "/" + entrantIDs.length);
        } catch (err) {
            console.log(err);
        }
        await delay(750);
    }
    return setIDs;
}

async function RetrieveSetIDsFromEventPhases(eventPhases) {
    var args = {};
    var i = 0;
    var setIDs = [];
    var highestQueryComplexity = 0;
    const eventKeys = Object.keys(eventPhases);
    while (i < eventKeys.length) {
        while (Object.keys(args).length < 500 && i < eventKeys.length) {
            if (eventPhases[eventKeys[i]].PhaseIDs.length != 0) {
                args[eventKeys[i]] = {
                    PhasePos: 0,
                    page: 1,
                };
            }
            i++;
        }

        var arguments = {};
        var j = 1;
        for (const eventID in args) {
            arguments[`eventID${j}`] = eventID;
            arguments[`phaseID${j}`] =
                eventPhases[eventID].PhaseIDs[args[eventID].PhasePos];
            arguments[`page${j}`] = args[eventID].page;
            j++;
        }

        arguments[`perPage`] = 15;

        var query = SetQueryCreation(Object.keys(args).length);

        var results = await fetch("https://api.start.gg/gql/alpha", {
            method: "POST",

            headers: {
                "Content-Type": "application/json",
                Authorization: "Bearer " + process.env.AUTH_TOKEN,
            },

            body: JSON.stringify({
                query: query,
                variables: arguments,
            }),
        });

        try {
            results = await results.json();

            console.log(results);

            highestQueryComplexity = Math.max(
                highestQueryComplexity,
                results.extensions.queryComplexity
            );

            var data = results.data;

            for (const event in data) {
                if (data[event]) {
                    var id = data[event].id;
                    console.log("EventID: " + id);
                    console.log(
                        `Phase position: ${args[id].PhasePos} and PhaseID: ${
                            eventPhases[id].PhaseIDs[args[id].PhasePos]
                        }`
                    );
                    console.log("Current page: " + args[id].page);
                    data[event].sets.nodes.forEach((set) => {
                        setIDs.push(set.id);
                    });

                    if (data[event].sets.nodes.length == 15) {
                        args[id].page += 1;
                    } else {
                        if (
                            args[id].PhasePos + 1 <
                            eventPhases[id].PhaseIDs.length
                        ) {
                            args[id].PhasePos += 1;
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

async function test() {
    var date = new Date(1);
    console.log(date);
    date.setTime(1734307200 * 1000);
    console.log(date);

    try {
        var query = "SELECT TournamentID, LatestUpdate FROM Tournaments;";
        const res = await pg.query(query);
        console.log(res.rows);
    } catch (err) {
        console.error(err);
    }
}

function PlayerQueryCreation(numEvents) {
    var query = `query (`;
    for (var i = 0; i < numEvents; i++) {
        query += `$E${i + 1}: ID! $P${i + 1}: Int! `;
    }

    query += `$perPage: Int!) {`;
    for (var i = 0; i < numEvents; i++) {
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

// function SetQueryCreation(numPlayers) {
//     var query = `query (`;
//     for (var i = 0; i < numPlayers; i++) {
//         query += `$E${i + 1}: ID! $P${i + 1}: Int! `;
//     }

//     query += `$perPage: Int!) {`;

//     for (var i = 0; i < numPlayers; i++) {
//         query += `E${i + 1}: entrant(id: $E${i + 1}) {
//             id
//             paginatedSets(perPage: $perPage page: $P${i + 1}) {
//                 nodes {
//                     id
//                     slots {
//                         id
//                         standing {
//                             id
//                             stats {
//                                 score {
//                                     value
//                                     displayValue
//                                 }
//                             }
//                         }
//                     }
//                     winnerId
//                 }
//             }
//         }`;
//     }
//     query += `}`;
//     return query;
// }

// function SetQueryCreation(numPlayers) {
//     var query = `query (`;
//     for (var i = 0; i < numPlayers; i++) {
//         query += `$E${i + 1}: ID! $P${i + 1}: Int! `;
//     }

//     query += `$perPage: Int!) {`;

//     for (var i = 0; i < numPlayers; i++) {
//         query += `E${i + 1}: entrant(id: $E${i + 1}) {
//             id
//             paginatedSets(perPage: $perPage page: $P${i + 1}) {
//                 nodes {
//                     id
//                 }
//             }
//         }`;
//     }
//     query += `}`;
//     return query;
// }

function SetQueryCreation(numEvents) {
    var query = `query (`;
    for (var i = 0; i < numEvents; i++) {
        query += `$eventID${i + 1}: ID! $phaseID${i + 1}: ID! $page${
            i + 1
        }: Int! `;
    }

    query += `$perPage: Int!) {`;

    for (var i = 0; i < numEvents; i++) {
        query += `E${i + 1}: event(id: $eventID${i + 1}) {
            id
            sets(page: $page${i + 1} perPage: $perPage filters: {
                phaseIds: [$phaseID${i + 1}]
            }) {
                nodes {
                    id
                }
            }
        }`;
    }
    query += `}`;
    return query;
}

app.post("/addUser", (req, res) => {});

app.get("/testSetRetrieval", async (req, res) => {
    const players = fs
        .readFileSync(path.resolve(__dirname, "./playerMap.json"))
        .toString();
    const playersJSON = JSON.parse(players);
    var playerMap = new Map();
    for (var i = 0; i < playersJSON.length; i++) {
        playerMap.set(playersJSON[i][0], playersJSON[i][1]);
    }

    var setIDs = await SetRetrieval(playerMap);
});

app.get("/getPlayers", async (req, res) => {
    const query = "SELECT EventId FROM Events;";
    const results = await pg.query(query);
    const eventIds = results.rows.map((obj) => {
        return obj.eventid;
    });
    var playerMap = await RetrievePlayersFromEvents(eventIds);
    console.log("Debug");
});

app.get("/test", async (req, res) => {
    const query = "SELECT EventId FROM Events;";
    const results = await pg.query(query);
    const eventIds = results.rows.map((obj) => {
        return obj.eventid;
    });
    console.log(eventIds);
    console.log(results);
});

app.get("/clear", async (req, res) => {
    const query = fs
        .readFileSync(path.resolve(__dirname, "./tableClear.sql"))
        .toString();

    await pg.query(query);
    console.log("Tables Cleared");
    res.send("Tables Cleared");
});

checkConnection();

CreateTables();

ViewPlayers();

test();

app.listen(3001, () => {
    console.log("Listening...");
});
