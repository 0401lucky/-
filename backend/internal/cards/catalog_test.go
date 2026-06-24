package cards

import "testing"

func TestAllCardsMatchesLegacyCatalogCounts(t *testing.T) {
	catalog := AllCards()
	if len(catalog) != 137 {
		t.Fatalf("unexpected total cards: %d", len(catalog))
	}

	counts := map[string]int{}
	rarityCounts := map[Rarity]int{}
	for _, card := range catalog {
		counts[card.AlbumID] += 1
		rarityCounts[card.Rarity] += 1
	}
	if counts["animal-s1"] != 20 || counts["animal-s2"] != 39 || counts["tarot"] != 78 {
		t.Fatalf("unexpected album counts: %#v", counts)
	}
	if rarityCounts[RarityLegendaryRare] != 10 || rarityCounts[RarityLegendary] != 13 ||
		rarityCounts[RarityEpic] != 25 || rarityCounts[RarityRare] != 42 || rarityCounts[RarityCommon] != 47 {
		t.Fatalf("unexpected rarity counts: %#v", rarityCounts)
	}
}

func TestAllCardsMatchesLegacyCardShape(t *testing.T) {
	catalog := AllCards()
	first := catalog[0]
	if first.ID != "animal-s1-legendary_rare-熊猫" || first.Name != "熊猫" || first.Rarity != RarityLegendaryRare || first.AlbumID != "animal-s1" {
		t.Fatalf("unexpected first card: %+v", first)
	}
	if first.Image != "/images-optimized/large/动物卡/熊猫.webp" ||
		first.ThumbnailImage != "/images-optimized/thumb/动物卡/熊猫.webp" ||
		first.OriginalImage != "/images/动物卡/熊猫.png" ||
		first.BackImage != "/images/通用1/第一等级-传说稀有.png" ||
		first.Probability != 0.5 {
		t.Fatalf("unexpected first card assets: %+v", first)
	}

	last := catalog[len(catalog)-1]
	if last.ID != "tarot-common-隐士" ||
		last.Image != "/images-optimized/large/塔罗/普通/9-The Hermit-隐士.webp" ||
		last.ThumbnailImage != "/images-optimized/thumb/塔罗/普通/9-The Hermit-隐士.webp" {
		t.Fatalf("unexpected last tarot card: %+v", last)
	}
}

func TestCardsByAlbumFiltersCatalog(t *testing.T) {
	cards := CardsByAlbum("animal-s1")
	if len(cards) != 20 {
		t.Fatalf("unexpected animal-s1 count: %d", len(cards))
	}
	for _, card := range cards {
		if card.AlbumID != "animal-s1" {
			t.Fatalf("unexpected card from another album: %+v", card)
		}
	}
}
