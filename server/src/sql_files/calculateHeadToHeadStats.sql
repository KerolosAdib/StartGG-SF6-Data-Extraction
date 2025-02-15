INSERT INTO HeadToHeadStats (PlayerOneID, PlayerTwoID, PlayerOneSetWins, PlayerTwoSetWins, PlayerOneGameWins, PlayerTwoGameWins)
SELECT 
    LEAST(s.PlayerOneID, s.PlayerTwoID) AS PlayerOneID,
    GREATEST(s.PlayerOneID, s.PlayerTwoID) AS PlayerTwoID,
    SUM(CASE WHEN s.WinnerID = s.PlayerOneID AND s.PlayerOneID < s.PlayerTwoID THEN 1 
             WHEN s.WinnerID = s.PlayerTwoID AND s.PlayerTwoID < s.PlayerOneID THEN 1 ELSE 0 END) AS PlayerOneSetWins,
    SUM(CASE WHEN s.WinnerID = s.PlayerOneID AND s.PlayerOneID > s.PlayerTwoID THEN 1 
             WHEN s.WinnerID = s.PlayerTwoID AND s.PlayerTwoID > s.PlayerOneID THEN 1 ELSE 0 END) AS PlayerTwoSetWins,
    SUM(CASE WHEN s.PlayerOneID < s.PlayerTwoID THEN s.PlayerOneWins ELSE s.PlayerTwoWins END) AS PlayerOneGameWins,
    SUM(CASE WHEN s.PlayerOneID > s.PlayerTwoID THEN s.PlayerOneWins ELSE s.PlayerTwoWins END) AS PlayerTwoGameWins
FROM Sets s
WHERE s.HasDQ = FALSE
GROUP BY LEAST(s.PlayerOneID, s.PlayerTwoID), GREATEST(s.PlayerOneID, s.PlayerTwoID)
ON CONFLICT (PlayerOneID, PlayerTwoID)
DO UPDATE SET 
    PlayerOneSetWins = HeadToHeadStats.PlayerOneSetWins + EXCLUDED.PlayerOneSetWins,
    PlayerTwoSetWins = HeadToHeadStats.PlayerTwoSetWins + EXCLUDED.PlayerTwoSetWins,
    PlayerOneGameWins = HeadToHeadStats.PlayerOneGameWins + EXCLUDED.PlayerOneGameWins,
    PlayerTwoGameWins = HeadToHeadStats.PlayerTwoGameWins + EXCLUDED.PlayerTwoGameWins;