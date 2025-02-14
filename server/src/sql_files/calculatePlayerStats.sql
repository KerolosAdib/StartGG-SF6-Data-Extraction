INSERT INTO PlayerStats (PlayerID, TotalSetWins, TotalSetLosses, TotalGameWins, TotalGameLosses)
SELECT 
    s.WinnerID AS PlayerID,
    COUNT(*) AS TotalSetWins,
    (SELECT COUNT(*) FROM Sets WHERE (PlayerOneID = s.WinnerID OR PlayerTwoID = s.WinnerID) AND HasDQ = FALSE) - COUNT(*) AS TotalSetLosses,
    SUM(CASE WHEN s.PlayerOneID = s.WinnerID THEN s.PlayerOneWins ELSE s.PlayerTwoWins END) AS TotalGameWins,
    SUM(CASE WHEN s.PlayerOneID = s.WinnerID THEN s.PlayerTwoWins ELSE s.PlayerOneWins END) AS TotalGameLosses
FROM Sets s
WHERE s.HasDQ = FALSE
GROUP BY s.WinnerID
ON CONFLICT (PlayerID)
DO UPDATE SET 
    TotalSetWins = PlayerStats.TotalSetWins + EXCLUDED.TotalSetWins,
    TotalSetLosses = PlayerStats.TotalSetLosses + EXCLUDED.TotalSetLosses,
    TotalGameWins = PlayerStats.TotalGameWins + EXCLUDED.TotalGameWins,
    TotalGameLosses = PlayerStats.TotalGameLosses + EXCLUDED.TotalGameLosses;