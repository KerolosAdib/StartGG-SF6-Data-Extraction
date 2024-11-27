const sql = require("mssql");
const express = require("express");
const cors = require("cors");
const PG = require("pg");

require("dotenv").config();

const app = express();
app.use(cors());

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
                events(filter: { videogameId: [$SF6], published: true }) {
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

const pg = new PG.Pool({
    user: process.env.PGUSER,
    password: process.env.PGPASSWORD,
    host: process.env.PGHOST,
    database: process.env.PGDATABASE,
    port: process.env.PGPORT,
});

const config = {
    user: "adibk",
    password: "test",
    server: process.env.SQL_SERVER_NAME + "\\SQLEXPRESS",
    options: {
        encrypt: true,
        database: "StartggDB",
        trustServerCertificate: true,
        trustedConnection: true,
    },
};

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
        var table =
            "CREATE TABLE IF NOT EXISTS Players(" +
            "PlayerID INT PRIMARY KEY CHECK (PlayerID > 0)," +
            "GamerTag VARCHAR(255) NOT NULL," +
            "TotalWins INT CHECK (TotalWins >= 0)," +
            "TotalLosses INT CHECK (TotalLosses >= 0));";
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
    var data = await FetchTournaments();
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(data));
});

async function FetchTournaments() {
    var page = 1;
    var hasMore = true;
    var data = [];
    while (hasMore && page <= 10) {
        var results = await fetch("https://api.start.gg/gql/alpha", {
            method: "POST",

            headers: {
                "Content-Type": "application/json",
                Authorization: "Bearer " + process.env.AUTH_TOKEN,
            },

            body: JSON.stringify({
                query: GET_USERS,
                variables: {
                    page: page,
                    perPage: 5,
                    SF6: 43868,
                },
            }),
        });
        results = await results.json();
        hasMore =
            results.data &&
            results.data.tournaments &&
            results.data.tournaments.nodes.length;
        if (hasMore) {
            results.data.tournaments.nodes.forEach((tournament) => {
                tournament.events.forEach((event) => {
                    event.entrants.nodes.forEach((entrant) => {
                        data.push(entrant.id);
                    });
                });
            });
        }
        page++;
    }
    return data;
}

app.post("/addUser", (req, res) => {});

checkConnection();

CreateTables();

ViewPlayers();

app.listen(3001, () => {
    console.log("Listening...");
});
