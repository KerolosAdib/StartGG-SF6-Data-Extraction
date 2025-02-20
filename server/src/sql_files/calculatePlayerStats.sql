INSERT INTO PlayerStats (PlayerID, TotalSetWins, TotalSetLosses, TotalGameWins, TotalGameLosses)
SELECT 
    p.PlayerID,
    (SELECT COUNT(*) FROM Sets S1 WHERE p.PlayerID = S1.WinnerID AND HasDQ = FALSE) AS TotalSetWins,
    (SELECT COUNT(*) FROM Sets 
     WHERE (PlayerOneID = p.PlayerID OR PlayerTwoID = p.PlayerID) 
       AND HasDQ = FALSE) - (SELECT COUNT(*) FROM Sets S1 WHERE p.PlayerID = S1.WinnerID AND HasDQ = FALSE) AS TotalSetLosses,
    SUM(
        CASE 
            WHEN s.WinnerID = p.PlayerID THEN 
                CASE WHEN s.PlayerOneID = p.PlayerID THEN s.PlayerOneWins ELSE s.PlayerTwoWins END
            ELSE 
                CASE WHEN s.PlayerOneID = p.PlayerID THEN s.PlayerOneWins ELSE s.PlayerTwoWins END
        END
    ) AS TotalGameWins,
    SUM(
        CASE 
            WHEN s.WinnerID = p.PlayerID THEN 
                CASE WHEN s.PlayerOneID = p.PlayerID THEN s.PlayerTwoWins ELSE s.PlayerOneWins END
            ELSE 
                CASE WHEN s.PlayerOneID = p.PlayerID THEN s.PlayerTwoWins ELSE s.PlayerOneWins END
        END
    ) AS TotalGameLosses
FROM Players p
LEFT JOIN Sets s ON p.PlayerID = s.PlayerOneID OR p.PlayerID = s.PlayerTwoID
WHERE s.HasDQ = FALSE
GROUP BY p.PlayerID, p.GamerTag
ON CONFLICT (PlayerID)
DO UPDATE SET 
    TotalSetWins = PlayerStats.TotalSetWins + EXCLUDED.TotalSetWins,
    TotalSetLosses = PlayerStats.TotalSetLosses + EXCLUDED.TotalSetLosses,
    TotalGameWins = PlayerStats.TotalGameWins + EXCLUDED.TotalGameWins,
    TotalGameLosses = PlayerStats.TotalGameLosses + EXCLUDED.TotalGameLosses;