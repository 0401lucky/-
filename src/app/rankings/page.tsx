'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, RefreshCw, Trophy, Medal, Star } from 'lucide-react';

type GamePeriod = 'daily' | 'weekly' | 'monthly';
type SimplePeriod = 'all' | 'monthly';
type SettlementPeriod = 'weekly' | 'monthly';

type SupportedGame = 'slot' | 'linkgame' | 'match3' | 'memory' | 'pachinko' | 'tower';

interface GameOverallEntry {
  rank: number;
  userId: number;
  username: string;
  totalScore: number;
  totalPoints: number;
  gamesPlayed: number;
}

interface GameEntry {
  rank: number;
  userId: number;
  username: string;
  totalScore: number;
  totalPoints: number;
  gamesPlayed: number;
}

interface GameRankingGroup {
  gameType: SupportedGame;
  leaderboard: GameEntry[];
}

interface GamesRankingData {
  period: GamePeriod;
  overall: GameOverallEntry[];
  games: GameRankingGroup[];
}

interface PointsEntry {
  rank: number;
  userId: number;
  username: string;
  points: number;
}

interface PointsRankingData {
  period: SimplePeriod;
  leaderboard: PointsEntry[];
}

interface CheckinEntry {
  rank: number;
  userId: number;
  username: string;
  streak: number;
}

interface CheckinRankingData {
  period: SimplePeriod;
  leaderboard: CheckinEntry[];
}

interface SettlementHistoryItem {
  id: string;
  periodLabel: string;
  status: 'success' | 'partial' | 'failed';
  summary: {
    granted: number;
    skipped: number;
    failed: number;
    totalRewardPoints: number;
  };
  settledAt: number;
}

interface SettlementHistoryData {
  period: SettlementPeriod;
  items: SettlementHistoryItem[];
}

const GAME_LABEL: Record<SupportedGame, string> = {
  slot: '老虎机',
  linkgame: '连连看',
  match3: '消消乐',
  memory: '记忆翻牌',
  pachinko: '弹珠游戏',
  tower: '爬塔挑战',
};

export default function RankingsPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [gamePeriod, setGamePeriod] = useState<GamePeriod>('daily');
  const [pointsPeriod, setPointsPeriod] = useState<SimplePeriod>('all');
  const [checkinPeriod, setCheckinPeriod] = useState<SimplePeriod>('all');
  const [historyPeriod, setHistoryPeriod] = useState<SettlementPeriod>('weekly');

  const [gamesData, setGamesData] = useState<GamesRankingData | null>(null);
  const [pointsData, setPointsData] = useState<PointsRankingData | null>(null);
  const [checkinData, setCheckinData] = useState<CheckinRankingData | null>(null);
  const [historyData, setHistoryData] = useState<SettlementHistoryData | null>(null);

  const fetchRankings = useCallback(
    async (silent = false) => {
      if (silent) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }
      setError(null);

      try {
        const meRes = await fetch('/api/auth/me', { cache: 'no-store' });
        if (!meRes.ok) {
          router.push('/login?redirect=/rankings');
          return;
        }
        const meData = await meRes.json();
        if (!meData.success) {
          router.push('/login?redirect=/rankings');
          return;
        }

        const [gamesRes, pointsRes, checkinRes, historyRes] = await Promise.all([
          fetch(`/api/rankings/games?period=${gamePeriod}&limit=10`, { cache: 'no-store' }),
          fetch(`/api/rankings/points?period=${pointsPeriod}&limit=10`, { cache: 'no-store' }),
          fetch(`/api/rankings/checkin-streak?period=${checkinPeriod}&limit=10`, {
            cache: 'no-store',
          }),
          fetch(`/api/rankings/history?period=${historyPeriod}&limit=5`, {
            cache: 'no-store',
          }),
        ]);

        const [gamesJson, pointsJson, checkinJson, historyJson] = await Promise.all([
          gamesRes.json(),
          pointsRes.json(),
          checkinRes.json(),
          historyRes.json(),
        ]);

        if (!gamesRes.ok || !gamesJson.success) {
          throw new Error(gamesJson.message || '获取游戏排行榜失败');
        }
        if (!pointsRes.ok || !pointsJson.success) {
          throw new Error(pointsJson.message || '获取积分排行榜失败');
        }
        if (!checkinRes.ok || !checkinJson.success) {
          throw new Error(checkinJson.message || '获取签到排行榜失败');
        }
        if (!historyRes.ok || !historyJson.success) {
          throw new Error(historyJson.message || '获取周期榜历史失败');
        }

        setGamesData(gamesJson.data as GamesRankingData);
        setPointsData(pointsJson.data as PointsRankingData);
        setCheckinData(checkinJson.data as CheckinRankingData);
        setHistoryData(historyJson.data as SettlementHistoryData);
      } catch (err) {
        setError(err instanceof Error ? err.message : '获取排行榜失败');
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [router, gamePeriod, pointsPeriod, checkinPeriod, historyPeriod]
  );

  useEffect(() => {
    void fetchRankings();
  }, [fetchRankings]);

  const gamePeriodLabel = useMemo(() => {
    if (gamePeriod === 'weekly') return '周榜';
    if (gamePeriod === 'monthly') return '月榜';
    return '日榜';
  }, [gamePeriod]);

  return (
    <div className="min-h-screen bg-[#fafaf9]">
      <nav className="sticky top-0 z-50 glass border-b border-white/50">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/" className="flex items-center gap-2 text-stone-500 hover:text-stone-800 text-sm">
              <ArrowLeft className="w-4 h-4" />
              返回首页
            </Link>
            <div className="w-px h-5 bg-stone-300" />
            <div className="flex items-center gap-2 font-semibold text-stone-800">
              <Trophy className="w-4 h-4 text-amber-500" />
              排行榜中心
            </div>
          </div>

          <button
            onClick={() => void fetchRankings(true)}
            disabled={refreshing}
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border border-stone-200 text-stone-600 hover:bg-stone-50 disabled:opacity-50 text-sm"
          >
            <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
            刷新
          </button>
        </div>
      </nav>

      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-8 space-y-6">
        {error && (
          <div className="p-3 rounded-xl border border-red-200 bg-red-50 text-red-600 text-sm">{error}</div>
        )}

        <section className="bg-white border border-stone-200 rounded-2xl p-5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-base font-semibold text-stone-800">全游戏总榜</h2>
              <p className="text-xs text-stone-500 mt-1">按总得分排序，显示各游戏综合表现</p>
            </div>
            <select
              value={gamePeriod}
              onChange={(event) => setGamePeriod(event.target.value as GamePeriod)}
              className="px-3 py-1.5 text-sm rounded-lg border border-stone-200 bg-stone-50"
            >
              <option value="daily">日榜</option>
              <option value="weekly">周榜</option>
              <option value="monthly">月榜</option>
            </select>
          </div>

          {loading ? (
            <div className="text-sm text-stone-500">加载中...</div>
          ) : (
            <div className="space-y-4">
              <div className="text-xs text-stone-500">当前：{gamePeriodLabel}</div>
              <div className="space-y-2">
                {gamesData?.overall?.length ? (
                  gamesData.overall.map((entry) => (
                    <div
                      key={`overall-${entry.userId}`}
                      className="flex items-center justify-between p-3 rounded-xl border border-stone-200"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="w-8 h-8 rounded-full bg-amber-50 text-amber-700 border border-amber-100 flex items-center justify-center text-sm font-bold">
                          {entry.rank}
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-stone-800 truncate">{entry.username}</p>
                          <p className="text-xs text-stone-500">游玩 {entry.gamesPlayed} 局</p>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-semibold text-stone-800">{entry.totalScore} 分</p>
                        <p className="text-xs text-stone-500">积分 +{entry.totalPoints}</p>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="text-sm text-stone-500">暂无数据</div>
                )}
              </div>
            </div>
          )}
        </section>

        <section className="bg-white border border-stone-200 rounded-2xl p-5">
          <div className="flex items-center gap-2 mb-4">
            <Medal className="w-4 h-4 text-sky-500" />
            <h2 className="text-base font-semibold text-stone-800">分游戏排行榜</h2>
          </div>
          {loading ? (
            <div className="text-sm text-stone-500">加载中...</div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {(gamesData?.games ?? []).map((group) => (
                <div key={group.gameType} className="border border-stone-200 rounded-xl p-3">
                  <h3 className="text-sm font-semibold text-stone-700 mb-2">{GAME_LABEL[group.gameType]}</h3>
                  <div className="space-y-2">
                    {group.leaderboard.length > 0 ? (
                      group.leaderboard.slice(0, 5).map((entry) => (
                        <div key={`${group.gameType}-${entry.userId}`} className="flex items-center justify-between text-sm">
                          <span className="text-stone-600 truncate">
                            #{entry.rank} {entry.username}
                          </span>
                          <span className="text-stone-800 font-medium">{entry.totalScore}</span>
                        </div>
                      ))
                    ) : (
                      <div className="text-xs text-stone-400">暂无数据</div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="bg-white border border-stone-200 rounded-2xl p-5">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Star className="w-4 h-4 text-purple-500" />
                <h2 className="text-base font-semibold text-stone-800">积分总榜</h2>
              </div>
              <select
                value={pointsPeriod}
                onChange={(event) => setPointsPeriod(event.target.value as SimplePeriod)}
                className="px-3 py-1.5 text-sm rounded-lg border border-stone-200 bg-stone-50"
              >
                <option value="all">累计</option>
                <option value="monthly">本月净增</option>
              </select>
            </div>
            {loading ? (
              <div className="text-sm text-stone-500">加载中...</div>
            ) : (
              <div className="space-y-2">
                {pointsData?.leaderboard?.length ? (
                  pointsData.leaderboard.map((entry) => (
                    <div key={`points-${entry.userId}`} className="flex items-center justify-between text-sm p-2 rounded-lg border border-stone-200">
                      <span className="text-stone-600 truncate">#{entry.rank} {entry.username}</span>
                      <span className="font-semibold text-stone-800">{entry.points}</span>
                    </div>
                  ))
                ) : (
                  <div className="text-sm text-stone-500">暂无数据</div>
                )}
              </div>
            )}
          </div>

          <div className="bg-white border border-stone-200 rounded-2xl p-5">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Star className="w-4 h-4 text-emerald-500" />
                <h2 className="text-base font-semibold text-stone-800">签到连续天数榜</h2>
              </div>
              <select
                value={checkinPeriod}
                onChange={(event) => setCheckinPeriod(event.target.value as SimplePeriod)}
                className="px-3 py-1.5 text-sm rounded-lg border border-stone-200 bg-stone-50"
              >
                <option value="all">连续天数</option>
                <option value="monthly">本月连续</option>
              </select>
            </div>
            {loading ? (
              <div className="text-sm text-stone-500">加载中...</div>
            ) : (
              <div className="space-y-2">
                {checkinData?.leaderboard?.length ? (
                  checkinData.leaderboard.map((entry) => (
                    <div key={`checkin-${entry.userId}`} className="flex items-center justify-between text-sm p-2 rounded-lg border border-stone-200">
                      <span className="text-stone-600 truncate">#{entry.rank} {entry.username}</span>
                      <span className="font-semibold text-stone-800">{entry.streak} 天</span>
                    </div>
                  ))
                ) : (
                  <div className="text-sm text-stone-500">暂无数据</div>
                )}
              </div>
            )}
          </div>
        </section>

        <section className="bg-white border border-stone-200 rounded-2xl p-5">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Star className="w-4 h-4 text-rose-500" />
              <h2 className="text-base font-semibold text-stone-800">周期榜结算历史</h2>
            </div>
            <select
              value={historyPeriod}
              onChange={(event) => setHistoryPeriod(event.target.value as SettlementPeriod)}
              className="px-3 py-1.5 text-sm rounded-lg border border-stone-200 bg-stone-50"
            >
              <option value="weekly">周榜</option>
              <option value="monthly">月榜</option>
            </select>
          </div>

          {loading ? (
            <div className="text-sm text-stone-500">加载中...</div>
          ) : (
            <div className="space-y-2">
              {(historyData?.items ?? []).length > 0 ? (
                historyData?.items.map((item) => (
                  <div key={item.id} className="border border-stone-200 rounded-xl p-3 text-sm">
                    <div className="flex items-center justify-between mb-1">
                      <p className="font-medium text-stone-800">{item.periodLabel}</p>
                      <span className={`text-xs ${item.status === 'success' ? 'text-emerald-600' : item.status === 'partial' ? 'text-amber-600' : 'text-red-600'}`}>
                        {item.status === 'success' ? '已结算' : item.status === 'partial' ? '部分完成' : '失败'}
                      </span>
                    </div>
                    <p className="text-xs text-stone-500">
                      发放 {item.summary.granted} 人 · 失败 {item.summary.failed} 人 · 奖励总额 {item.summary.totalRewardPoints} 积分
                    </p>
                  </div>
                ))
              ) : (
                <div className="text-sm text-stone-500">暂无周期结算记录</div>
              )}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
