const express = require("express");
const cors = require("cors");
const PG = require("pg");
const fs = require("fs");
const path = require("path");

const {
    CheckConnection,
    CreateTables,
    ViewPlayers,
    FetchTournaments,
    //RetrieveRRTournaments,
    RetrieveEventsBasedOnTournaments,
    RetrievePlayersFromEvents,
    RetrieveSetIDsFromEventPhases,
    RetieveSetInfoWithSetIDs,
    Test,
    ClearTables,
    DropTables,
} = require("./startggDataRetrieval");

require("dotenv").config();

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
    await CreateTables(false);
    let tournamentIds = await FetchTournaments();
    let eventPhases = {};
    let exceededEntries = {};
    let setIDEvents = {};
    let events = await RetrieveEventsBasedOnTournaments(
        tournamentIds,
        eventPhases
    );
    let setIDs = await RetrieveSetIDsFromEventPhases(
        eventPhases,
        setIDEvents,
        exceededEntries
    );
    let players = await RetrievePlayersFromEvents(events);
    await RetieveSetInfoWithSetIDs(setIDs, players, setIDEvents);

    const jsonMap = JSON.stringify([...players]);
    fs.writeFileSync("playerMap.json", jsonMap);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(tournamentIds));
});

app.get("/getRainierRushdownInfo", async (req, res) => {
    await CreateTables(pgRR);
    let eventPhases = {};
    let setIDEvents = {};
    let exceededEntries = [];
    let tournamentIDs = await FetchTournaments(pgRR, "rainier rushdown");
    let eventIDs = await RetrieveEventsBasedOnTournaments(
        pgRR,
        tournamentIDs,
        eventPhases
    );
    let entrantPlayers = await RetrievePlayersFromEvents(pg, eventIDs);
    let setIDs = await RetrieveSetIDsFromEventPhases(
        eventPhases,
        setIDEvents,
        exceededEntries
    );

    await RetieveSetInfoWithSetIDs(pgRR, setIDs, entrantPlayers, setIDEvents);
    res.send(setIDs);
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
    if (await ClearTables(false)) {
        res.send("Tables Cleared");
        console.log("Tables Cleared");
    } else {
        res.send("Failed to clear tables");
        console.log("Failed to clear tables");
    }
});

app.get("/clearRR", async (req, res) => {
    if (await ClearTables(true)) {
        res.send("Tables Cleared");
        console.log("Tables Cleared");
    } else {
        res.send("Failed to clear tables");
        console.log("Failed to clear tables");
    }
});

app.get("/dropTables", async (req, res) => {
    if (await DropTables(pg)) {
        res.send("Tables Dropped");
        console.log("Tables Dropped");
    } else {
        res.send("Failed to drop tables");
        console.log("Failed to drop tables");
    }
});

app.get("/dropTablesRR", async (req, res) => {
    if (await DropTables(pgRR)) {
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

app.listen(3001, () => {
    console.log("Listening...");
});
