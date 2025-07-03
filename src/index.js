const express = require('express');
const cors = require('cors');
const PG = require('pg');
const fs = require('fs');
const path = require('path');

const {
    CheckConnection,
    ViewPlayers,
    FetchTournaments,
    RetrieveEventsBasedOnTournaments,
    RetrievePhasesBasedEvents,
    RetrieveEntrantsFromEvents,
    RetrieveParticipantIDsFromEntrants,
    RetrievePlayerIDsFromParticipantIDs,
    RetrievePlayerInfo,
    RetrieveSetIDsFromEventPhases,
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
} = require('./startggDataRetrieval');

require('dotenv').config();

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

app.get('/start', async (req, res) => {
    await Start();
    setInterval(Start, 86400000);
});

app.get('/GetInfo', async (req, res) => {
    await ExecuteQuery(pg, sqlQueries[4]);
    await RetrieveStartGGGlobalData();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end('Done');
});

app.get('/getRainierRushdownInfo', async (req, res) => {
    await ExecuteQuery(pgRR, sqlQueries[4]);
    let eventPhases = {};
    let setIDEvents = {};
    let exceededEntries = {};
    let tournamentIDs = await FetchTournaments(pgRR, 'rainier rushdown', [
        'rookie',
        'redemption',
    ]);
    let eventTournaments = await RetrieveEventsBasedOnTournaments(
        pgRR,
        tournamentIDs
    );
    console.timeEnd('events');
    const entrants = await RetrieveEntrantsFromEvents(eventTournaments);
    const participantEntrants = await RetrieveParticipantIDsFromEntrants(
        entrants
    );
    const entrantPlayers = await RetrievePlayerIDsFromParticipantIDs(
        participantEntrants
    );
    const nullPlayers = await RetrievePlayerInfo(pgRR, entrantPlayers);
    if (nullPlayers.length != 0) {
        console.log(nullPlayers);
    }
    await RetrievePhasesBasedEvents(eventTournaments, eventPhases);
    await RetrieveSetIDsFromEventPhases(
        eventPhases,
        setIDEvents,
        exceededEntries
    );

    let phaseGroupEvents = await RetrievePhaseGroupsFromPhases(exceededEntries);

    if (Object.keys(phaseGroupEvents).length != 0) {
        await RetrieveSetIDsFromEventPhaseGroups(phaseGroupEvents, setIDEvents);
    }

    await RetrieveSetInfoWithSetIDs(pgRR, entrantPlayers, setIDEvents);
    await ExecuteQuery(pgRR, sqlQueries[1]);
    await ExecuteQuery(pgRR, sqlQueries[0]);
    res.send(Object.keys(setIDEvents));
});

app.get('/organizeData', async (req, res) => {
    await ExecuteQuery(pg, sqlQueries[1]);
    await ExecuteQuery(pg, sqlQueries[0]);
    res.send('Done');
});

app.get('/clear', async (req, res) => {
    if (await ExecuteQuery(pg, sqlQueries[3])) {
        res.send('Tables Cleared');
        console.log('Tables Cleared');
    } else {
        res.send('Failed to clear tables');
        console.log('Failed to clear tables');
    }
});

app.get('/clearRR', async (req, res) => {
    if (await ExecuteQuery(pgRR, sqlQueries[3])) {
        res.send('Tables Cleared');
        console.log('Tables Cleared');
    } else {
        res.send('Failed to clear tables');
        console.log('Failed to clear tables');
    }
});

app.get('/dropTables', async (req, res) => {
    if (await ExecuteQuery(pg, sqlQueries[2])) {
        res.send('Tables Dropped');
        console.log('Tables Dropped');
    } else {
        res.send('Failed to drop tables');
        console.log('Failed to drop tables');
    }
});

app.get('/dropTablesRR', async (req, res) => {
    if (await ExecuteQuery(pgRR, sqlQueries[2])) {
        res.send('Tables Dropped');
        console.log('Tables Dropped');
    } else {
        res.send('Failed to drop tables');
        console.log('Failed to drop tables');
    }
});

app.get('/updateSpecificEvent', async (req, res) => {
    const eventID = req.query.eventID;
    const tournamentID = req.query.tournamentID;
    let eventPhases = {};
    let exceededEntries = {};
    let setIDEvents = {};
    const eventTournaments = {};
    eventTournaments[eventID] = tournamentID;
    const entrants = await RetrieveEntrantsFromEvents(eventTournaments);
    const players = await RetrievePlayerInfoFromEntrants(pg, entrants);
    await RetrievePhasesBasedEvents(eventTournaments, eventPhases);
    await RetrieveSetIDsFromEventPhases(
        eventPhases,
        setIDEvents,
        exceededEntries
    );

    let phaseGroupEvents = await RetrievePhaseGroupsFromPhases(exceededEntries);

    if (Object.keys(phaseGroupEvents).length != 0) {
        await RetrieveSetIDsFromEventPhaseGroups(phaseGroupEvents, setIDEvents);
    }

    await RetrieveSetInfoWithSetIDs(pg, players, setIDEvents);

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end('Done');
});

app.get('/updatePlayerInfo', async (req, res) => {
    const nullPlayers = await UpdatePlayerInfo(pg);
    const outdatedSets = await GetSetIDsWithPlayerIDs(pg, nullPlayers);
    await UpdateSetsWithCorrectPlayers(pg, outdatedSets);
    await RemoveOutdatedPlayers(pg, nullPlayers);
    res.end('Done');
});

app.get('/updatePlayerInfoRR', async (req, res) => {
    await UpdatePlayerInfo(pgRR);
});

app.get('/addPlayerEventStats', async (req, res) => {
    await UpdateAllPlayerEventStats();
    res.end('Done');
});

app.get('/test', async (req, res) => {
    const entrantQuery = `
        SELECT EntrantID FROM PlayerEventStats WHERE PlayerID = ANY($1);
    `;

    const playerIDs = [763741, 13341, 240230];

    const results = await pg.query(entrantQuery, [playerIDs]);
    const entrantIDs = results.rows.map((entrant) => entrant.entrantid);
    console.log(entrantIDs);
    res.end('Done');
});

async function RetrieveStartGGGlobalData() {
    let tournamentIds = await FetchTournaments(pg);
    let eventPhases = {};
    let exceededEntries = {};
    let setIDEvents = {};
    let playerEventStats = {};
    console.time('events');
    let eventTournaments = await RetrieveEventsBasedOnTournaments(
        pg,
        tournamentIds
    );
    console.timeEnd('events');
    await RetrievePhasesBasedEvents(eventTournaments, eventPhases);
    await RetrieveSetIDsFromEventPhases(
        eventPhases,
        setIDEvents,
        exceededEntries
    );

    const entrants = await RetrieveEntrantsFromEvents(
        eventTournaments,
        playerEventStats
    );
    const participantEntrants = await RetrieveParticipantIDsFromEntrants(
        entrants,
        playerEventStats
    );
    const entrantPlayers = await RetrievePlayerIDsFromParticipantIDs(
        participantEntrants,
        playerEventStats
    );
    const nullPlayers = await RetrievePlayerInfo(pg, entrantPlayers);
    if (nullPlayers.length != 0) {
        console.log(nullPlayers);
    }

    await InsertOrUpdatePlayerEventStats(pg, playerEventStats);

    let phaseGroupEvents = await RetrievePhaseGroupsFromPhases(exceededEntries);

    if (Object.keys(phaseGroupEvents).length != 0) {
        await RetrieveSetIDsFromEventPhaseGroups(phaseGroupEvents, setIDEvents);
    }

    await RetrieveSetInfoWithSetIDs(pg, entrantPlayers, setIDEvents);
}

async function Start() {
    // Create Tables if they don't exist
    await ExecuteQuery(pg, sqlQueries[4]);
    // Update players
    const nullPlayers = await UpdatePlayerInfo(pg);
    const outdatedSets = await GetSetIDsWithPlayerIDs(pg, nullPlayers);
    const entrantIDs = await GetEntrantIDsToUpdate(pg, nullPlayers);

    const participantEntrants = await RetrieveParticipantIDsFromEntrants(
        entrantIDs
    );
    const entrantPlayers = await RetrievePlayerIDsFromParticipantIDs(
        participantEntrants
    );
    await UpdateNullPlayersInPlayerEventStats(pg, entrantPlayers);
    await UpdateSetsWithCorrectPlayers(pg, outdatedSets);
    await RemoveOutdatedPlayers(pg, nullPlayers);

    // Retrieve new data
    await RetrieveStartGGGlobalData();

    // Organize data
    await ExecuteQuery(pg, sqlQueries[1]);
    await ExecuteQuery(pg, sqlQueries[0]);
}

async function UpdateAllPlayerEventStats() {
    // Create Tables if they don't exist
    await ExecuteQuery(pg, sqlQueries[4]);

    const playerEventStats = {};
    const getEventsQuery =
        'SELECT e.EventID, t.TournamentID FROM Events e JOIN Tournaments t ON e.TournamentID = t.TournamentID;';
    const res = await pg.query(getEventsQuery);
    const eventTournaments = {};
    if (res.rows) {
        let rows = res.rows;
        for (const row of rows) {
            eventTournaments[row.eventid] = row.tournamentid;
        }

        const entrants = await RetrieveEntrantsFromEvents(
            eventTournaments,
            playerEventStats
        );
        const participantEntrants = await RetrieveParticipantIDsFromEntrants(
            entrants,
            playerEventStats
        );
        const entrantPlayers = await RetrievePlayerIDsFromParticipantIDs(
            participantEntrants,
            playerEventStats
        );

        const nullPlayers = await RetrievePlayerInfo(pg, entrantPlayers);
        if (nullPlayers.length != 0) {
            console.log(nullPlayers);
        }
        await InsertOrUpdatePlayerEventStats(pg, playerEventStats);
    }
}

CheckConnection(pg);

GetSQLFileNames(sqlQueries);

app.listen(3001, () => {
    console.log('Listening...');
});
