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

app.get('/GetInfo', async (req, res) => {
    await ExecuteQuery(pg, sqlQueries[4]);
    let tournamentIds = await FetchTournaments(pg);
    let eventPhases = {};
    let exceededEntries = {};
    let setIDEvents = {};
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
    const entrants = await RetrieveEntrantsFromEvents(eventTournaments);
    const participantEntrants = await RetrieveParticipantIDsFromEntrants(
        entrants
    );
    const entrantPlayers = await RetrievePlayerIDsFromParticipantIDs(
        participantEntrants
    );
    const nullPlayers = await RetrievePlayerInfo(pg, entrantPlayers);
    if (nullPlayers.length != 0) {
        console.log(nullPlayers);
    }

    let phaseGroupEvents = await RetrievePhaseGroupsFromPhases(exceededEntries);

    if (Object.keys(phaseGroupEvents).length != 0) {
        await RetrieveSetIDsFromEventPhaseGroups(phaseGroupEvents, setIDEvents);
    }

    await RetrieveSetInfoWithSetIDs(pg, entrantPlayers, setIDEvents);

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

CheckConnection(pg);

ViewPlayers(pg);

Test(pg);

GetSQLFileNames(sqlQueries);

app.listen(3001, () => {
    console.log('Listening...');
});
