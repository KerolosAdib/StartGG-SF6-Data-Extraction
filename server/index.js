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
    query ($tournamentIDs: [ID]! $eventIDs: [ID]! $eventsPerPage: Int! $eventsPage: Int! $entrantsPerPage: Int! $entrantsPage: Int!) {
        tournaments(query: {
            filter: {
                ids: $tournamentIDs
            }
        }) {
            nodes: {
                events(filter: {
                    ids: $eventIDs
                    perPage: $eventsPerPage
                    page: $eventsPage
                }) {
                    entrants(query: {
                        perPage: $entrantsPerPage
                        page: $entrantsPage
                    }) {
                        nodes: {
                            participants: {
                                player: {
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
    var events = await RetrieveEventsBasedOnTournaments(tournamentIds);
    var playerMap = await RetrievePlayersFromEvents(events, tournamentIds);
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

async function RetrieveEventsBasedOnTournaments(tournamentIds) {
    var outdatedEvents = [];
    var totalEvents = 0;
    var i = 0;
    var groupSize = 500;
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
                    perPage: 500,
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
                    outdatedEvents.push(event.id);
                }
            });
        });
        i++;
        await delay(1000);
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
                    if (players.get(eventIds[i])) {
                        players.get(eventIds[i]).push(playerId);
                    } else {
                        players.set(eventIds[i], [playerId]);
                    }
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

app.post("/addUser", (req, res) => {});

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
