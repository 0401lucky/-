package cards

import "strings"

const (
	cardBackBasePath = "/images/通用1"
)

var rarityCardBacks = map[Rarity]string{
	RarityLegendaryRare: cardBackBasePath + "/第一等级-传说稀有.png",
	RarityLegendary:     cardBackBasePath + "/第二高等级-传说.png",
	RarityEpic:          cardBackBasePath + "/第三等等级-史诗.png",
	RarityRare:          cardBackBasePath + "/第四等等级-稀有.png",
	RarityCommon:        cardBackBasePath + "/第五等等级-普通.png",
}

type tarotCardSeed struct {
	Name string
	File string
}

func AllCards() []Card {
	cards := make([]Card, 0, 137)
	cards = append(cards, buildNamedCards("animal-s1", RarityLegendaryRare, animalS1LegendaryRare, "")...)
	cards = append(cards, buildNamedCards("animal-s1", RarityLegendary, animalS1Legendary, "")...)
	cards = append(cards, buildNamedCards("animal-s1", RarityEpic, animalS1Epic, "")...)
	cards = append(cards, buildNamedCards("animal-s1", RarityRare, animalS1Rare, "")...)
	cards = append(cards, buildNamedCards("animal-s1", RarityCommon, animalS1Common, "")...)

	cards = append(cards, buildNamedCards("animal-s2", RarityLegendaryRare, animalS2LegendaryRare, "/images/动物2/传说稀有")...)
	cards = append(cards, buildNamedCards("animal-s2", RarityLegendary, animalS2Legendary, "/images/动物2/传说")...)
	cards = append(cards, buildNamedCards("animal-s2", RarityEpic, animalS2Epic, "/images/动物2/史诗")...)
	cards = append(cards, buildNamedCards("animal-s2", RarityRare, animalS2Rare, "/images/动物2/稀有")...)
	cards = append(cards, buildNamedCards("animal-s2", RarityCommon, animalS2Common, "/images/动物2/普通")...)

	cards = append(cards, buildTarotCards(RarityLegendaryRare, tarotLegendaryRare, "/images/塔罗/传说稀有")...)
	cards = append(cards, buildTarotCards(RarityLegendary, tarotLegendary, "/images/塔罗/传说")...)
	cards = append(cards, buildTarotCards(RarityEpic, tarotEpic, "/images/塔罗/史诗")...)
	cards = append(cards, buildTarotCards(RarityRare, tarotRare, "/images/塔罗/稀有")...)
	cards = append(cards, buildTarotCards(RarityCommon, tarotCommon, "/images/塔罗/普通")...)
	return cards
}

func CardsByAlbum(albumID string) []Card {
	result := []Card{}
	for _, card := range AllCards() {
		if card.AlbumID == albumID {
			result = append(result, card)
		}
	}
	return result
}

func AlbumExists(albumID string) bool {
	return len(CardsByAlbum(strings.TrimSpace(albumID))) > 0
}

func RewardPoints(albumID string, rewardType RewardType) (int64, bool) {
	albumID = strings.TrimSpace(albumID)
	if rewardType == RewardFullSet {
		points, ok := albumRewardPoints[albumID]
		return points, ok && points > 0
	}
	rewards, ok := albumTierRewardPoints[albumID]
	if !ok {
		return 0, false
	}
	points, ok := rewards[rewardType]
	return points, ok && points > 0
}

func buildNamedCards(albumID string, rarity Rarity, names []string, imageDir string) []Card {
	cards := make([]Card, 0, len(names))
	for _, name := range names {
		original := "/images/动物卡/" + name + ".png"
		if imageDir != "" {
			original = imageDir + "/" + name + ".png"
		}
		cards = append(cards, buildCard(albumID, rarity, name, original))
	}
	return cards
}

func buildTarotCards(rarity Rarity, seeds []tarotCardSeed, imageDir string) []Card {
	cards := make([]Card, 0, len(seeds))
	for _, seed := range seeds {
		cards = append(cards, buildCard("tarot", rarity, seed.Name, imageDir+"/"+seed.File))
	}
	return cards
}

func buildCard(albumID string, rarity Rarity, name string, originalImage string) Card {
	return Card{
		ID:             albumID + "-" + string(rarity) + "-" + name,
		Name:           name,
		Rarity:         rarity,
		Image:          optimizedImagePath(originalImage, "large"),
		ThumbnailImage: optimizedImagePath(originalImage, "thumb"),
		OriginalImage:  originalImage,
		BackImage:      rarityCardBacks[rarity],
		Probability:    DefaultRules().RarityProbabilities[rarity],
		AlbumID:        albumID,
	}
}

func optimizedImagePath(imagePath string, variant string) string {
	if !strings.HasPrefix(imagePath, "/images/") {
		return imagePath
	}
	withoutPrefix := strings.TrimPrefix(imagePath, "/images/")
	withoutExt := strings.TrimSuffix(strings.TrimSuffix(strings.TrimSuffix(withoutPrefix, ".png"), ".jpg"), ".jpeg")
	return "/images-optimized/" + variant + "/" + withoutExt + ".webp"
}

var animalS1LegendaryRare = []string{"熊猫", "鲸鱼"}
var animalS1Legendary = []string{"小熊猫", "狐狸", "梅花鹿"}
var animalS1Epic = []string{"水獭", "海豹", "考拉", "羊驼", "小老虎"}
var animalS1Rare = []string{"柴犬", "垂耳兔", "企鹅", "海龟", "章鱼"}
var animalS1Common = []string{"仓鼠", "河豚", "水母", "蝾螈", "魔鬼鱼"}

var animalS2LegendaryRare = []string{"哈士奇", "三花猫", "小狮子"}
var animalS2Legendary = []string{"北极熊", "熊峰", "猫头鹰"}
var animalS2Epic = []string{"刺猬", "狐猴", "火烈鸟", "小松鼠", "小棕熊"}
var animalS2Rare = []string{"布偶猫", "黑猫", "加菲猫", "金毛", "柯基", "绵阳", "奶牛", "青蛙", "萨摩耶", "小猴子", "小毛驴", "鹦鹉"}
var animalS2Common = []string{"斑马", "蝙蝠", "变色龙", "法斗", "河马", "獾", "树懒", "暹罗猫", "小浣熊", "小鸡", "小马", "小象", "小猪", "雪纳瑞", "野猪", "长颈鹿"}

var albumRewardPoints = map[string]int64{
	"animal-s1": 100,
	"animal-s2": 200,
	"tarot":     500,
}

var albumTierRewardPoints = map[string]map[RewardType]int64{
	"animal-s1": {
		RewardType(RarityCommon):        4,
		RewardType(RarityRare):          7,
		RewardType(RarityEpic):          12,
		RewardType(RarityLegendary):     18,
		RewardType(RarityLegendaryRare): 35,
	},
	"animal-s2": {
		RewardType(RarityCommon):        6,
		RewardType(RarityRare):          10,
		RewardType(RarityEpic):          18,
		RewardType(RarityLegendary):     27,
		RewardType(RarityLegendaryRare): 50,
	},
	"tarot": {
		RewardType(RarityCommon):        10,
		RewardType(RarityRare):          16,
		RewardType(RarityEpic):          30,
		RewardType(RarityLegendary):     45,
		RewardType(RarityLegendaryRare): 85,
	},
}

var tarotLegendaryRare = []tarotCardSeed{
	{Name: "愚者", File: "0-The Fool-愚者.png"},
	{Name: "世界", File: "21-The World-世界.png"},
	{Name: "权杖三", File: "24-Three of Wands-权杖三.png"},
	{Name: "圣杯三", File: "38-Three of Cups-圣杯三.png"},
	{Name: "星币皇后", File: "76-Queen of Pentacles-星币皇后.png"},
}

var tarotLegendary = []tarotCardSeed{
	{Name: "星星", File: "17-The Star-星星.png"},
	{Name: "月亮", File: "18-The Moon-月亮.png"},
	{Name: "太阳", File: "19-The Sun-太阳.png"},
	{Name: "圣杯四", File: "39-Four of Cups-圣杯四.png"},
	{Name: "宝剑四", File: "53-Four of Swords-宝剑四.png"},
	{Name: "宝剑八", File: "57-Eight of Swords-宝剑八.png"},
	{Name: "力量", File: "8-Strength-力量.png"},
}

var tarotEpic = []tarotCardSeed{
	{Name: "节制", File: "14-Temperance-节制.png"},
	{Name: "高塔", File: "16-The Tower-高塔.png"},
	{Name: "魔术师", File: "1-The Magician-魔术师.png"},
	{Name: "审判", File: "20-Judgment-审判.png"},
	{Name: "权杖二", File: "23-Two of Wands-权杖二.png"},
	{Name: "权杖四", File: "25-Four of Wands-权杖四.png"},
	{Name: "权杖十", File: "31-Ten of Wands-权杖十.png"},
	{Name: "圣杯六", File: "41-Six of Cups-圣杯六.png"},
	{Name: "圣杯侍从", File: "46-Page of Cups-圣杯侍从.png"},
	{Name: "圣杯骑士", File: "47-Knight of Cups-圣杯骑士.png"},
	{Name: "圣杯皇后", File: "48-Queen of Cups-圣杯皇后.png"},
	{Name: "星币一", File: "64-Ace of Pentacles-星币一.png"},
	{Name: "恋人", File: "6-The Lovers-恋人.png"},
	{Name: "星币七", File: "70-Seven of Pentacles-星币七.png"},
	{Name: "星币国王", File: "77-King of Pentacles-星币国王.png"},
}

var tarotRare = []tarotCardSeed{
	{Name: "倒吊人", File: "12-The Hanged Man-倒吊人.png"},
	{Name: "恶魔", File: "15-The Devil-恶魔.png"},
	{Name: "权杖一", File: "22-Ace of Wands-权杖一.png"},
	{Name: "权杖五", File: "26-Five of Wands-权杖五.png"},
	{Name: "权杖九", File: "30-Nine of Wands-权杖九.png"},
	{Name: "权杖侍从", File: "32-Page of Wands-权杖侍从.png"},
	{Name: "权杖骑士", File: "33-Knight of Wands-权杖骑士.png"},
	{Name: "权杖国王", File: "35-King of Wands-权杖国王.png"},
	{Name: "圣杯一", File: "36-Ace of Cups-圣杯一.png"},
	{Name: "圣杯五", File: "40-Five of Cups-圣杯五.png"},
	{Name: "宝剑九", File: "58-Nine of Swords-宝剑九.png"},
	{Name: "宝剑十", File: "59-Ten of Swords-宝剑十.png"},
	{Name: "教皇", File: "5-The Hierophant-教皇.png"},
	{Name: "宝剑侍从", File: "60-Page of Swords-宝剑侍从.png"},
	{Name: "宝剑骑士", File: "61-Knight of Swords-宝剑骑士.png"},
	{Name: "宝剑皇后", File: "62-Queen of Swords-宝剑皇后.png"},
	{Name: "宝剑国王", File: "63-King of Swords-宝剑国王.png"},
	{Name: "星币二", File: "65-Two of Pentacles-星币二.png"},
	{Name: "星币四", File: "67-Four of Pentacles-星币四.png"},
	{Name: "星币五", File: "68-Five of Pentacles-星币五.png"},
	{Name: "星币六", File: "69-Six of Pentacles-星币六.png"},
	{Name: "星币八", File: "71-Eight of Pentacles-星币八.png"},
	{Name: "星币十", File: "73-Ten of Pentacles-星币十.png"},
	{Name: "星币侍从", File: "74-Page of Pentacles-星币侍从.png"},
	{Name: "战车", File: "7-The Chariot-战车.png"},
}

var tarotCommon = []tarotCardSeed{
	{Name: "命运之轮", File: "10-Wheel of Fortune-命运之轮.png"},
	{Name: "正义", File: "11-Justice-正义.png"},
	{Name: "死神", File: "13-Death-死神.png"},
	{Name: "权杖六", File: "27-Six of Wands-权杖六.png"},
	{Name: "权杖七", File: "28-Seven of Wands-权杖七.png"},
	{Name: "权杖八", File: "29-Eight of Wands-权杖八.png"},
	{Name: "女祭司", File: "2-The High Priestess-女祭司.png"},
	{Name: "权杖皇后", File: "34-Queen of Wands-权杖皇后.png"},
	{Name: "圣杯二", File: "37-Two of Cups-圣杯二.png"},
	{Name: "皇后", File: "3-The Empress-皇后.png"},
	{Name: "圣杯七", File: "42-Seven of Cups-圣杯七.png"},
	{Name: "圣杯八", File: "43-Eight of Cups-圣杯八.png"},
	{Name: "圣杯九", File: "44-Nine of Cups-圣杯九.png"},
	{Name: "圣杯十", File: "45-Ten of Cups-圣杯十.png"},
	{Name: "圣杯国王", File: "49-King of Cups-圣杯国王.png"},
	{Name: "皇帝", File: "4-The Emperor-皇帝.png"},
	{Name: "宝剑一", File: "50-Ace of Swords-宝剑一.png"},
	{Name: "宝剑二", File: "51-Two of Swords-宝剑二.png"},
	{Name: "宝剑三", File: "52-Three of Swords-宝剑三.png"},
	{Name: "宝剑五", File: "54-Five of Swords-宝剑五.png"},
	{Name: "宝剑六", File: "55-Six of Swords-宝剑六.png"},
	{Name: "宝剑七", File: "56-Seven of Swords-宝剑七.png"},
	{Name: "星币三", File: "66-Three of Pentacles-星币三.png"},
	{Name: "星币九", File: "72-Nine of Pentacles-星币九.png"},
	{Name: "星币骑士", File: "75-Knight of Pentacles-星币骑士.png"},
	{Name: "隐士", File: "9-The Hermit-隐士.png"},
}
