package rankings

import "testing"

func TestSupportedGamesIncludesGame2048(t *testing.T) {
	for _, game := range supportedGames {
		if game.dbName == "game_2048" && game.apiName == "game_2048" {
			return
		}
	}
	t.Fatal("supportedGames should include game_2048")
}
