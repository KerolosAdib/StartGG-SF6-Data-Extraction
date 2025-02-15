const express = require("express");
const cors = require("cors");
const PG = require("pg");
const fs = require("fs");
const path = require("path");

const {
    CheckConnection,
    ViewPlayers,
    FetchTournaments,
    //RetrieveRRTournaments,
    RetrieveEventsBasedOnTournaments,
    RetrievePlayersFromEvents,
    RetrieveSetIDsFromEventPhases,
    RetrievePhaseGroupsFromPhases,
    RetrieveSetIDsFromEventPhaseGroups,
    RetrieveSetInfoWithSetIDs,
    Test,
    ExecuteQuery,
    GetSQLFileNames,
} = require("./startggDataRetrieval");

require("dotenv").config();

const sqlQueries = [];

const app = express();

const pg = new PG.Pool({
    user: process.env.PGUSER,
    password: process.env.PGPASSWORD,
    host: process.env.PGHOST,
    database: process.env.PGDATABASE,
    port: process.env.PGPORT,
});

const pgRR = new PG.Pool({
    user: process.env.PGUSER,
    password: process.env.PGPASSWORD,
    host: process.env.PGHOST,
    database: process.env.PGDATABASERR,
    port: process.env.PGPORT,
});

app.use(cors());

app.get("/", async (req, res) => {
    const scoreRegex = /^(.*)\s(\d+|W|L)\s-\s(.*)\s(\d+|W|L)$/i;
    const example = "name 3 - other 2 3 -     0";
    const match = example.match(scoreRegex);
});

app.get("/GetInfo", async (req, res) => {
    await ExecuteQuery(pg, sqlQueries[4]);
    let tournamentIds = await FetchTournaments(pg);
    let eventPhases = {};
    let exceededEntries = {};
    let setIDEvents = {};
    //console.time("events");
    let events = await RetrieveEventsBasedOnTournaments(
        pg,
        tournamentIds,
        eventPhases
    );
    //console.timeEnd("events");
    let setIDs = await RetrieveSetIDsFromEventPhases(
        eventPhases,
        setIDEvents,
        exceededEntries
    );

    let phaseGroupEvents = await RetrievePhaseGroupsFromPhases(exceededEntries);

    if (Object.keys(phaseGroupEvents).length != 0) {
        await RetrieveSetIDsFromEventPhaseGroups(phaseGroupEvents, setIDEvents);
    }

    let players = await RetrievePlayersFromEvents(pg, events);
    await RetrieveSetInfoWithSetIDs(pg, players, setIDEvents);

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end("Done");
});

app.get("/getRainierRushdownInfo", async (req, res) => {
    await ExecuteQuery(pgRR, sqlQueries[4]);
    let eventPhases = {};
    let setIDEvents = {};
    let exceededEntries = [];
    let tournamentIDs = await FetchTournaments(pgRR, "rainier rushdown");
    let eventIDs = await RetrieveEventsBasedOnTournaments(
        pgRR,
        tournamentIDs,
        eventPhases
    );
    let entrantPlayers = await RetrievePlayersFromEvents(pgRR, eventIDs);
    await RetrieveSetIDsFromEventPhases(
        eventPhases,
        setIDEvents,
        exceededEntries
    );

    await RetrieveSetInfoWithSetIDs(pgRR, entrantPlayers, setIDEvents);
    await ExecuteQuery(pgRR, sqlQueries[1]);
    await ExecuteQuery(pgRR, sqlQueries[0]);
    res.send(Object.keys(setIDEvents));
});

app.post("/addUser", (req, res) => {});

app.get("/testSetRetrieval", async (req, res) => {
    const players = fs
        .readFileSync(path.resolve(__dirname, "./playerMap.json"))
        .toString();
    const playersJSON = JSON.parse(players);
    let playerMap = new Map();
    for (let i = 0; i < playersJSON.length; i++) {
        playerMap.set(playersJSON[i][0], playersJSON[i][1]);
    }

    let setIDs = await SetRetrieval(playerMap);
});

app.get("/testSetIDRetrieval", async (req, res) => {
    let eventPhases = {};
    eventPhases[1062317] = {
        PhaseIDs: [1563604, 1707269, 1707270, 1707271, 1707272, 1707273],
    };

    let setIDEvents = {};
    let setIDs = await RetrieveSetIDsFromEventPhases(eventPhases, setIDEvents);
    res.send("Done");
});

app.get("/clear", async (req, res) => {
    if (await ExecuteQuery(pg, sqlQueries[3])) {
        res.send("Tables Cleared");
        console.log("Tables Cleared");
    } else {
        res.send("Failed to clear tables");
        console.log("Failed to clear tables");
    }
});

app.get("/clearRR", async (req, res) => {
    if (await ExecuteQuery(pgRR, sqlQueries[3])) {
        res.send("Tables Cleared");
        console.log("Tables Cleared");
    } else {
        res.send("Failed to clear tables");
        console.log("Failed to clear tables");
    }
});

app.get("/dropTables", async (req, res) => {
    if (await ExecuteQuery(pg, sqlQueries[2])) {
        res.send("Tables Dropped");
        console.log("Tables Dropped");
    } else {
        res.send("Failed to drop tables");
        console.log("Failed to drop tables");
    }
});

app.get("/dropTablesRR", async (req, res) => {
    if (await ExecuteQuery(pgRR, sqlQueries[2])) {
        res.send("Tables Dropped");
        console.log("Tables Dropped");
    } else {
        res.send("Failed to drop tables");
        console.log("Failed to drop tables");
    }
});

CheckConnection(pg);

ViewPlayers(pg);

Test(pg);

GetSQLFileNames(sqlQueries);

app.listen(3001, () => {
    console.log("Listening...");
});
