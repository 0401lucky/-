package welfare

import (
	"context"
	"errors"
	"fmt"
	"time"
)

func (service *Service) ProcessDueScheduledRaffleDraws(ctx context.Context, nowMs int64, limit int) (ScheduledRaffleDrawResult, error) {
	if nowMs <= 0 {
		nowMs = millis(time.Now())
	}
	if limit <= 0 {
		limit = 20
	}
	if limit > 100 {
		limit = 100
	}

	rows, err := service.db.Query(ctx,
		`SELECT id
		 FROM raffles
		 WHERE mode = 'draw'
		   AND status = 'active'
		   AND trigger_type = 'scheduled'
		   AND scheduled_draw_at_ms IS NOT NULL
		   AND scheduled_draw_at_ms <= $1
		 ORDER BY scheduled_draw_at_ms ASC, id ASC
		 LIMIT $2`,
		nowMs,
		limit,
	)
	if err != nil {
		return ScheduledRaffleDrawResult{}, err
	}
	defer rows.Close()

	ids := make([]string, 0)
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return ScheduledRaffleDrawResult{}, err
		}
		ids = append(ids, id)
	}
	if err := rows.Err(); err != nil {
		return ScheduledRaffleDrawResult{}, err
	}

	result := ScheduledRaffleDrawResult{Success: true}
	for _, id := range ids {
		result.Checked++
		drawResult, err := service.ExecuteRaffleDraw(ctx, id)
		if errors.Is(err, ErrRaffleNotFound) {
			result.Skipped++
			continue
		}
		if err != nil {
			result.Failed++
			continue
		}
		if !drawResult.Success {
			result.Skipped++
			continue
		}

		result.Drawn++
		enqueued, err := service.EnqueueRaffleDelivery(ctx, id, "draw")
		if err != nil {
			result.Failed++
			continue
		}
		if enqueued {
			result.Enqueued++
		}
	}
	result.Message = fmt.Sprintf("定时开奖处理完成：检查 %d 个，开奖 %d 个，入队 %d 个，跳过 %d 个，失败 %d 个", result.Checked, result.Drawn, result.Enqueued, result.Skipped, result.Failed)
	return result, nil
}
