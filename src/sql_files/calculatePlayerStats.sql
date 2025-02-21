INSERT INTO PlayerStats (PlayerID, TotalSetWins, TotalSetLosses, TotalGameWins, TotalGameLosses)
SELECT 
    p.PlayerID,
    COUNT(*) FILTER (WHERE s.WinnerID = p.PlayerID AND s.HasDQ = FALSE) AS TotalSetWins,
    COUNT(*) FILTER (WHERE s.HasDQ = FALSE) 
        - COUNT(*) FILTER (WHERE s.WinnerID = p.PlayerID AND s.HasDQ = FALSE) AS TotalSetLosses,
    SUM(CASE WHEN s.PlayerOneID = p.PlayerID THEN s.PlayerOneWins ELSE s.PlayerTwoWins END) 
        FILTER (WHERE s.HasDQ = FALSE) AS TotalGameWins,
    SUM(CASE WHEN s.PlayerOneID = p.PlayerID THEN s.PlayerTwoWins ELSE s.PlayerOneWins END) 
        FILTER (WHERE s.HasDQ = FALSE) AS TotalGameLosses
FROM Players p
JOIN Sets s ON p.PlayerID IN (s.PlayerOneID, s.PlayerTwoID)
WHERE s.HasDQ = FALSE
GROUP BY p.PlayerID, p.GamerTag
ON CONFLICT (PlayerID)
DO UPDATE SET 
    TotalSetWins = EXCLUDED.TotalSetWins,
    TotalSetLosses = EXCLUDED.TotalSetLosses,
    TotalGameWins = EXCLUDED.TotalGameWins,
    TotalGameLosses = EXCLUDED.TotalGameLosses;