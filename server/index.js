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
    RetrieveRRTournaments,
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
    await CreateTables(false);
    var tournamentIds = await FetchTournaments();
    var eventPhases = {};
    var events = await RetrieveEventsBasedOnTournaments(
        tournamentIds,
        eventPhases
    );
    var setIDs = await RetrieveSetIDsFromEventPhases(eventPhases);
    await RetieveSetInfoWithSetIDs(setIDs, players);
    var players = await RetrievePlayersFromEvents(events);

    const jsonMap = JSON.stringify([...players]);
    fs.writeFileSync("playerMap.json", jsonMap);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(tournamentIds));
});

app.get("/getRainierRushdownInfo", async (req, res) => {
    await CreateTables(true);
    var tournamentIds = await RetrieveRRTournaments();
    res.send(tournamentIds);
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

ViewPlayers();

Test();

app.listen(3001, () => {
    console.log("Listening...");
});
