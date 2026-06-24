package roguelite

import (
	"reflect"
	"strings"
	"testing"
)

func intPtr(value int) *int {
	return &value
}

func makeTestCell(position Position, cellType CellType, patch func(*Cell)) Cell {
	cell := Cell{
		ID:       "test:" + PositionKey(position),
		Position: position,
		Type:     cellType,
		Risk:     RiskMedium,
		Hint:     "测试线索",
		Label:    "测试格",
		Icon:     "·",
	}
	if cellType == CellRift || cellType == CellBoss {
		cell.Risk = RiskHigh
	}
	if cellType == CellEmpty || cellType == CellStart {
		cell.Risk = RiskSafe
	}
	if patch != nil {
		patch(&cell)
	}
	return cell
}

func buildStateWithCells(cells []Cell, floor int, exit Position) GameState {
	state := CreateInitialState("roguelite-test-seed")
	state.Floor = floor
	state.Board = GenerateBoard(state.Seed, floor)
	state.Board.ExitPosition = exit
	state.Player.Position = StartPosition
	state.Visited = []string{PositionKey(StartPosition)}
	state.Player.ExploredCells = 1
	state.CellOverrides = map[string]Cell{}
	for _, cell := range cells {
		state.CellOverrides[PositionKey(cell.Position)] = cell
	}
	return state
}

func moveOK(t *testing.T, state GameState, to Position) GameState {
	t.Helper()
	result := ResolveAction(state, Action{Type: "move", To: to})
	if !result.OK {
		t.Fatalf("move failed: %s", result.Message)
	}
	return result.State
}

func TestViewCenterFollowsPlayer(t *testing.T) {
	state := CreateInitialState("center-start")
	if state.Player.Position != (Position{Row: 0, Col: 0}) {
		t.Fatalf("unexpected start: %#v", state.Player.Position)
	}
	state.Player.Position = Position{Row: 3, Col: -2}
	state.Visited = []string{PositionKey(state.Player.Position)}
	view := BuildStateView(state)
	var current *CellView
	for index := range view.Board {
		if view.Board[index].State == ViewCurrent {
			current = &view.Board[index]
			break
		}
	}
	if view.BoardSize != ViewSize || len(view.Board) != ViewSize*ViewSize {
		t.Fatalf("unexpected view size")
	}
	if current == nil || current.Position != state.Player.Position || current.ViewPosition != (Position{Row: ViewRadius, Col: ViewRadius}) {
		t.Fatalf("current cell mismatch: %#v", current)
	}
}

func TestBaseAndExpandedVision(t *testing.T) {
	base := BuildStateView(CreateInitialState("base-vision"))
	hidden := 0
	for _, cell := range base.Board {
		if cell.State == ViewHidden {
			hidden++
		}
	}
	if base.SightRadius != SightRadius || hidden != 40 {
		t.Fatalf("unexpected base vision: radius=%d hidden=%d", base.SightRadius, hidden)
	}
	expandedState := CreateInitialState("expanded-vision")
	expandedState.Player.Relics = []RelicType{RelicStarlightLens}
	expanded := BuildStateView(expandedState)
	hidden = 0
	for _, cell := range expanded.Board {
		if cell.State == ViewHidden {
			hidden++
		}
	}
	if expanded.SightRadius != ExpandedSightRadius || hidden != 24 {
		t.Fatalf("unexpected expanded vision: radius=%d hidden=%d", expanded.SightRadius, hidden)
	}
}

func TestProceduralGenerationIsStable(t *testing.T) {
	firstBoard := GenerateBoard("fixed-seed", 2)
	secondBoard := GenerateBoard("fixed-seed", 2)
	firstCell := GenerateCell("fixed-seed", 2, Position{Row: 12, Col: -7})
	secondCell := GenerateCell("fixed-seed", 2, Position{Row: 12, Col: -7})
	if !reflect.DeepEqual(firstBoard, secondBoard) {
		t.Fatalf("board mismatch")
	}
	if !reflect.DeepEqual(firstCell, secondCell) {
		t.Fatalf("cell mismatch")
	}
}

func TestEventPoolIsStableAndWideEnough(t *testing.T) {
	seen := map[string]bool{}
	checked := 0
	for row := -20; row <= 20; row++ {
		for col := -20; col <= 20; col++ {
			cell := GenerateCell("event-pool-check", 2, Position{Row: row, Col: col})
			if cell.Type != CellEvent {
				continue
			}
			same := GenerateCell("event-pool-check", 2, Position{Row: row, Col: col})
			if len(cell.EventOptions) != 2 || !reflect.DeepEqual(same.EventOptions, cell.EventOptions) {
				t.Fatalf("unstable event options")
			}
			for _, option := range cell.EventOptions {
				seen[option.ID] = true
			}
			checked++
		}
	}
	if checked <= 10 || len(seen) <= 8 {
		t.Fatalf("event coverage too small: checked=%d seen=%d", checked, len(seen))
	}
}

func TestMoveValidationAndRewards(t *testing.T) {
	state := CreateInitialState("move-check")
	result := ResolveAction(state, Action{Type: "move", To: Position{Row: 2, Col: 2}})
	if result.OK || !strings.Contains(result.Message, "相邻格子") {
		t.Fatalf("expected adjacent validation, got %#v", result)
	}

	rewardCell := makeTestCell(Position{Row: 1, Col: 0}, CellStardust, func(cell *Cell) {
		cell.Stardust = intPtr(20)
		cell.Risk = RiskLow
		cell.Label = "星尘"
	})
	rewardState := buildStateWithCells([]Cell{rewardCell, makeTestCell(StartPosition, CellStart, nil)}, 1, Position{Row: 6, Col: 0})
	first := moveOK(t, rewardState, rewardCell.Position)
	if first.Player.Stardust != 20 {
		t.Fatalf("expected first stardust 20, got %d", first.Player.Stardust)
	}
	back := moveOK(t, first, StartPosition)
	second := moveOK(t, back, rewardCell.Position)
	if second.Player.Stardust != 20 {
		t.Fatalf("revisited stardust should not repeat, got %d", second.Player.Stardust)
	}

	withRelic := buildStateWithCells([]Cell{rewardCell}, 1, Position{Row: 6, Col: 0})
	withRelic.Player.Relics = []RelicType{RelicDustCollector}
	dusted := ResolveAction(withRelic, Action{Type: "move", To: rewardCell.Position})
	if !dusted.OK || dusted.State.Player.Stardust != 24 || dusted.Outcome.StardustDelta != 24 {
		t.Fatalf("dust collector mismatch: %#v", dusted)
	}
}

func TestCombatRiftEscapeAndPending(t *testing.T) {
	monsterCell := makeTestCell(Position{Row: 1, Col: 0}, CellMonster, func(cell *Cell) {
		cell.Monster = &Monster{Name: "测试守卫", HP: 1, MaxHP: 1, Attack: 1, RewardStardust: 7}
	})
	state := buildStateWithCells([]Cell{monsterCell}, 1, Position{Row: 6, Col: 0})
	state.Player.Relics = []RelicType{RelicWardenGlyph, RelicSpoilsMagnet}
	encounter := ResolveAction(state, Action{Type: "move", To: monsterCell.Position})
	if !encounter.OK || encounter.State.Pending == nil || encounter.State.Pending.Type != "combat" || encounter.State.Player.Shield != 3 {
		t.Fatalf("encounter mismatch: %#v", encounter)
	}
	defeated := ResolveAction(encounter.State, Action{Type: "combat", Style: "attack"})
	if !defeated.OK || defeated.State.Pending != nil || defeated.State.Player.Stardust != 12 || defeated.Outcome.StardustDelta != 12 {
		t.Fatalf("combat reward mismatch: %#v", defeated)
	}

	rift := makeTestCell(Position{Row: 1, Col: 0}, CellRift, func(cell *Cell) {
		cell.Damage = intPtr(99)
		cell.Label = "裂隙"
	})
	riftResult := ResolveAction(buildStateWithCells([]Cell{rift}, 1, Position{Row: 6, Col: 0}), Action{Type: "move", To: rift.Position})
	if !riftResult.OK || riftResult.State.Status != StatusDefeated || riftResult.State.Player.HP != 0 {
		t.Fatalf("rift defeat mismatch: %#v", riftResult)
	}

	exit := Position{Row: 1, Col: 0}
	gate := ResolveAction(buildStateWithCells(nil, 3, exit), Action{Type: "move", To: exit})
	if !gate.OK || gate.State.Status != StatusPlaying || gate.State.Floor != 4 || gate.State.Player.FloorsCleared != 3 {
		t.Fatalf("gate mismatch: %#v", gate)
	}
	escaped := ResolveAction(gate.State, Action{Type: "escape"})
	if !escaped.OK || escaped.State.Status != StatusEscaped {
		t.Fatalf("escape mismatch: %#v", escaped)
	}
	early := ResolveAction(CreateInitialState("escape-check"), Action{Type: "escape"})
	if early.OK || !strings.Contains(early.Message, "第 3 层") {
		t.Fatalf("early escape should fail: %#v", early)
	}
}

func TestEventScoreIdempotentMoveAndReward(t *testing.T) {
	state := buildStateWithCells(nil, 1, Position{Row: 6, Col: 0})
	state.Player.Stardust = 7
	state.Player.Keys = 0
	state.Pending = &Pending{
		Type:     "event",
		Position: Position{Row: 1, Col: 0},
		Options: []EventOption{
			{ID: "key_trade", Label: "与钥灵交易", Description: "测试事件"},
			{ID: "time_spark", Label: "点燃时光火花", Description: "测试事件"},
		},
	}
	event := ResolveAction(state, Action{Type: "event", OptionID: "key_trade"})
	if !event.OK || event.State.Pending != nil || event.State.Player.Keys != 2 || event.State.Player.Stardust != 0 || event.State.Player.HP != 27 {
		t.Fatalf("event mismatch: %#v", event)
	}
	if event.Outcome.KeyDelta != 2 || event.Outcome.StardustDelta != -7 || event.Outcome.HPDelta != -3 {
		t.Fatalf("event outcome mismatch: %#v", event.Outcome)
	}

	scoreState := CreateInitialState("score-cap-check")
	scoreState.Status = StatusEscaped
	scoreState.Floor = 12
	scoreState.Player.FloorsCleared = 11
	scoreState.Player.ExploredCells = 200
	scoreState.Player.Stardust = 500
	scoreState.Player.HP = 30
	scoreState.Player.Relics = []RelicType{RelicBattleCharm, RelicStarCompass, RelicDustCollector, RelicMeteorBoots}
	scoreState.Player.MonstersDefeated = 30
	scoreState.Player.ChestsOpened = 10
	score := CalculateScore(scoreState)
	if score.Total <= 3000 {
		t.Fatalf("score should not be capped: %#v", score)
	}

	current := ResolveAction(buildStateWithCells(nil, 1, Position{Row: 6, Col: 0}), Action{Type: "move", To: StartPosition})
	if !current.OK || current.State.Player.Position != StartPosition || !strings.Contains(current.Outcome.Message, "当前位置") {
		t.Fatalf("current move mismatch: %#v", current)
	}
	pending := buildStateWithCells(nil, 1, Position{Row: 6, Col: 0})
	pending.Pending = &Pending{Type: "event", Position: StartPosition, Options: []EventOption{{ID: "test_option", Label: "测试选项", Description: "测试事件"}}}
	blocked := ResolveAction(pending, Action{Type: "move", To: Position{Row: 0, Col: 1}})
	if blocked.OK || !strings.Contains(blocked.Message, "当前事件尚未处理完成") {
		t.Fatalf("pending move should fail: %#v", blocked)
	}
	if CalculatePointReward(0) != 0 || CalculatePointReward(9) != 0 || CalculatePointReward(991) != 99 || CalculatePointReward(3000) != 300 {
		t.Fatalf("point reward mismatch")
	}
}
