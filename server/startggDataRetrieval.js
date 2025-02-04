const PG = require("pg");
const path = require("path");
const fs = require("fs");

const {
    GET_TOURNAMENTS,
    GET_EVENTS,
    SetIDQueryCreation,
    SetQueryCreation,
    PlayerQueryCreation,
} = require("./graphQLQueries");

require("dotenv").config();

const pg = new PG.Pool({
    user: process.env.PGUSER,
    password: process.env.PGPASSWORD,
    host: process.env.PGHOST,
    database: process.env.PGDATABASE,
    port: process.env.PGPORT,
});

const delay = (time) => new Promise((resolve) => setTimeout(resolve, time));

async function CheckConnection() {
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

        var args = {};
        var j = 1;
        for (const eventID in args) {
            args[`eventID${j}`] = eventID;
            args[`phaseID${j}`] =
                eventPhases[eventID].PhaseIDs[args[eventID].PhasePos];
            args[`page${j}`] = args[eventID].page;
            j++;
        }

        args[`perPage`] = 15;

        var query = SetIDQueryCreation(Object.keys(args).length);

        var results = await fetch("https://api.start.gg/gql/alpha", {
            method: "POST",

            headers: {
                "Content-Type": "application/json",
                Authorization: "Bearer " + process.env.AUTH_TOKEN,
            },

            body: JSON.stringify({
                query: query,
                variables: args,
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

async function RetrievePlayersFromEvents(events) {
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

        var args = {};

        var keys = Array.from(eventIDMap.keys());
        for (var j = 0; j < keys.length; j++) {
            args["E" + (j + 1)] = keys[j];
            args["P" + (j + 1)] = eventIDMap.get(keys[j]);
        }
        args["perPage"] = 15;

        var results = await fetch("https://api.start.gg/gql/alpha", {
            method: "POST",

            headers: {
                "Content-Type": "application/json",
                Authorization: "Bearer " + process.env.AUTH_TOKEN,
            },

            body: JSON.stringify({
                query: query,
                variables: args,
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

async function RetieveSetInfoWithSetIDs(setIDs, players) {
    var i = 0;
    var highestQueryComplexity = 0;
    while (i < setIDs.length) {
        var setIDArgs = [];
        while (i < setIDs.length && setIDArgs.length < 150) {
            setIDArgs.push(setIDs[i]);
            i++;
        }

        var query = SetQueryCreation(setIDArgs.length);
        var args = {};

        for (var j = 0; j < setIDArgs.length; j++) {
            args["setID" + (j + 1)] = setIDArgs[j];
        }

        var results = await fetch("https://api.start.gg/gql/alpha", {
            method: "POST",

            headers: {
                "Content-Type": "application/json",
                Authorization: "Bearer " + process.env.AUTH_TOKEN,
            },

            body: JSON.stringify({
                query: query,
                variables: args,
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

            for (const set in data) {
                var j = 1;
                if (data[set].slots) {
                    data[set].slots.forEach((slot) => {
                        if (slot.entrant)
                            console.log(`Player ${j}: ${slot.entrant.id}`);
                        j++;
                    });
                }

                console.log(data[set].displayScore);
                console.log(data[set].winnerId);
            }

            console.log("Highest Query Complexity: " + highestQueryComplexity);
            console.log(i + "/" + setIDs.length);
            setIDArgs = [];
        } catch (err) {
            console.error(err);
        }
        await delay(750);
    }
}

async function Test() {
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

async function ClearTables() {
    const query = fs
        .readFileSync(path.resolve(__dirname, "./tableClear.sql"))
        .toString();

    try {
        await pg.query(query);
    } catch (err) {
        return false;
    }
    return true;
}

module.exports = {
    CheckConnection,
    CreateTables,
    ViewPlayers,
    FetchTournaments,
    RetrieveEventsBasedOnTournaments,
    RetrieveSetIDsFromEventPhases,
    RetrievePlayersFromEvents,
    RetieveSetInfoWithSetIDs,
    Test,
    ClearTables,
};
