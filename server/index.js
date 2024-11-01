const sql = require("mssql");
const express = require("express");

const app = express();

const config = {
    user: "adibk",
    password: "test",
    server: "DESKTOP-4RJ0SV4\\SQLEXPRESS",
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

app.get("/", async (request, response) => {
    new sql.Request().query("SELECT * FROM Players", (err, result) => {
        if (err) {
            console.error(err);
        } else {
            response.send(result.recordset);
            console.log(result.recordset);
        }
    });
});

app.listen(3000, () => {
    console.log("Listening...");
});
