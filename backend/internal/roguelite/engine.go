package roguelite

import (
	"fmt"
	"math"
	"sort"
	"strconv"
	"strings"
)

const (
	ViewRadius          = 3
	SightRadius         = 1
	ExpandedSightRadius = 2
	ViewSize            = ViewRadius*2 + 1
	MaxFloor            = 3
	InitialHP           = 30
	InitialSteps        = 64
	MaxCoordinate       = 1_000_000
)

var StartPosition = Position{Row: 0, Col: 0}

var allRelics = []RelicType{
	RelicEdgeMender,
	RelicGlassAegis,
	RelicStarCompass,
	RelicKeySpring,
	RelicRiftFilter,
	RelicBattleCharm,
	RelicTreasureEcho,
	RelicStarlightLens,
	RelicDustCollector,
	RelicPrismVial,
	RelicWardenGlyph,
	RelicSpoilsMagnet,
	RelicMeteorBoots,
}

var relicLabels = map[RelicType]string{
	RelicEdgeMender:    "环带回声",
	RelicGlassAegis:    "琉璃星盾",
	RelicStarCompass:   "星门罗盘",
	RelicKeySpring:     "钥匙泉",
	RelicRiftFilter:    "裂隙滤镜",
	RelicBattleCharm:   "锋芒护符",
	RelicTreasureEcho:  "宝箱回响",
	RelicStarlightLens: "星辉透镜",
	RelicDustCollector: "集尘瓶",
	RelicPrismVial:     "棱光小瓶",
	RelicWardenGlyph:   "守护刻印",
	RelicSpoilsMagnet:  "战利磁芯",
	RelicMeteorBoots:   "流星靴",
}

var relicDescriptions = map[RelicType]string{
	RelicEdgeMender:    "每层首次抵达新的探索环带时回复 2 点生命",
	RelicGlassAegis:    "本局首次受到伤害时，实际伤害减半",
	RelicStarCompass:   "显示星门精确坐标，星门进入视野时会提前显形",
	RelicKeySpring:     "进入新层时额外获得 1 把钥匙",
	RelicRiftFilter:    "裂隙伤害降低 3 点",
	RelicBattleCharm:   "战斗攻击力 +2",
	RelicTreasureEcho:  "宝箱额外产出 8 星尘",
	RelicStarlightLens: "当前视野扩大一圈，可照亮外圈 16 格",
	RelicDustCollector: "星尘格额外获得 4 星尘",
	RelicPrismVial:     "每次回复生命时额外回复 2 点",
	RelicWardenGlyph:   "进入战斗时获得 3 护盾",
	RelicSpoilsMagnet:  "击败怪物额外获得 5 星尘",
	RelicMeteorBoots:   "进入新层时额外获得 8 行动步数",
}

var monsterNames = []string{"星尘守卫", "碎晶爪牙", "微光游魂", "棱镜猎手"}

func PositionKey(position Position) string {
	return fmt.Sprintf("%d,%d", position.Row, position.Col)
}

func IsValidWorldPosition(position Position) bool {
	return absInt(position.Row) <= MaxCoordinate && absInt(position.Col) <= MaxCoordinate
}

func IsAdjacentPosition(a Position, b Position) bool {
	return absInt(a.Row-b.Row)+absInt(a.Col-b.Col) == 1
}

func GenerateBoard(seed string, floor int) Board {
	safeFloor := normalizeFloor(floor)
	return Board{
		Floor:         safeFloor,
		StartPosition: StartPosition,
		ExitPosition:  GetExitPosition(seed, safeFloor),
		Cells:         []Cell{},
	}
}

func GetExitPosition(seed string, floor int) Position {
	safeFloor := normalizeFloor(floor)
	rng := newSeedRandom(fmt.Sprintf("%s:floor:%d:exit", seed, safeFloor))
	distance := 12 + minInt(16, (safeFloor-3)*2)
	if safeFloor == 1 {
		distance = 6
	} else if safeFloor == 2 {
		distance = 9
	} else if safeFloor == 3 {
		distance = 12
	}
	rowAbs := randInt(rng, 0, distance)
	colAbs := distance - rowAbs
	row := 0
	if rowAbs != 0 {
		row = rowAbs
		if rng.Float64() < 0.5 {
			row = -row
		}
	}
	col := 0
	if colAbs != 0 {
		col = colAbs
		if rng.Float64() < 0.5 {
			col = -col
		}
	}
	return Position{Row: row, Col: col}
}

func GenerateCell(seed string, floor int, position Position, exitPosition ...Position) Cell {
	safeFloor := normalizeFloor(floor)
	exit := GetExitPosition(seed, safeFloor)
	if len(exitPosition) > 0 {
		exit = exitPosition[0]
	}
	rng := newSeedRandom(fmt.Sprintf("%s:cell:%d:%d:%d", seed, safeFloor, position.Row, position.Col))
	if samePosition(position, StartPosition) {
		return makeCell(rng, safeFloor, position, CellStart)
	}
	if samePosition(position, exit) {
		return makeCell(rng, safeFloor, position, CellExit)
	}
	if safeFloor >= 3 && samePosition(position, getBossGuardPosition(exit)) {
		return makeCell(rng, safeFloor, position, CellBoss)
	}
	return makeCell(rng, safeFloor, position, chooseProceduralCellType(rng, safeFloor, position))
}

func CreateInitialState(seed string) GameState {
	board := GenerateBoard(seed, 1)
	return GameState{
		Seed:  seed,
		Floor: 1,
		Board: board,
		Player: PlayerState{
			HP:             InitialHP,
			MaxHP:          InitialHP,
			Keys:           1,
			StepsRemaining: InitialSteps,
			Attack:         6,
			Position:       StartPosition,
			Relics:         []RelicType{},
			ExploredCells:  1,
			RingHealKeys:   []string{},
		},
		Visited:  []string{PositionKey(StartPosition)},
		Revealed: []string{},
		Status:   StatusPlaying,
	}
}

func CloneState(state GameState) GameState {
	next := state
	next.Floor = normalizeFloor(state.Floor)
	boardFloor := state.Board.Floor
	if boardFloor == 0 {
		boardFloor = state.Floor
	}
	next.Board = Board{
		Floor:         normalizeFloor(boardFloor),
		StartPosition: StartPosition,
		ExitPosition:  state.Board.ExitPosition,
		Cells:         []Cell{},
	}
	if next.Board.ExitPosition == (Position{}) {
		next.Board.ExitPosition = GetExitPosition(state.Seed, state.Floor)
	}
	next.Player.Position = state.Player.Position
	next.Player.Relics = append([]RelicType(nil), state.Player.Relics...)
	next.Player.ExploredCells = maxInt(1, maxInt(state.Player.ExploredCells, len(state.Visited)))
	next.Player.RingHealKeys = append([]string(nil), state.Player.RingHealKeys...)
	next.Visited = append([]string(nil), state.Visited...)
	next.Revealed = append([]string(nil), state.Revealed...)
	next.Pending = clonePending(state.Pending)
	if state.CellOverrides != nil {
		next.CellOverrides = map[string]Cell{}
		for key, cell := range state.CellOverrides {
			next.CellOverrides[key] = cloneCell(cell)
		}
	}
	return next
}

func ResolveAction(inputState GameState, action Action) ActionResult {
	state := CloneState(inputState)
	if state.Status != StatusPlaying {
		return ActionResult{OK: false, Message: "本局已经结束"}
	}
	switch action.Type {
	case "move":
		return resolveMove(state, action.To)
	case "combat":
		return resolveCombat(state, action.Style)
	case "event":
		return resolveEvent(state, action.OptionID)
	case "shop":
		return resolveShop(state, action.ItemID)
	case "chest":
		return resolveChest(state, action.Open)
	case "escape":
		return resolveEscape(state)
	default:
		return ActionResult{OK: false, Message: "未知行动类型"}
	}
}

func BuildStateView(state GameState) StateView {
	nextState := CloneState(state)
	sightRadius := getSightRadius(nextState)
	cells := buildViewportCells(nextState)
	board := make([]CellView, 0, len(cells))
	for _, cell := range cells {
		if shouldRevealExact(nextState, cell) {
			board = append(board, buildExactCellView(nextState, cell))
		} else {
			board = append(board, buildHiddenCellView(nextState, cell))
		}
	}
	sort.Slice(board, func(i int, j int) bool {
		if board[i].ViewPosition.Row == board[j].ViewPosition.Row {
			return board[i].ViewPosition.Col < board[j].ViewPosition.Col
		}
		return board[i].ViewPosition.Row < board[j].ViewPosition.Row
	})
	return StateView{
		Floor:          nextState.Floor,
		BoardSize:      ViewSize,
		ViewportRadius: ViewRadius,
		SightRadius:    sightRadius,
		Board:          board,
		Player:         clonePlayer(nextState.Player),
		StarGate:       buildStarGateView(nextState),
		Pending:        clonePending(nextState.Pending),
		Status:         nextState.Status,
		DefeatedReason: nextState.DefeatedReason,
		ScorePreview:   CalculateScore(nextState),
	}
}

func IsCurrentState(state GameState) bool {
	return state.Seed != "" &&
		state.Floor > 0 &&
		samePosition(state.Board.StartPosition, StartPosition) &&
		len(state.Board.Cells) == 0 &&
		IsValidWorldPosition(state.Player.Position) &&
		state.Player.Relics != nil &&
		state.Visited != nil &&
		state.Revealed != nil &&
		(state.Status == StatusPlaying || state.Status == StatusEscaped || state.Status == StatusDefeated)
}

func CalculateScore(state GameState) ScoreBreakdown {
	clearedFloors := maxInt(0, state.Player.FloorsCleared)
	storyFloors := minInt(MaxFloor, clearedFloors)
	endlessFloors := maxInt(0, clearedFloors-MaxFloor)
	floorPoints := storyFloors*220 + endlessFloors*120
	exploredCells := maxInt(maxInt(state.Player.ExploredCells, len(state.Visited)), len(state.Visited))
	explorationPoints := minInt(420, maxInt(0, exploredCells-1)*8)
	monsterPoints := state.Player.MonstersDefeated * 55
	stardustPoints := int(math.Floor(float64(state.Player.Stardust * 5)))
	lifePoints := 0
	if state.Status != StatusDefeated {
		lifePoints = state.Player.HP * 7
	}
	relicPoints := len(state.Player.Relics) * 75
	chestPoints := state.Player.ChestsOpened * 55
	winBonus := 0
	if state.Status == StatusEscaped {
		winBonus = 360 + endlessFloors*80
	}
	total := maxInt(0, floorPoints+explorationPoints+monsterPoints+stardustPoints+lifePoints+relicPoints+chestPoints+winBonus)
	return ScoreBreakdown{
		FloorPoints:       floorPoints,
		ExplorationPoints: explorationPoints,
		MonsterPoints:     monsterPoints,
		StardustPoints:    stardustPoints,
		LifePoints:        lifePoints,
		RelicPoints:       relicPoints,
		ChestPoints:       chestPoints,
		WinBonus:          winBonus,
		Total:             total,
	}
}

func CalculatePointReward(score int) int {
	return maxInt(0, int(math.Floor(float64(score)/10)))
}

func resolveMove(state GameState, to Position) ActionResult {
	if state.Pending != nil {
		return ActionResult{OK: false, Message: "当前事件尚未处理完成"}
	}
	if samePosition(state.Player.Position, to) {
		return okResult(state, buildOutcome(state, "当前位置已确认", ActionOutcome{}))
	}
	if !IsValidWorldPosition(to) || !IsAdjacentPosition(state.Player.Position, to) {
		return ActionResult{OK: false, Message: "只能移动到相邻格子"}
	}
	if state.Player.StepsRemaining <= 0 {
		defeat(&state, "行动步数耗尽")
		return okResult(state, buildOutcome(state, "行动步数耗尽，迷阵关闭", ActionOutcome{}))
	}
	cell := getCellAt(state, to)
	state.Player.StepsRemaining--
	state.Player.Position = to
	hpFromRing := touchRingHeal(&state)
	key := PositionKey(to)
	wasVisited := containsString(state.Visited, key)
	if wasVisited {
		checkStepDepletion(&state)
		message := "这里已经安全"
		if hpFromRing > 0 {
			message = "环带回声回复了生命"
		}
		return okResult(state, buildOutcome(state, message, ActionOutcome{HPDelta: hpFromRing}))
	}
	state.Visited = uniquePush(state.Visited, key)
	state.Player.ExploredCells++
	if cell.Type == CellEmpty || cell.Type == CellStart {
		checkStepDepletion(&state)
		message := "这是一片安静的星砂地"
		if hpFromRing > 0 {
			message = "环带回声回复了生命"
		}
		return okResult(state, buildOutcome(state, message, ActionOutcome{HPDelta: hpFromRing}))
	}
	if cell.Type == CellStardust {
		amount := intValue(cell.Stardust) + relicBonus(state, RelicDustCollector, 4)
		state.Player.Stardust += amount
		checkStepDepletion(&state)
		return okResult(state, buildOutcome(state, fmt.Sprintf("获得 %d 星尘", amount), ActionOutcome{StardustDelta: amount, HPDelta: hpFromRing}))
	}
	if cell.Type == CellRelic && cell.Relic != "" {
		relic := addRelic(&state, cell.Relic)
		checkStepDepletion(&state)
		message := fmt.Sprintf("遗物共鸣，转化为 %d 星尘", relic.stardustDelta)
		gained := RelicType("")
		if relic.gained {
			message = fmt.Sprintf("获得遗物：%s", relicLabels[cell.Relic])
			gained = cell.Relic
		}
		return okResult(state, buildOutcome(state, message, ActionOutcome{RelicGained: gained, StardustDelta: relic.stardustDelta, HPDelta: hpFromRing}))
	}
	if cell.Type == CellRift {
		damage := applyDamage(&state, intValue(cell.Damage), "rift")
		checkStepDepletion(&state)
		message := "穿过裂隙，空间割伤了你"
		if state.Status == StatusDefeated {
			message = "裂隙吞没了你"
		}
		return okResult(state, buildOutcome(state, message, ActionOutcome{DamageTaken: damage.hpLoss, ShieldBlocked: damage.shieldBlocked, HPDelta: hpFromRing - damage.hpLoss}))
	}
	if (cell.Type == CellMonster || cell.Type == CellBoss) && cell.Monster != nil {
		if hasRelic(state, RelicWardenGlyph) {
			state.Player.Shield += 3
		}
		state.Pending = &Pending{Type: "combat", Position: to, Monster: cloneMonster(cell.Monster), Round: 1, IsBoss: cell.Type == CellBoss}
		return okResult(state, buildOutcome(state, fmt.Sprintf("%s 挡住了去路", cell.Monster.Name), ActionOutcome{HPDelta: hpFromRing}))
	}
	if cell.Type == CellEvent && len(cell.EventOptions) > 0 {
		state.Pending = &Pending{Type: "event", Position: to, Options: cloneEventOptions(cell.EventOptions)}
		return okResult(state, buildOutcome(state, "星尘在这里凝成一个选择", ActionOutcome{HPDelta: hpFromRing}))
	}
	if cell.Type == CellShop && len(cell.ShopItems) > 0 {
		state.Pending = &Pending{Type: "shop", Position: to, Items: cloneShopItems(cell.ShopItems)}
		return okResult(state, buildOutcome(state, "抵达星灯小铺", ActionOutcome{HPDelta: hpFromRing}))
	}
	if cell.Type == CellChest && cell.ChestReward != nil {
		state.Pending = &Pending{Type: "chest", Position: to, Reward: cloneChestReward(cell.ChestReward)}
		return okResult(state, buildOutcome(state, "发现一只星纹宝箱", ActionOutcome{HPDelta: hpFromRing}))
	}
	if cell.Type == CellExit {
		completedFloor := state.Floor
		enterNextFloor(&state)
		message := fmt.Sprintf("进入第 %d 层星尘迷阵", state.Floor)
		if completedFloor >= MaxFloor {
			message = fmt.Sprintf("穿过第 %d 层星门，无尽星域展开，现在可以撤离结算", completedFloor)
		}
		return okResult(state, buildOutcome(state, message, ActionOutcome{FloorChanged: true, HPDelta: hpFromRing}))
	}
	return ActionResult{OK: false, Message: "无法处理该格子"}
}

func resolveCombat(state GameState, style string) ActionResult {
	if state.Pending == nil || state.Pending.Type != "combat" || state.Pending.Monster == nil {
		return ActionResult{OK: false, Message: "当前没有战斗"}
	}
	pending := clonePending(state.Pending)
	damage := getEffectiveAttack(state)
	stardustDelta := 0
	hpDelta := 0
	if style == "guard" {
		state.Player.Shield += 5
		damage = maxInt(1, int(math.Floor(float64(damage)/2)))
	} else if style == "skill" {
		if state.Player.Stardust < 8 {
			return ActionResult{OK: false, Message: "星尘不足，无法释放星爆"}
		}
		state.Player.Stardust -= 8
		stardustDelta -= 8
		damage = damage*2 + 4
	} else if style != "attack" {
		return ActionResult{OK: false, Message: "无效的战斗方式"}
	}
	pending.Monster.HP = maxInt(0, pending.Monster.HP-damage)
	if pending.Monster.HP <= 0 {
		reward := pending.Monster.RewardStardust + boolBonus(pending.IsBoss, 12) + relicBonus(state, RelicSpoilsMagnet, 5)
		state.Player.Stardust += reward
		state.Player.MonstersDefeated++
		stardustDelta += reward
		state.Pending = nil
		checkStepDepletion(&state)
		return okResult(state, buildOutcome(state, fmt.Sprintf("击败 %s，获得 %d 星尘", pending.Monster.Name, reward), ActionOutcome{StardustDelta: stardustDelta, CombatEnded: true}))
	}
	damageTaken := applyDamage(&state, pending.Monster.Attack, "combat")
	hpDelta -= damageTaken.hpLoss
	if state.Status == StatusPlaying {
		pending.Round++
		state.Pending = pending
	}
	return okResult(state, buildOutcome(state, fmt.Sprintf("%s 还剩 %d 生命", pending.Monster.Name, pending.Monster.HP), ActionOutcome{DamageTaken: damageTaken.hpLoss, ShieldBlocked: damageTaken.shieldBlocked, StardustDelta: stardustDelta, HPDelta: hpDelta}))
}

func resolveEvent(state GameState, optionID string) ActionResult {
	if state.Pending == nil || state.Pending.Type != "event" {
		return ActionResult{OK: false, Message: "当前没有事件可处理"}
	}
	var option *EventOption
	for index := range state.Pending.Options {
		if state.Pending.Options[index].ID == optionID {
			option = &state.Pending.Options[index]
			break
		}
	}
	if option == nil {
		return ActionResult{OK: false, Message: "无效的事件选项"}
	}
	stardustDelta, keyDelta, hpDelta := 0, 0, 0
	relicGained := RelicType("")
	switch option.ID {
	case "star_key":
		damage := applyDamage(&state, 4, "event")
		state.Player.Keys++
		state.Player.Stardust += 8
		hpDelta -= damage.hpLoss
		keyDelta++
		stardustDelta += 8
	case "quiet_blessing":
		hpDelta += healPlayer(&state, 3)
		state.Player.Shield += 5
	case "risky_map":
		cost := minInt(6, state.Player.Stardust)
		state.Player.Stardust -= cost
		stardustDelta -= cost
		revealAround(&state, state.Pending.Position)
	case "shard_oath":
		damage := applyDamage(&state, 3, "event")
		state.Player.MaxHP += 3
		state.Player.Attack++
		hpDelta -= damage.hpLoss
	case "dust_gamble":
		cost := minInt(5, state.Player.Stardust)
		state.Player.Stardust -= cost
		stardustDelta -= cost
		won := newSeedRandom(fmt.Sprintf("%s:event:%d:%s:%d", state.Seed, state.Floor, PositionKey(state.Pending.Position), state.Player.EventsResolved)).Float64() >= 0.35
		if won {
			state.Player.Stardust += 16
			stardustDelta += 16
		} else {
			damage := applyDamage(&state, 4, "event")
			hpDelta -= damage.hpLoss
		}
	case "shield_cache":
		cost := minInt(4, state.Player.Stardust)
		state.Player.Stardust -= cost
		state.Player.Shield += 8
		stardustDelta -= cost
	case "dust_bloom":
		damage := applyDamage(&state, 3, "event")
		state.Player.Stardust += 18
		hpDelta -= damage.hpLoss
		stardustDelta += 18
	case "key_trade":
		cost := minInt(10, state.Player.Stardust)
		shortage := 10 - cost
		state.Player.Stardust -= cost
		if shortage > 0 {
			damage := applyDamage(&state, shortage, "event")
			hpDelta -= damage.hpLoss
		}
		state.Player.Keys += 2
		stardustDelta -= cost
		keyDelta += 2
	case "blade_forge":
		cost := minInt(8, state.Player.Stardust)
		shortage := 8 - cost
		state.Player.Stardust -= cost
		if shortage > 0 {
			damage := applyDamage(&state, shortage, "event")
			hpDelta -= damage.hpLoss
		}
		state.Player.Attack += 2
		stardustDelta -= cost
	case "rest_cocoon":
		if state.Player.Keys > 0 {
			state.Player.Keys--
			keyDelta--
			hpDelta += healPlayer(&state, 12)
		} else {
			hpDelta += healPlayer(&state, 4)
		}
	case "time_spark":
		damage := applyDamage(&state, 2, "event")
		state.Player.StepsRemaining += 10
		hpDelta -= damage.hpLoss
	case "relic_mirror":
		cost := minInt(10, state.Player.Stardust)
		shortage := 10 - cost
		relicRng := newSeedRandom(fmt.Sprintf("%s:event-relic:%d:%s:%d", state.Seed, state.Floor, PositionKey(state.Pending.Position), state.Player.EventsResolved))
		relicType := pickOne(relicRng, allRelics)
		relic := addRelic(&state, relicType)
		state.Player.Stardust -= cost
		if shortage > 0 {
			damage := applyDamage(&state, shortage, "event")
			hpDelta -= damage.hpLoss
		}
		stardustDelta -= cost
		if relic.gained {
			relicGained = relicType
		} else {
			stardustDelta += relic.stardustDelta
		}
	case "rift_survey":
		state.Player.Shield += 4
		revealAround(&state, state.Pending.Position)
		damage := applyDamage(&state, 2, "event")
		hpDelta -= damage.hpLoss
	case "life_exchange":
		state.Player.MaxHP = maxInt(1, state.Player.MaxHP-2)
		state.Player.HP = minInt(state.Player.HP, state.Player.MaxHP)
		state.Player.Keys++
		state.Player.Shield += 6
		state.Player.Stardust += 10
		keyDelta++
		stardustDelta += 10
	case "compass_pulse":
		cost := minInt(4, state.Player.Stardust)
		state.Player.Stardust -= cost
		state.Player.StepsRemaining += 6
		stardustDelta -= cost
		revealAround(&state, state.Pending.Position)
	}
	state.Player.EventsResolved++
	state.Pending = nil
	checkStepDepletion(&state)
	return okResult(state, buildOutcome(state, option.Label, ActionOutcome{StardustDelta: stardustDelta, KeyDelta: keyDelta, HPDelta: hpDelta, RelicGained: relicGained}))
}

func resolveShop(state GameState, itemID string) ActionResult {
	if state.Pending == nil || state.Pending.Type != "shop" {
		return ActionResult{OK: false, Message: "当前没有商店可处理"}
	}
	if itemID == "leave" {
		state.Pending = nil
		checkStepDepletion(&state)
		return okResult(state, buildOutcome(state, "离开星灯小铺", ActionOutcome{}))
	}
	itemIndex := -1
	for index, item := range state.Pending.Items {
		if item.ID == itemID {
			itemIndex = index
			break
		}
	}
	if itemIndex < 0 {
		return ActionResult{OK: false, Message: "商店没有这个物品"}
	}
	item := state.Pending.Items[itemIndex]
	if state.Player.Stardust < item.Cost {
		return ActionResult{OK: false, Message: "星尘不足"}
	}
	state.Player.Stardust -= item.Cost
	stardustDelta, keyDelta, hpDelta := -item.Cost, 0, 0
	relicGained := RelicType("")
	if item.Kind == "heal" {
		hpDelta += healPlayer(&state, 8+state.Floor*2)
	} else if item.Kind == "key" {
		state.Player.Keys++
		keyDelta++
	} else if item.Kind == "relic" && item.Relic != "" {
		relic := addRelic(&state, item.Relic)
		if relic.gained {
			relicGained = item.Relic
		} else {
			stardustDelta += relic.stardustDelta
		}
	} else if item.Kind == "scout" {
		revealAround(&state, state.Pending.Position)
	}
	remaining := append([]ShopItem{}, state.Pending.Items[:itemIndex]...)
	remaining = append(remaining, state.Pending.Items[itemIndex+1:]...)
	if len(remaining) > 0 {
		state.Pending.Items = remaining
	} else {
		state.Pending = nil
	}
	return okResult(state, buildOutcome(state, fmt.Sprintf("购买了 %s", item.Label), ActionOutcome{StardustDelta: stardustDelta, KeyDelta: keyDelta, HPDelta: hpDelta, RelicGained: relicGained}))
}

func resolveChest(state GameState, open bool) ActionResult {
	if state.Pending == nil || state.Pending.Type != "chest" || state.Pending.Reward == nil {
		return ActionResult{OK: false, Message: "当前没有宝箱可处理"}
	}
	if !open {
		state.Pending = nil
		checkStepDepletion(&state)
		return okResult(state, buildOutcome(state, "保留钥匙，离开宝箱", ActionOutcome{}))
	}
	if state.Player.Keys <= 0 {
		return ActionResult{OK: false, Message: "没有钥匙，无法打开宝箱"}
	}
	reward := *state.Pending.Reward
	state.Player.Keys--
	state.Player.ChestsOpened++
	stardust := reward.Stardust + relicBonus(state, RelicTreasureEcho, 8)
	bonusStardust := 0
	relicGained := RelicType("")
	if reward.Relic != "" {
		relic := addRelic(&state, reward.Relic)
		if relic.gained {
			relicGained = reward.Relic
		} else {
			bonusStardust += relic.stardustDelta
		}
	}
	state.Player.Stardust += stardust
	state.Pending = nil
	checkStepDepletion(&state)
	return okResult(state, buildOutcome(state, fmt.Sprintf("打开宝箱，获得 %d 星尘", stardust+bonusStardust), ActionOutcome{StardustDelta: stardust + bonusStardust, KeyDelta: -1, RelicGained: relicGained}))
}

func resolveEscape(state GameState) ActionResult {
	if state.Pending != nil {
		return ActionResult{OK: false, Message: "当前事件尚未处理完成"}
	}
	if state.Player.FloorsCleared < MaxFloor {
		return ActionResult{OK: false, Message: "穿过第 3 层星门后才能撤离结算"}
	}
	state.Status = StatusEscaped
	return okResult(state, buildOutcome(state, "你带着星尘从无尽星域撤离", ActionOutcome{}))
}

func makeCell(rng *seedRandom, floor int, position Position, cellType CellType) Cell {
	cell := Cell{
		ID:       fmt.Sprintf("%d:%d:%d", floor, position.Row, position.Col),
		Position: position,
		Type:     cellType,
		Risk:     riskForType(cellType, floor),
		Hint:     hintForType(cellType, floor),
		Label:    labelForType(cellType),
		Icon:     iconForType(cellType),
	}
	switch cellType {
	case CellMonster:
		cell.Monster = buildMonster(rng, floor, false)
	case CellBoss:
		cell.Monster = buildMonster(rng, floor, true)
	case CellStardust:
		value := randInt(rng, 7+floor*2, 13+floor*4)
		cell.Stardust = &value
	case CellRelic:
		cell.Relic = pickOne(rng, allRelics)
	case CellEvent:
		cell.EventOptions = buildEventOptions(rng)
	case CellShop:
		cell.ShopItems = buildShopItems(rng, floor)
	case CellRift:
		value := randInt(rng, 5+floor, 8+floor*2)
		cell.Damage = &value
	case CellChest:
		reward := ChestReward{Stardust: randInt(rng, 12+floor*4, 22+floor*5)}
		if rng.Float64() < 0.45 {
			reward.Relic = pickOne(rng, allRelics)
		}
		cell.ChestReward = &reward
	}
	return cell
}

func buildMonster(rng *seedRandom, floor int, boss bool) *Monster {
	if boss {
		hp := 28 + minInt(10, floor)*7
		name := "无尽星门守望者"
		if floor <= MaxFloor {
			name = "星门守望者"
		}
		return &Monster{Name: name, HP: hp, MaxHP: hp, Attack: 7 + minInt(10, floor)*2, RewardStardust: 24 + minInt(10, floor)*6, Elite: true}
	}
	eliteChance := math.Min(0.36, 0.12+float64(floor)*0.04)
	elite := floor >= 2 && rng.Float64() < eliteChance
	hp := randInt(rng, 8+floor*3, 13+floor*5)
	if elite {
		hp += 7
	}
	name := pickOne(rng, monsterNames)
	if elite {
		name = "精英棱镜猎手"
	}
	attack := randInt(rng, 3+floor, 5+floor*2)
	reward := randInt(rng, 6+floor*2, 11+floor*4)
	if elite {
		attack += 2
		reward += 6
	}
	return &Monster{Name: name, HP: hp, MaxHP: hp, Attack: attack, RewardStardust: reward, Elite: elite}
}

func buildEventOptions(rng *seedRandom) []EventOption {
	pool := []EventOption{
		{ID: "star_key", Label: "折下一枚星钥", Description: "失去 4 生命，获得 1 钥匙与 8 星尘"},
		{ID: "quiet_blessing", Label: "接受静默祝福", Description: "回复 3 生命，并获得 5 护盾"},
		{ID: "risky_map", Label: "解读残破星图", Description: "消耗最多 6 星尘，揭示附近格子"},
		{ID: "shard_oath", Label: "立下晶片誓约", Description: "当前生命 -3，最大生命 +3，攻击 +1"},
		{ID: "dust_gamble", Label: "投入星尘赌局", Description: "失去 5 星尘，获得 16 星尘或受到 4 伤害"},
		{ID: "shield_cache", Label: "开启护盾匣", Description: "消耗最多 4 星尘，获得 8 护盾"},
		{ID: "dust_bloom", Label: "采摘星尘花", Description: "失去 3 生命，获得 18 星尘"},
		{ID: "key_trade", Label: "与钥灵交易", Description: "消耗 10 星尘，不足部分失去生命，获得 2 把钥匙"},
		{ID: "blade_forge", Label: "淬炼星刃", Description: "消耗 8 星尘，不足部分失去生命，攻击 +2"},
		{ID: "rest_cocoon", Label: "进入静息星茧", Description: "消耗 1 把钥匙回复 12 生命；没有钥匙则回复 4 生命"},
		{ID: "time_spark", Label: "点燃时光火花", Description: "失去 2 生命，获得 10 行动步数"},
		{ID: "relic_mirror", Label: "凝视遗物镜", Description: "消耗 10 星尘，不足部分失去生命，获得 1 个随机遗物"},
		{ID: "rift_survey", Label: "校准裂隙测仪", Description: "获得 4 护盾并揭示周围格子，但受到 2 伤害"},
		{ID: "life_exchange", Label: "献出星核余温", Description: "最大生命 -2，获得 1 钥匙、6 护盾与 10 星尘"},
		{ID: "compass_pulse", Label: "释放罗盘脉冲", Description: "消耗最多 4 星尘，揭示周围格子并获得 6 行动步数"},
	}
	return shuffleEventOptions(rng, pool)[:2]
}

func buildShopItems(rng *seedRandom, floor int) []ShopItem {
	relic := pickOne(rng, allRelics)
	return []ShopItem{
		{ID: "heal", Label: "星露药剂", Description: fmt.Sprintf("回复 %d 生命", 8+floor*2), Cost: 9 + floor*2, Kind: "heal"},
		{ID: "key", Label: "秘银星钥", Description: "获得 1 把钥匙", Cost: 8 + floor, Kind: "key"},
		{ID: fmt.Sprintf("relic:%s", relic), Label: relicLabels[relic], Description: relicDescriptions[relic], Cost: 18 + floor*3, Kind: "relic", Relic: relic},
		{ID: "scout", Label: "星图碎片", Description: "揭示周围 8 格", Cost: 6, Kind: "scout"},
	}
}

func chooseProceduralCellType(rng *seedRandom, floor int, position Position) CellType {
	distance := distanceFromStart(position)
	if distance <= 1 {
		roll := rng.Float64()
		if roll < 0.55 {
			return CellEmpty
		}
		if roll < 0.86 {
			return CellStardust
		}
		return CellEvent
	}
	depth := minInt(10, maxInt(0, floor-1))
	ring := minInt(10, int(math.Floor(float64(distance)/4)))
	monsterWeight := math.Min(0.34, 0.16+float64(depth)*0.02+float64(ring)*0.012)
	riftWeight := math.Min(0.20, boolFloat(floor >= 2, 0.055, 0.025)+float64(depth)*0.01+float64(ring)*0.01)
	chestWeight := math.Min(0.11, 0.055+float64(ring)*0.006)
	relicWeight := math.Min(0.09, 0.06+float64(floor)*0.004)
	shopWeight := boolFloat(distance%7 == 0, 0.085, 0.035)
	eventWeight := 0.14
	stardustWeight := math.Max(0.16, 0.26-float64(depth)*0.01)
	roll := rng.Float64()
	cursor := monsterWeight
	if roll < cursor {
		return CellMonster
	}
	cursor += riftWeight
	if roll < cursor {
		return CellRift
	}
	cursor += stardustWeight
	if roll < cursor {
		return CellStardust
	}
	cursor += eventWeight
	if roll < cursor {
		return CellEvent
	}
	cursor += relicWeight
	if roll < cursor {
		return CellRelic
	}
	cursor += chestWeight
	if roll < cursor {
		return CellChest
	}
	cursor += shopWeight
	if roll < cursor {
		return CellShop
	}
	return CellEmpty
}

func getCellAt(state GameState, position Position) Cell {
	key := PositionKey(position)
	if state.CellOverrides != nil {
		if cell, ok := state.CellOverrides[key]; ok {
			return cloneCell(cell)
		}
	}
	return GenerateCell(state.Seed, state.Floor, position, state.Board.ExitPosition)
}

func applyDamage(state *GameState, rawAmount int, source string) struct{ hpLoss, shieldBlocked int } {
	amount := maxInt(0, int(math.Floor(float64(rawAmount))))
	if source == "rift" && hasRelic(*state, RelicRiftFilter) {
		amount = maxInt(1, amount-3)
	}
	if amount > 0 && hasRelic(*state, RelicGlassAegis) && !state.Player.UsedAegis {
		amount = int(math.Ceil(float64(amount) / 2))
		state.Player.UsedAegis = true
	}
	blocked := minInt(state.Player.Shield, amount)
	state.Player.Shield -= blocked
	amount -= blocked
	state.Player.HP -= amount
	if state.Player.HP <= 0 {
		reason := "战斗失败"
		if source == "rift" {
			reason = "被裂隙吞没"
		} else if source == "event" {
			reason = "事件代价过高"
		}
		defeat(state, reason)
	}
	return struct{ hpLoss, shieldBlocked int }{amount, blocked}
}

func buildViewportCells(state GameState) []Cell {
	cells := []Cell{}
	for row := state.Player.Position.Row - ViewRadius; row <= state.Player.Position.Row+ViewRadius; row++ {
		for col := state.Player.Position.Col - ViewRadius; col <= state.Player.Position.Col+ViewRadius; col++ {
			cells = append(cells, getCellAt(state, Position{Row: row, Col: col}))
		}
	}
	return cells
}

func buildHiddenCellView(state GameState, cell Cell) CellView {
	relative := Position{Row: cell.Position.Row - state.Player.Position.Row, Col: cell.Position.Col - state.Player.Position.Col}
	return CellView{
		ID:               cell.ID,
		Position:         cell.Position,
		ViewPosition:     toViewPosition(state, cell),
		RelativePosition: relative,
		State:            ViewHidden,
		Type:             CellHidden,
		Risk:             RiskMedium,
		Hint:             "尚未照亮",
		Label:            "迷雾",
		Icon:             "░",
		Adjacent:         IsAdjacentPosition(state.Player.Position, cell.Position),
		Exhausted:        false,
	}
}

func buildExactCellView(state GameState, cell Cell) CellView {
	key := PositionKey(cell.Position)
	current := samePosition(state.Player.Position, cell.Position)
	visited := containsString(state.Visited, key)
	viewState := ViewScouted
	if current {
		viewState = ViewCurrent
	} else if visited {
		viewState = ViewRevealed
	}
	return CellView{
		ID:               cell.ID,
		Position:         cell.Position,
		ViewPosition:     toViewPosition(state, cell),
		RelativePosition: Position{Row: cell.Position.Row - state.Player.Position.Row, Col: cell.Position.Col - state.Player.Position.Col},
		State:            viewState,
		Type:             cell.Type,
		Risk:             cell.Risk,
		Hint:             cell.Hint,
		Label:            cell.Label,
		Icon:             cell.Icon,
		Adjacent:         IsAdjacentPosition(state.Player.Position, cell.Position),
		Exhausted:        visited && !current && cell.Type != CellExit,
		Stardust:         cloneIntPtr(cell.Stardust),
		Damage:           cloneIntPtr(cell.Damage),
		Monster:          cloneMonster(cell.Monster),
		Relic:            cell.Relic,
		EventOptions:     cloneEventOptions(cell.EventOptions),
		ShopItems:        cloneShopItems(cell.ShopItems),
		ChestReward:      cloneChestReward(cell.ChestReward),
	}
}

func shouldRevealExact(state GameState, cell Cell) bool {
	key := PositionKey(cell.Position)
	return containsString(state.Revealed, key) || isInPersistentSight(state, cell.Position) || (hasRelic(state, RelicStarCompass) && cell.Type == CellExit)
}

func isInPersistentSight(state GameState, position Position) bool {
	radius := getSightRadius(state)
	for _, key := range state.Visited {
		visited, ok := parsePositionKey(key)
		if ok && isWithinSight(visited, position, radius) {
			return true
		}
	}
	return false
}

func buildStarGateView(state GameState) StarGateView {
	exact := hasRelic(state, RelicStarCompass)
	var position *Position
	if exact {
		copy := state.Board.ExitPosition
		position = &copy
	}
	return StarGateView{
		Position:        position,
		Distance:        absInt(state.Board.ExitPosition.Row-state.Player.Position.Row) + absInt(state.Board.ExitPosition.Col-state.Player.Position.Col),
		Direction:       directionLabel(state.Player.Position, state.Board.ExitPosition),
		Exact:           exact,
		EndlessUnlocked: state.Player.FloorsCleared >= MaxFloor,
	}
}

func buildOutcome(state GameState, message string, partial ActionOutcome) ActionOutcome {
	partial.Message = message
	partial.Status = state.Status
	return partial
}

func okResult(state GameState, outcome ActionOutcome) ActionResult {
	return ActionResult{OK: true, State: state, Outcome: outcome}
}

func addRelic(state *GameState, relic RelicType) struct {
	gained        bool
	stardustDelta int
} {
	if hasRelic(*state, relic) {
		state.Player.Stardust += 12
		return struct {
			gained        bool
			stardustDelta int
		}{false, 12}
	}
	state.Player.Relics = append(state.Player.Relics, relic)
	return struct {
		gained        bool
		stardustDelta int
	}{true, 0}
}

func healPlayer(state *GameState, amount int) int {
	before := state.Player.HP
	bonus := 0
	if amount > 0 && hasRelic(*state, RelicPrismVial) {
		bonus = 2
	}
	state.Player.HP = minInt(state.Player.MaxHP, state.Player.HP+maxInt(0, amount+bonus))
	return state.Player.HP - before
}

func revealAround(state *GameState, center Position) {
	next := append([]string(nil), state.Revealed...)
	for row := center.Row - 1; row <= center.Row+1; row++ {
		for col := center.Col - 1; col <= center.Col+1; col++ {
			position := Position{Row: row, Col: col}
			key := PositionKey(position)
			if IsValidWorldPosition(position) && !containsString(state.Visited, key) && !containsString(next, key) {
				next = append(next, key)
			}
		}
	}
	state.Revealed = next
}

func touchRingHeal(state *GameState) int {
	if !hasRelic(*state, RelicEdgeMender) {
		return 0
	}
	ring := int(math.Floor(float64(distanceFromStart(state.Player.Position)) / 4))
	if ring <= 0 {
		return 0
	}
	key := fmt.Sprintf("%d:%d", state.Floor, ring)
	if containsString(state.Player.RingHealKeys, key) {
		return 0
	}
	state.Player.RingHealKeys = append(state.Player.RingHealKeys, key)
	return healPlayer(state, 2)
}

func enterNextFloor(state *GameState) {
	state.Player.FloorsCleared = maxInt(state.Player.FloorsCleared, state.Floor)
	state.Floor++
	state.Board = GenerateBoard(state.Seed, state.Floor)
	state.Player.Position = StartPosition
	state.Player.StepsRemaining += 18
	if hasRelic(*state, RelicMeteorBoots) {
		state.Player.StepsRemaining += 8
	}
	state.Player.Shield = minInt(10, state.Player.Shield+1)
	if hasRelic(*state, RelicKeySpring) {
		state.Player.Keys++
	}
	state.Visited = []string{PositionKey(StartPosition)}
	state.Revealed = []string{}
	state.Pending = nil
	state.CellOverrides = nil
}

func defeat(state *GameState, reason string) {
	state.Status = StatusDefeated
	state.DefeatedReason = reason
	state.Pending = nil
	state.Player.HP = maxInt(0, state.Player.HP)
}

func checkStepDepletion(state *GameState) {
	if state.Status == StatusPlaying && state.Player.StepsRemaining <= 0 && state.Pending == nil {
		defeat(state, "行动步数耗尽")
	}
}

func getEffectiveAttack(state GameState) int {
	return state.Player.Attack + relicBonus(state, RelicBattleCharm, 2)
}

func getSightRadius(state GameState) int {
	if hasRelic(state, RelicStarlightLens) {
		return ExpandedSightRadius
	}
	return SightRadius
}

func hasRelic(state GameState, relic RelicType) bool {
	for _, item := range state.Player.Relics {
		if item == relic {
			return true
		}
	}
	return false
}

func iconForType(cellType CellType) string {
	switch cellType {
	case CellStart:
		return "⌂"
	case CellMonster:
		return "✕"
	case CellBoss:
		return "♛"
	case CellStardust:
		return "✦"
	case CellRelic:
		return "◇"
	case CellEvent:
		return "?"
	case CellShop:
		return "¤"
	case CellRift:
		return "◌"
	case CellChest:
		return "□"
	case CellExit:
		return "◎"
	default:
		return "·"
	}
}

func labelForType(cellType CellType) string {
	switch cellType {
	case CellStart:
		return "起点"
	case CellMonster:
		return "怪物"
	case CellBoss:
		return "守门者"
	case CellStardust:
		return "星尘"
	case CellRelic:
		return "遗物"
	case CellEvent:
		return "事件"
	case CellShop:
		return "商店"
	case CellRift:
		return "裂隙"
	case CellChest:
		return "宝箱"
	case CellExit:
		return "星门"
	default:
		return "空格"
	}
}

func riskForType(cellType CellType, floor int) Risk {
	if cellType == CellBoss || cellType == CellRift {
		return RiskHigh
	}
	if cellType == CellMonster {
		if floor >= 3 {
			return RiskHigh
		}
		return RiskMedium
	}
	if cellType == CellEvent || cellType == CellChest || cellType == CellExit {
		return RiskMedium
	}
	if cellType == CellRelic || cellType == CellStardust {
		return RiskLow
	}
	return RiskSafe
}

func hintForType(cellType CellType, floor int) string {
	switch cellType {
	case CellMonster:
		if floor >= 3 {
			return "强烈星压"
		}
		return "低吼回声"
	case CellBoss:
		return "门前有巨大影子"
	case CellStardust:
		return "微光聚集"
	case CellRelic:
		return "古老星纹"
	case CellEvent:
		return "命运岔路"
	case CellShop:
		return "温暖灯火"
	case CellRift:
		return "空间破碎"
	case CellChest:
		return "金属轻响"
	case CellExit:
		return "远处星门"
	case CellStart:
		return "安全营地"
	default:
		return "平静星砂"
	}
}

func getBossGuardPosition(exitPosition Position) Position {
	rowStep := 0
	if exitPosition.Row > 0 {
		rowStep = 1
	} else if exitPosition.Row < 0 {
		rowStep = -1
	}
	colStep := 0
	if exitPosition.Col > 0 {
		colStep = 1
	} else if exitPosition.Col < 0 {
		colStep = -1
	}
	if absInt(exitPosition.Row) >= absInt(exitPosition.Col) && rowStep != 0 {
		return Position{Row: exitPosition.Row - rowStep, Col: exitPosition.Col}
	}
	return Position{Row: exitPosition.Row, Col: exitPosition.Col - colStep}
}

func toViewPosition(state GameState, cell Cell) Position {
	return Position{Row: cell.Position.Row - state.Player.Position.Row + ViewRadius, Col: cell.Position.Col - state.Player.Position.Col + ViewRadius}
}

func isWithinSight(center Position, target Position, radius int) bool {
	return maxInt(absInt(center.Row-target.Row), absInt(center.Col-target.Col)) <= radius
}

func parsePositionKey(key string) (Position, bool) {
	parts := strings.Split(key, ",")
	if len(parts) != 2 {
		return Position{}, false
	}
	row, err := strconv.Atoi(parts[0])
	if err != nil {
		return Position{}, false
	}
	col, err := strconv.Atoi(parts[1])
	if err != nil {
		return Position{}, false
	}
	return Position{Row: row, Col: col}, true
}

func directionLabel(from Position, to Position) string {
	rowDelta := to.Row - from.Row
	colDelta := to.Col - from.Col
	if rowDelta == 0 && colDelta == 0 {
		return "脚下"
	}
	vertical := ""
	if rowDelta < 0 {
		vertical = "北"
	} else if rowDelta > 0 {
		vertical = "南"
	}
	horizontal := ""
	if colDelta < 0 {
		horizontal = "西"
	} else if colDelta > 0 {
		horizontal = "东"
	}
	if vertical == "" && horizontal == "" {
		return "附近"
	}
	return vertical + horizontal
}

func clonePlayer(player PlayerState) PlayerState {
	player.Relics = append([]RelicType(nil), player.Relics...)
	player.RingHealKeys = append([]string(nil), player.RingHealKeys...)
	return player
}

func cloneCell(cell Cell) Cell {
	cell.Stardust = cloneIntPtr(cell.Stardust)
	cell.Damage = cloneIntPtr(cell.Damage)
	cell.Monster = cloneMonster(cell.Monster)
	cell.EventOptions = cloneEventOptions(cell.EventOptions)
	cell.ShopItems = cloneShopItems(cell.ShopItems)
	cell.ChestReward = cloneChestReward(cell.ChestReward)
	return cell
}

func clonePending(pending *Pending) *Pending {
	if pending == nil {
		return nil
	}
	next := *pending
	next.Monster = cloneMonster(pending.Monster)
	next.Options = cloneEventOptions(pending.Options)
	next.Items = cloneShopItems(pending.Items)
	next.Reward = cloneChestReward(pending.Reward)
	return &next
}

func cloneMonster(monster *Monster) *Monster {
	if monster == nil {
		return nil
	}
	next := *monster
	return &next
}

func cloneChestReward(reward *ChestReward) *ChestReward {
	if reward == nil {
		return nil
	}
	next := *reward
	return &next
}

func cloneIntPtr(value *int) *int {
	if value == nil {
		return nil
	}
	next := *value
	return &next
}

func cloneEventOptions(items []EventOption) []EventOption {
	if items == nil {
		return nil
	}
	return append([]EventOption(nil), items...)
}

func cloneShopItems(items []ShopItem) []ShopItem {
	if items == nil {
		return nil
	}
	return append([]ShopItem(nil), items...)
}

func shuffleEventOptions(rng *seedRandom, values []EventOption) []EventOption {
	result := append([]EventOption(nil), values...)
	for i := len(result) - 1; i > 0; i-- {
		j := int(math.Floor(rng.Float64() * float64(i+1)))
		result[i], result[j] = result[j], result[i]
	}
	return result
}

func pickOne[T any](rng *seedRandom, values []T) T {
	return values[int(math.Floor(rng.Float64()*float64(len(values))))]
}

func uniquePush(values []string, value string) []string {
	if containsString(values, value) {
		return values
	}
	return append(values, value)
}

func containsString(values []string, value string) bool {
	for _, item := range values {
		if item == value {
			return true
		}
	}
	return false
}

func samePosition(a Position, b Position) bool {
	return a.Row == b.Row && a.Col == b.Col
}

func distanceFromStart(position Position) int {
	return absInt(position.Row) + absInt(position.Col)
}

func normalizeFloor(floor int) int {
	if floor < 1 {
		return 1
	}
	return floor
}

func randInt(rng *seedRandom, min int, max int) int {
	return min + int(math.Floor(rng.Float64()*float64(max-min+1)))
}

func boolBonus(ok bool, value int) int {
	if ok {
		return value
	}
	return 0
}

func relicBonus(state GameState, relic RelicType, value int) int {
	if hasRelic(state, relic) {
		return value
	}
	return 0
}

func boolFloat(ok bool, yes float64, no float64) float64 {
	if ok {
		return yes
	}
	return no
}

func intValue(value *int) int {
	if value == nil {
		return 0
	}
	return *value
}

func absInt(value int) int {
	if value < 0 {
		return -value
	}
	return value
}

func minInt(left int, right int) int {
	if left < right {
		return left
	}
	return right
}

func maxInt(left int, right int) int {
	if left > right {
		return left
	}
	return right
}
