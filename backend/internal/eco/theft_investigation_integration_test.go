//go:build integration

package eco

import (
	"context"
	"fmt"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

func TestTheftCanSurviveAllInvestigationsAndSellOnBlackMarket(t *testing.T) {
	fixture := newActiveTheftFixture(t)
	ctx := context.Background()
	previousRoll := ecoTheftInvestigationRollFloat
	ecoTheftInvestigationRollFloat = func() float64 { return 0.5 }
	t.Cleanup(func() { ecoTheftInvestigationRollFloat = previousRoll })

	for elapsed := theftCheckIntervalMS; elapsed < theftBlackMarketDelayMS; elapsed += theftCheckIntervalMS {
		result, err := fixture.service.ProcessTheftInvestigations(ctx, 25, fixture.stolenAtMs+elapsed)
		if err != nil {
			t.Fatal(err)
		}
		if result.Checked != 1 || result.Rescheduled != 1 || result.Caught != 0 {
			t.Fatalf("a surviving theft must not repeatedly face the full cumulative risk at minute %d: %+v", elapsed/60000, result)
		}
	}

	deadline := fixture.stolenAtMs + theftBlackMarketDelayMS
	tooEarly, err := fixture.service.SellStolenPrize(ctx, SellStolenPrizeInput{UserID: fixture.thiefID, Key: "coin", NowMs: deadline - 1})
	if err != nil || tooEarly.Success {
		t.Fatalf("the black market must stay closed before 24 hours: %+v, %v", tooEarly, err)
	}
	escaped, err := fixture.service.ProcessTheftInvestigations(ctx, 25, deadline)
	if err != nil || escaped.Checked != 1 || escaped.Escaped != 1 || escaped.Caught != 0 {
		t.Fatalf("the surviving theft must escape at 24 hours: %+v, %v", escaped, err)
	}
	views, err := fixture.service.buildAdminTheftViews(ctx)
	if err != nil {
		t.Fatal(err)
	}
	foundEscaped := false
	for _, view := range views {
		if view.ID == fixture.theftID && view.Outcome != nil && *view.Outcome == "escaped" {
			foundEscaped = true
		}
	}
	if !foundEscaped {
		t.Fatal("the admin theft history must show the successful escape")
	}

	sold, err := fixture.service.SellStolenPrize(ctx, SellStolenPrizeInput{UserID: fixture.thiefID, Key: "coin", NowMs: deadline})
	if err != nil || !sold.Success || sold.QuantitySold != 1 || sold.PointsEarned != ecoPrizeDefinitions["coin"].MaxPrice {
		t.Fatalf("the escaped prize must sell at the black market price: %+v, %v", sold, err)
	}
	again, err := fixture.service.SellStolenPrize(ctx, SellStolenPrizeInput{UserID: fixture.thiefID, Key: "coin", NowMs: deadline + 1})
	if err != nil || again.Success || again.Balance != sold.Balance {
		t.Fatalf("repeating the sale must not credit points twice: %+v, %v", again, err)
	}
	var remainingLots, publicEntries, thiefAwards int64
	if err := fixture.db.QueryRow(ctx, `SELECT
	 (SELECT COUNT(*) FROM eco_prize_lots WHERE user_id = $1 AND source = 'stolen'),
	 (SELECT COUNT(*) FROM eco_public_prizes WHERE id = $2),
	 (SELECT COUNT(*) FROM user_achievement_grants WHERE user_id = $1 AND achievement_id = 'thief')`,
		fixture.thiefID, fixture.publicID).Scan(&remainingLots, &publicEntries, &thiefAwards); err != nil {
		t.Fatal(err)
	}
	if remainingLots != 0 || publicEntries != 0 || thiefAwards != 0 {
		t.Fatalf("unexpected completed theft state: lots=%d public=%d penalties=%d", remainingLots, publicEntries, thiefAwards)
	}
}

func TestDelayedTheftInvestigationsDoNotMultiplyCurrentRisk(t *testing.T) {
	fixture := newActiveTheftFixture(t)
	ctx := context.Background()
	previousRoll := ecoTheftInvestigationRollFloat
	ecoTheftInvestigationRollFloat = func() float64 { return 0.24 }
	t.Cleanup(func() { ecoTheftInvestigationRollFloat = previousRoll })

	nowMs := fixture.stolenAtMs + int64(3*time.Hour/time.Millisecond)
	for _, batch := range []struct {
		limit, checks int64
	}{{3, 3}, {25, 6}, {25, 0}} {
		result, err := fixture.service.ProcessTheftInvestigations(ctx, batch.limit, nowMs)
		if err != nil || result.Checked != batch.checks || result.Rescheduled != batch.checks || result.Caught != 0 {
			t.Fatalf("a delayed worker must process each scheduled risk increment once: %+v, %v", result, err)
		}
	}
	var nextCheck int64
	if err := fixture.db.QueryRow(ctx, `SELECT next_check_at_ms FROM eco_thefts WHERE id = $1`, fixture.theftID).Scan(&nextCheck); err != nil {
		t.Fatal(err)
	}
	if nextCheck != nowMs+theftCheckIntervalMS {
		t.Fatalf("unexpected next investigation: got %d want %d", nextCheck, nowMs+theftCheckIntervalMS)
	}
}

type activeTheftFixture struct {
	service    *Service
	db         *pgxpool.Pool
	thiefID    int64
	theftID    string
	publicID   string
	stolenAtMs int64
}

func newActiveTheftFixture(t *testing.T) activeTheftFixture {
	t.Helper()
	ctx := context.Background()
	service, db, cleanup := newEcoIntegrationService(t, ctx)
	t.Cleanup(cleanup)
	ownerID := int64(1_200_000_000 + time.Now().UnixNano()%1_000_000_000)
	thiefID := ownerID + 1
	t.Cleanup(func() {
		cleanupEcoUser(t, ctx, db, ownerID)
		cleanupEcoUser(t, ctx, db, thiefID)
	})
	nowMs := testChinaDateMs(2026, 9, 8) + int64(6*time.Hour/time.Millisecond)
	seedEcoTheftInvestigationUsers(t, ctx, db, ownerID, thiefID, 1000, 1000, nowMs)
	publicID := fmt.Sprintf("theft-flow-public-%d", ownerID)
	ownerLotID := fmt.Sprintf("theft-flow-lot-%d", ownerID)
	if _, err := db.Exec(ctx, `INSERT INTO eco_prize_inventory
	 (user_id, prize_key, inventory_count, limited_count, lifetime_claim_count)
	 VALUES ($1, 'coin', 1, 0, 1)`, ownerID); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(ctx, `INSERT INTO eco_prize_lots
	 (id, user_id, prize_key, acquired_at_ms, available_at_ms, limited, source, public_entry_id, publicly_listed_at_ms, merchant_available_at_ms)
	 VALUES ($1, $2, 'coin', $3, $3, false, 'claim', $4, $3, $3)`, ownerLotID, ownerID, nowMs, publicID); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(ctx, `INSERT INTO eco_public_prizes
	 (id, prize_key, owner_user_id, owner_name, owner_lot_id, public_at_ms, merchant_available_at_ms, status)
	 VALUES ($1, 'coin', $2, 'owner', $3, $4, $4, 'listed')`, publicID, ownerID, ownerLotID, nowMs); err != nil {
		t.Fatal(err)
	}
	stolen, err := service.StealPublicPrize(ctx, StealPublicPrizeInput{UserID: thiefID, EntryID: publicID, Message: "test theft", NowMs: nowMs})
	if err != nil || !stolen.Success {
		t.Fatalf("stealing an eligible public prize should succeed: %+v, %v", stolen, err)
	}
	var theftID string
	if err := db.QueryRow(ctx, `SELECT id FROM eco_thefts WHERE thief_user_id = $1 AND public_entry_id = $2`, thiefID, publicID).Scan(&theftID); err != nil {
		t.Fatal(err)
	}
	return activeTheftFixture{service: service, db: db, thiefID: thiefID, theftID: theftID, publicID: publicID, stolenAtMs: nowMs}
}
