-- PlayHubDbContext creates the SQL Server schema, including ASP.NET Identity tables,
-- when the API starts for the first time. This file documents the platform-owned tables.
CREATE TABLE Games (
    Id UNIQUEIDENTIFIER NOT NULL PRIMARY KEY,
    Slug NVARCHAR(160) NOT NULL,
    Name NVARCHAR(160) NOT NULL,
    Description NVARCHAR(2000) NOT NULL,
    Category NVARCHAR(80) NOT NULL,
    Status NVARCHAR(32) NOT NULL,
    CurrentPublishedVersionId UNIQUEIDENTIFIER NULL,
    CreatedAt DATETIMEOFFSET NOT NULL
);
CREATE UNIQUE INDEX IX_Games_Slug ON Games (Slug);

CREATE TABLE GameReviews (
    Id UNIQUEIDENTIFIER NOT NULL PRIMARY KEY,
    GameId UNIQUEIDENTIFIER NOT NULL,
    Status NVARCHAR(32) NOT NULL,
    Comment NVARCHAR(2000) NULL,
    CreatedAt DATETIMEOFFSET NOT NULL,
    CONSTRAINT FK_GameReviews_Games_GameId
        FOREIGN KEY (GameId) REFERENCES Games (Id) ON DELETE CASCADE
);
CREATE INDEX IX_GameReviews_GameId_Status ON GameReviews (GameId, Status);
