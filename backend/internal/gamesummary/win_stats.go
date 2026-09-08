package gamesummary

import "context"

type WinStats struct {
	Plays int64
	Wins  int64
	Rate  float64
}

// GetWinStats shares the game center's record window and verified win rules.
func (service *Service) GetWinStats(ctx context.Context, userID int64) (WinStats, error) {
	if service.db == nil {
		return WinStats{}, ErrUnavailable
	}
	rows, err := service.listRecentGameRows(ctx, userID)
	if err != nil {
		return WinStats{}, err
	}
	var stats WinStats
	for _, gameType := range supportedGames {
		progress := summarizeGameRows(rows[gameType], gameType)
		if progress.HasWinFlag {
			stats.Plays += progress.TotalPlays
			stats.Wins += progress.Wins
		}
	}
	if stats.Plays > 0 {
		stats.Rate = float64(stats.Wins) / float64(stats.Plays)
	}
	return stats, nil
}
