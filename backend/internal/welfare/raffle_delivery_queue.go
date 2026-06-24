package welfare

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

const (
	raffleDeliveryJobMaxAttempts      = int64(5)
	raffleDeliveryJobRetryDelayMillis = int64(10 * 60 * 1000)
	raffleDeliveryJobTimeoutMillis    = int64(5 * 60 * 1000)
)

type raffleDeliveryJob struct {
	ID       int64
	RaffleID string
	Reason   string
	Attempts int64
}

func (service *Service) EnqueueRaffleDelivery(ctx context.Context, raffleID string, reason string) (bool, error) {
	raffleID = strings.TrimSpace(raffleID)
	if raffleID == "" {
		return false, nil
	}
	if reason != "retry" {
		reason = "draw"
	}

	now := millis(time.Now())
	tag, err := service.db.Exec(ctx,
		`INSERT INTO raffle_delivery_jobs (
		   raffle_id, reason, status, attempts, available_at_ms, created_at_ms, updated_at_ms
		 ) VALUES ($1, $2, 'pending', 0, $3, $3, $3)
		 ON CONFLICT DO NOTHING`,
		raffleID,
		reason,
		now,
	)
	if err != nil {
		return false, err
	}
	return tag.RowsAffected() > 0, nil
}

func (service *Service) ProcessRaffleDeliveryQueue(ctx context.Context, maxJobs int) (RaffleDeliveryQueueResult, error) {
	if maxJobs <= 0 {
		maxJobs = 1
	}
	if maxJobs > 20 {
		maxJobs = 20
	}

	now := millis(time.Now())
	recovered, err := service.recoverTimedOutRaffleDeliveryJobs(ctx, now)
	if err != nil {
		return RaffleDeliveryQueueResult{}, err
	}

	result := RaffleDeliveryQueueResult{
		Success:       true,
		RecoveredJobs: recovered,
	}
	for index := 0; index < maxJobs; index++ {
		job, ok, err := service.claimNextRaffleDeliveryJob(ctx, millis(time.Now()))
		if err != nil {
			return RaffleDeliveryQueueResult{}, err
		}
		if !ok {
			break
		}

		delivery, err := service.DeliverRaffleRewards(ctx, job.RaffleID)
		if err != nil {
			if markErr := service.finishRaffleDeliveryJob(ctx, job, false, err.Error()); markErr != nil {
				return RaffleDeliveryQueueResult{}, markErr
			}
			result.Failed++
			continue
		}
		if !delivery.Success {
			if markErr := service.markRaffleDeliveryJobFailed(ctx, job.ID, delivery.Message); markErr != nil {
				return RaffleDeliveryQueueResult{}, markErr
			}
			result.SkippedJobs++
			continue
		}

		result.ProcessedJobs++
		failedItems := int64(0)
		for _, item := range delivery.Results {
			if item.Success {
				result.Delivered++
			} else {
				failedItems++
				result.Failed++
			}
		}
		if failedItems > 0 {
			if markErr := service.finishRaffleDeliveryJob(ctx, job, false, fmt.Sprintf("%d 个奖励仍待确认", failedItems)); markErr != nil {
				return RaffleDeliveryQueueResult{}, markErr
			}
			result.Pending += failedItems
			continue
		}
		if markErr := service.markRaffleDeliveryJobDone(ctx, job.ID); markErr != nil {
			return RaffleDeliveryQueueResult{}, markErr
		}
	}

	result.Message = fmt.Sprintf("队列处理完成：处理 %d 个任务，成功 %d 笔，失败 %d 笔，待确认 %d 笔", result.ProcessedJobs, result.Delivered, result.Failed, result.Pending)
	return result, nil
}

func (service *Service) recoverTimedOutRaffleDeliveryJobs(ctx context.Context, now int64) (int64, error) {
	tag, err := service.db.Exec(ctx,
		`UPDATE raffle_delivery_jobs
		 SET status = 'pending',
		     available_at_ms = $1,
		     last_error = '处理超时，重新入队',
		     updated_at_ms = $1,
		     updated_at = now()
		 WHERE status = 'processing'
		   AND locked_at_ms IS NOT NULL
		   AND locked_at_ms < $2`,
		now,
		now-raffleDeliveryJobTimeoutMillis,
	)
	if err != nil {
		return 0, err
	}
	return tag.RowsAffected(), nil
}

func (service *Service) claimNextRaffleDeliveryJob(ctx context.Context, now int64) (raffleDeliveryJob, bool, error) {
	var job raffleDeliveryJob
	err := service.db.QueryRow(ctx,
		`WITH next_job AS (
		   SELECT id
		   FROM raffle_delivery_jobs
		   WHERE status = 'pending'
		     AND available_at_ms <= $1
		   ORDER BY available_at_ms ASC, id ASC
		   LIMIT 1
		   FOR UPDATE SKIP LOCKED
		 )
		 UPDATE raffle_delivery_jobs
		 SET status = 'processing',
		     attempts = attempts + 1,
		     locked_at_ms = $1,
		     updated_at_ms = $1,
		     updated_at = now()
		 WHERE id = (SELECT id FROM next_job)
		 RETURNING id, raffle_id, reason, attempts`,
		now,
	).Scan(&job.ID, &job.RaffleID, &job.Reason, &job.Attempts)
	if errors.Is(err, pgx.ErrNoRows) {
		return raffleDeliveryJob{}, false, nil
	}
	if err != nil {
		return raffleDeliveryJob{}, false, err
	}
	return job, true, nil
}

func (service *Service) finishRaffleDeliveryJob(ctx context.Context, job raffleDeliveryJob, done bool, message string) error {
	if done {
		return service.markRaffleDeliveryJobDone(ctx, job.ID)
	}
	if job.Attempts >= raffleDeliveryJobMaxAttempts {
		return service.markRaffleDeliveryJobFailed(ctx, job.ID, message)
	}
	return service.requeueRaffleDeliveryJob(ctx, job.ID, message)
}

func (service *Service) markRaffleDeliveryJobDone(ctx context.Context, jobID int64) error {
	now := millis(time.Now())
	_, err := service.db.Exec(ctx,
		`UPDATE raffle_delivery_jobs
		 SET status = 'done',
		     locked_at_ms = NULL,
		     last_error = '',
		     updated_at_ms = $2,
		     updated_at = now()
		 WHERE id = $1`,
		jobID,
		now,
	)
	return err
}

func (service *Service) markRaffleDeliveryJobFailed(ctx context.Context, jobID int64, message string) error {
	now := millis(time.Now())
	_, err := service.db.Exec(ctx,
		`UPDATE raffle_delivery_jobs
		 SET status = 'failed',
		     locked_at_ms = NULL,
		     last_error = $2,
		     updated_at_ms = $3,
		     updated_at = now()
		 WHERE id = $1`,
		jobID,
		message,
		now,
	)
	return err
}

func (service *Service) requeueRaffleDeliveryJob(ctx context.Context, jobID int64, message string) error {
	now := millis(time.Now())
	_, err := service.db.Exec(ctx,
		`UPDATE raffle_delivery_jobs
		 SET status = 'pending',
		     locked_at_ms = NULL,
		     available_at_ms = $2,
		     last_error = $3,
		     updated_at_ms = $1,
		     updated_at = now()
		 WHERE id = $4`,
		now,
		now+raffleDeliveryJobRetryDelayMillis,
		message,
		jobID,
	)
	return err
}
