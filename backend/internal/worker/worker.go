package worker

import (
	"context"
	"log/slog"
	"time"

	"redemption/backend/internal/config"
	"redemption/backend/internal/eco"
	"redemption/backend/internal/welfare"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
	"github.com/robfig/cron/v3"
)

type Dependencies struct {
	Config config.Config
	Logger *slog.Logger
	DB     *pgxpool.Pool
	Redis  *redis.Client
}

type Runner struct {
	deps Dependencies
}

func New(deps Dependencies) *Runner {
	return &Runner{deps: deps}
}

func (runner *Runner) Run(ctx context.Context) error {
	scheduler := cron.New(cron.WithSeconds())

	if _, err := scheduler.AddFunc("0 */10 * * * *", func() {
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()

		result, err := eco.NewService(runner.deps.DB).ProcessTheftInvestigations(ctx, 25, 0)
		if err != nil {
			runner.deps.Logger.Error("环保偷盗追查失败", "error", err)
			return
		}
		if result.Checked > 0 || result.Skipped > 0 {
			runner.deps.Logger.Info(
				"环保偷盗追查完成",
				"checked", result.Checked,
				"caught", result.Caught,
				"escaped", result.Escaped,
				"rescheduled", result.Rescheduled,
				"skipped", result.Skipped,
			)
		}
	}); err != nil {
		return err
	}

	if _, err := scheduler.AddFunc("0 0 16 * * *", func() {
		runner.deps.Logger.Info("后台任务占位：数字炸弹结算等待迁移")
	}); err != nil {
		return err
	}

	if _, err := scheduler.AddFunc("*/10 * * * * *", func() {
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()

		result, err := welfare.NewService(runner.deps.DB).ProcessRaffleDeliveryQueue(ctx, 5)
		if err != nil {
			runner.deps.Logger.Error("处理抽奖发奖队列失败", "error", err)
			return
		}
		if result.ProcessedJobs > 0 || result.RecoveredJobs > 0 || result.Failed > 0 || result.Pending > 0 {
			runner.deps.Logger.Info(
				"抽奖发奖队列处理完成",
				"processedJobs", result.ProcessedJobs,
				"delivered", result.Delivered,
				"failed", result.Failed,
				"pending", result.Pending,
				"recoveredJobs", result.RecoveredJobs,
			)
		}
	}); err != nil {
		return err
	}

	scheduler.Start()
	runner.deps.Logger.Info("Go Worker 已启动")

	<-ctx.Done()
	shutdownCtx := scheduler.Stop()
	select {
	case <-shutdownCtx.Done():
	case <-time.After(10 * time.Second):
		runner.deps.Logger.Warn("Go Worker 定时任务关闭超时")
	}

	runner.deps.Logger.Info("Go Worker 已关闭")
	return nil
}
