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
    RetrieveEventsBasedOnTournaments,
    RetrievePlayersFromEvents,
    RetrieveSetIDsFromEventPhases,
    RetieveSetInfoWithSetIDs,
    Test,
    ClearTables,
} = require("./startggDataRetrieval");

require("dotenv").config();

const app = express();
app.use(cors());

const pg = new PG.Pool({
    user: process.env.PGUSER,
    password: process.env.PGPASSWORD,
    host: process.env.PGHOST,
    database: process.env.PGDATABASE,
    port: process.env.PGPORT,
});

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
    var players = await RetrievePlayersFromEvents(events);
    await RetieveSetInfoWithSetIDs(setIDs, players);
    const jsonMap = JSON.stringify([...players]);
    fs.writeFileSync("playerMap.json", jsonMap);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(tournamentIds));
});

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

app.get("/clear", async (req, res) => {
    if (await ClearTables()) {
        res.send("Tables Cleared");
        console.log("Tables Cleared");
    } else {
        res.send("Failed to clear tables");
        console.log("Failed to clear tables");
    }
});

CheckConnection();

CreateTables();

ViewPlayers();

Test();

app.listen(3001, () => {
    console.log("Listening...");
});
