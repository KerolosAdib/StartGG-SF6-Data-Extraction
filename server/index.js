const Connection = require("tedious").Connection;
const sql = require("mssql");

const config = {
    server: "DESKTOP-4RJ0SV4\\SQLEXPRESS",
    options: {
        encrypt: true,
        database: "StartggDB",
    },
};

sql.connect(config, (err) => {
    if (err) {
        console.error(err);
    } else {
        console.log("Connected to SQL Server");
    }
});

const connectionString =
    "Server=localhost\\SQLEXPRESS01;Database=master;Trusted_Connection=True;";

const connection = new Connection(config);

connection.on("connect", function (err) {
    if (err) {
        console.error(err);
    } else {
        console.log("Connected to SQL Server");
    }
});

connection.connect();
