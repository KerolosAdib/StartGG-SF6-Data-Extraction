CREATE TABLE IF NOT EXISTS Players(
    PlayerID INT PRIMARY KEY NOT NULL,
    GamerTag VARCHAR(255) NOT NULL,
    Slug VARCHAR(255),
    ProfilePicture VARCHAR(500)
);

CREATE TABLE IF NOT EXISTS PlayerStats (
    PlayerID INT PRIMARY KEY REFERENCES Players(PlayerID),
    TotalSetWins INT DEFAULT 0 CHECK (TotalSetWins >= 0),
    TotalSetLosses INT DEFAULT 0 CHECK (TotalSetLosses >= 0),
    TotalGameWins INT DEFAULT 0 CHECK (TotalGameWins >= 0),
    TotalGameLosses INT DEFAULT 0 CHECK (TotalGameLosses >= 0)
);

CREATE TABLE IF NOT EXISTS HeadToHeadStats(
    PlayerOneID INT REFERENCES Players(PlayerID),
    PlayerTwoID INT REFERENCES Players(PlayerID),
    PlayerOneSetWins INT DEFAULT 0 CHECK (PlayerOneSetWins >= 0),
    PlayerTwoSetWins INT DEFAULT 0 CHECK (PlayerTwoSetWins >= 0),
    PlayerOneGameWins INT DEFAULT 0 CHECK (PlayerOneGameWins >= 0),
    PlayerTwoGameWins INT DEFAULT 0 CHECK (PlayerTwoGameWins >= 0),
    PRIMARY KEY(PlayerOneID, PlayerTwoID),
    CONSTRAINT Stats_PlayerSetIds_Check CHECK (PlayerOneID != PlayerTwoID)
);

CREATE TABLE IF NOT EXISTS Tournaments(
    TournamentID INT PRIMARY KEY NOT NULL,
    StartedAt TIMESTAMP,
    CreatedAt TIMESTAMP,
    LatestUpdate TIMESTAMP,
    TournamentName VARCHAR(255),
    Slug VARCHAR(255) NOT NULL
);

CREATE TABLE IF NOT EXISTS Events(
    EventID INT PRIMARY KEY NOT NULL,
    TournamentID INT REFERENCES Tournaments(TournamentID),
    StartedAt TIMESTAMP,
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