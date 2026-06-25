package rankings

type gameDefinition struct {
	dbName  string
	apiName string
}

var supportedGames = []gameDefinition{
	{dbName: "linkgame", apiName: "linkgame"},
	{dbName: "match3", apiName: "match3"},
	{dbName: "memory", apiName: "memory"},
	{dbName: "whack_mole", apiName: "whack_mole"},
	{dbName: "roguelite", apiName: "roguelite"},
	{dbName: "minesweeper", apiName: "minesweeper"},
}

func difficultyOptions(game gameDefinition) []GameDifficultyOption {
	switch game.dbName {
	case "linkgame", "memory", "whack_mole", "minesweeper":
		return []GameDifficultyOption{
			{Value: "easy", Label: "简单"},
			{Value: "normal", Label: "普通"},
			{Value: "hard", Label: "困难"},
		}
	default:
		return nil
	}
}
