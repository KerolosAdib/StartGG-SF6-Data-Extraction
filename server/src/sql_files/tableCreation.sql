CREATE TABLE IF NOT EXISTS Players(
    PlayerID INT PRIMARY KEY NOT NULL,
    GamerTag VARCHAR(255) NOT NULL,
    TotalWins INT CHECK (TotalWins >= 0),
    TotalLosses INT CHECK (TotalLosses >= 0),
    Slug VARCHAR(255)
);

CREATE TABLE IF NOT EXISTS Stats(
    PlayerOneID INT REFERENCES Players(PlayerID),
    PlayerTwoID INT REFERENCES Players(PlayerID),
    PlayerOneSetWins INT CHECK (PlayerOneSetWins >= 0),
    PlayerTwoSetWins INT CHECK (PlayerTwoSetWins >= 0),
    PlayerOneGameWins INT CHECK (PlayerOneGameWins >= 0),
    PlayerTwoGameWins INT CHECK (PlayerTwoGameWins >= 0),
    PRIMARY KEY(PlayerOneID, PlayerTwoID),
    CONSTRAINT Stats_PlayerSetIds_Check CHECK (PlayerOneID != PlayerTwoID)
);

CREATE TABLE IF NOT EXISTS Tournaments(
    TournamentID INT PRIMARY KEY NOT NULL,
    CreatedAt TIMESTAMP,
    LatestUpdate TIMESTAMP,
    TournamentName VARCHAR(255),
    Slug VARCHAR(255) NOT NULL
);

CREATE TABLE IF NOT EXISTS Events(
    EventID INT PRIMARY KEY NOT NULL,
    TournamentID INT REFERENCES Tournaments(TournamentID),
    LatestUpdate TIMESTAMP,
    EventName VARCHAR(255),
    Slug VARCHAR(255) NOT NULL
);

CREATE TABLE IF NOT EXISTS Sets(
    SetID INT PRIMARY KEY NOT NULL,
    EventID INT REFERENCES Events(EventID),
    PlayerOneID INT REFERENCES Players(PlayerID),
    PlayerTwoID INT REFERENCES Players(PlayerID),
    PlayerOneWins INT,
    PlayerTwoWins INT,
    WinnerID INT,
    HasDQ BOOLEAN
);