const sql = require("mssql");
const express = require("express");
const cors = require("cors");
require("dotenv").config();

const app = express();
app.use(cors());

const GET_USERS = `
    query ($page: Int!, $perPage: Int!) {
        tournaments(
            query: {
                filter: { videogameIds: [43868], past: true }
                page: $page
                perPage: $perPage
            }
        ) {
            nodes {
                id
                events(filter: { videogameId: 43868, published: true }) {
                    entrants {
                        nodes {
                            name
                            participants {
                                user {
                                    discriminator
                                }
                                player {
                                    id
                                    gamerTag
                                }
                            }
                        }
                    }
                }
            }
        }
    }
`;

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

sql.connect(config, (err) => {
    if (err) {
        console.error(err);
    } else {
        console.log("Connected to SQL Server");
    }
});

app.get("/", async (req, res) => {
    new sql.Request().query("SELECT * FROM Players", (err, result) => {
        if (err) {
            console.error(ermr);
        } else {
            res.send(result.recordset);
            console.log(result.recordset);
        }
    });
});

app.get("/GetInfo", async (req, res) => {
    var data = await FetchTournaments();
    console.log(JSON.stringify(data));
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
                },
            }),
        });
        results = await results.json();
        hasMore =
            results.data &&
            results.data.tournaments &&
            results.data.tournaments.nodes.length;
        data.push(results);
        page++;
    }
    return data;
}

app.post("/addUser", (req, res) => {});

app.listen(3001, () => {
    console.log("Listening...");
});
