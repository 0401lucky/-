'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { 
  ArrowLeft, Loader2, Search, Users, 
  LogOut, User as UserIcon, X, 
  ChevronRight, Gift, Sparkles, Clock, CheckCircle2, Star, RefreshCw, Coins
} from 'lucide-react';

interface UserWithStats {
  id: number;
  username: string;
  firstSeen: number;
  claimsCount: number;
  lotteryCount: number;
  isNewUser: boolean;
}

interface ClaimRecord {
  id: string;
  projectId: string;
  projectName: string;
  userId: number;
  username: string;
  code: string;
  claimedAt: number;
}

interface LotteryRecord {
  id: string;
  oderId: string;
  username: string;
  tierName: string;
  tierValue: number;
  code: string;
  directCredit?: boolean;
  creditedQuota?: number;
  createdAt: number;
}

interface PointsLog {
  id: string;
  amount: number;
  source: 'game_play' | 'game_win' | 'daily_login' | 'checkin_bonus' | 'exchange' | 'admin_adjust';
  description: string;
  balance: number;
  createdAt: number;
}

interface UserData {
  id: number;
  username: string;
  displayName: string;
  isAdmin: boolean;
}

export default function UsersPage() {
  const [users, setUsers] = useState<UserWithStats[]>([]);
  const [filteredUsers, setFilteredUsers] = useState<UserWithStats[]>([]);
  const [user, setUser] = useState<UserData | null>(null);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterType, setFilterType] = useState<'all' | 'new' | 'claimed'>('all');
  
  // 分页状态
  const [page, setPage] = useState(1);
  const [totalUsers, setTotalUsers] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  
  // 用户详情模态框
  const [selectedUser, setSelectedUser] = useState<UserWithStats | null>(null);
  const [userClaims, setUserClaims] = useState<ClaimRecord[]>([]);
  const [userLotteryRecords, setUserLotteryRecords] = useState<LotteryRecord[]>([]);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [syncing, setSyncing] = useState(false);
  
  // 积分相关状态
  const [userPoints, setUserPoints] = useState<number | null>(null);
  const [userPointsLogs, setUserPointsLogs] = useState<PointsLog[]>([]);
  const [adjustAmount, setAdjustAmount] = useState('');
  const [adjustReason, setAdjustReason] = useState('');
  const [adjusting, setAdjusting] = useState(false);
  const [pointsError, setPointsError] = useState(false);
  
  // 请求序号防抖，防止竞态
  const requestIdRef = useRef(0);
  
  const router = useRouter();

  useEffect(() => {
    let result = users;
    
    // 类型过滤（前端过滤，因为搜索在后端）
    if (filterType === 'new') {
      result = result.filter(u => u.isNewUser);
    } else if (filterType === 'claimed') {
      result = result.filter(u => !u.isNewUser);
    }
    
    setFilteredUsers(result);
  }, [users, filterType]);

  const fetchData = useCallback(async (
    { resetPage = true, search = '' }: { resetPage?: boolean; search?: string } = {}
  ) => {
    try {
      const userRes = await fetch('/api/auth/me');
      if (!userRes.ok) {
        router.push('/login?redirect=/admin/users');
        return;
      }
      const userData = await userRes.json();
      if (!userData.success || !userData.user?.isAdmin) {
        router.push('/');
        return;
      }
      setUser(userData.user);

      // 重置分页
      if (resetPage) {
        setPage(1);
        setUsers([]);
      }
      
      const trimmedSearch = search.trim();
      const searchParam = trimmedSearch ? `&search=${encodeURIComponent(trimmedSearch)}` : '';
      const usersRes = await fetch(`/api/admin/users?page=1&limit=50${searchParam}`);
      if (usersRes.ok) {
        const data = await usersRes.json();
        if (data.success) {
          setUsers(data.users);
          setTotalUsers(data.pagination?.total || data.users.length);
          setHasMore(data.pagination?.hasMore ?? false);
          setPage(1);
        }
      }
    } catch (error) {
      console.error('Fetch error:', error);
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    void fetchData({ resetPage: true, search: '' });
  }, [fetchData]);

  // 加载更多用户
  const loadMoreUsers = async () => {
    if (loadingMore || !hasMore) return;
    
    setLoadingMore(true);
    try {
      const nextPage = page + 1;
      const searchParam = searchQuery.trim() ? `&search=${encodeURIComponent(searchQuery.trim())}` : '';
      const res = await fetch(`/api/admin/users?page=${nextPage}&limit=50${searchParam}`);
      if (res.ok) {
        const data = await res.json();
        if (data.success && data.users?.length > 0) {
          setUsers(prev => [...prev, ...data.users]);
          setPage(nextPage);
          setHasMore(data.pagination?.hasMore ?? false);
        } else {
          setHasMore(false);
        }
      }
    } catch (err) {
      console.error('Load more error:', err);
    } finally {
      setLoadingMore(false);
    }
  };

  // 搜索防抖
  useEffect(() => {
    const timer = setTimeout(() => {
      if (!loading) {
        void fetchData({ resetPage: true, search: searchQuery });
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [fetchData, loading, searchQuery]);

  const handleUserClick = async (u: UserWithStats) => {
    // 递增请求序号，用于防止竞态
    const currentRequestId = ++requestIdRef.current;
    
    setSelectedUser(u);
    setLoadingDetail(true);
    // 清空所有详情数据，防止显示上一个用户的数据
    setUserPoints(null);
    setUserPointsLogs([]);
    setUserClaims([]);
    setUserLotteryRecords([]);
    setAdjustAmount('');
    setAdjustReason('');
    setPointsError(false);
    
    try {
      // 并行获取用户详情和积分信息
      const [detailRes, pointsRes] = await Promise.all([
        fetch(`/api/admin/users/${u.id}`),
        fetch(`/api/admin/points?userId=${u.id}`)
      ]);
      
      // 检查是否仍是最新请求
      if (currentRequestId !== requestIdRef.current) return;
      
      if (detailRes.ok) {
        const data = await detailRes.json();
        if (data.success) {
          setUserClaims(data.claims || []);
          setUserLotteryRecords(data.lotteryRecords || []);
        }
      }
      
      if (pointsRes.ok) {
        const pointsData = await pointsRes.json();
        if (pointsData.success && pointsData.data) {
          setUserPoints(pointsData.data.balance ?? 0);
          setUserPointsLogs(pointsData.data.logs || []);
        } else {
          setPointsError(true);
        }
      } else {
        setPointsError(true);
      }
    } catch (error) {
      console.error('Fetch user detail error:', error);
      // 检查是否仍是最新请求
      if (currentRequestId === requestIdRef.current) {
        setPointsError(true);
      }
    } finally {
      // 只有最新请求才能结束 loading
      if (currentRequestId === requestIdRef.current) {
        setLoadingDetail(false);
      }
    }
  };

  const handleAdjustPoints = async () => {
    if (!selectedUser || !adjustAmount || !adjustReason.trim()) return;
    
    // 使用 Number 而非 parseInt，更严格的验证
    const amount = Number(adjustAmount);
    if (!Number.isSafeInteger(amount) || amount === 0) {
      alert('请输入有效的积分数量（必须是非零整数）');
      return;
    }
    
    setAdjusting(true);
    try {
      const res = await fetch('/api/admin/points', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: selectedUser.id,
          amount,
          description: adjustReason.trim()
        })
      });
      
      const data = await res.json();
      if (data.success) {
        // 刷新积分数据
        const pointsRes = await fetch(`/api/admin/points?userId=${selectedUser.id}`);
        if (pointsRes.ok) {
          const pointsData = await pointsRes.json();
          if (pointsData.success && pointsData.data) {
            setUserPoints(pointsData.data.balance || 0);
            setUserPointsLogs(pointsData.data.logs || []);
          }
        }
        setAdjustAmount('');
        setAdjustReason('');
        alert(data.message || '积分调整成功');
      } else {
        alert(data.message || '积分调整失败');
      }
    } catch (error) {
      console.error('Adjust points error:', error);
      alert('积分调整失败');
    } finally {
      setAdjusting(false);
    }
  };

  const getSourceLabel = (source: string) => {
    const labels: Record<string, string> = {
      game_play: '游戏游玩',
      game_win: '游戏胜利',
      daily_login: '每日登录',
      checkin_bonus: '签到奖励',
      exchange: '商店兑换',
      admin_adjust: '管理员调整'
    };
    return labels[source] || source;
  };

  const handleLogout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.push('/');
  };

  const handleSyncUsers = async () => {
    if (syncing) return;
    setSyncing(true);
    try {
      const res = await fetch('/api/admin/sync-users', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        // 刷新用户列表
        await fetchData({ resetPage: true, search: searchQuery });
        alert(data.message);
      } else {
        alert(data.message || '同步失败');
      }
    } catch (error) {
      console.error('Sync error:', error);
      alert('同步失败');
    } finally {
      setSyncing(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#fafaf9]">
        <div className="text-center text-orange-500">
          <Loader2 className="w-10 h-10 animate-spin mx-auto" />
          <p className="mt-4 text-sm font-medium text-stone-500">加载用户数据...</p>
        </div>
      </div>
    );
  }

  const newUserCount = users.filter(u => u.isNewUser).length;
  const claimedUserCount = users.filter(u => !u.isNewUser).length;

  return (
    <div className="min-h-screen">
      {/* 导航栏 */}
      <nav className="sticky top-0 z-50 glass border-b border-white/50">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <div className="flex justify-between items-center h-16 sm:h-[72px]">
            <div className="flex items-center gap-4 sm:gap-6">
              <Link href="/admin" className="flex items-center gap-2 text-stone-500 hover:text-stone-800 transition-colors">
                <ArrowLeft className="w-4 h-4" />
                <span className="font-medium hidden sm:inline text-sm">管理后台</span>
              </Link>
              <div className="w-px h-5 bg-stone-300 hidden sm:block" />
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-blue-100 flex items-center justify-center">
                  <Users className="w-4 h-4 text-blue-600" />
                </div>
                <span className="text-lg font-bold text-stone-800 tracking-tight">用户管理</span>
              </div>
            </div>
            
            {user && (
              <div className="flex items-center gap-3 sm:gap-4">
                <div className="flex items-center gap-2 px-3 py-1.5 bg-stone-100 rounded-full border border-stone-200/50">
                  <div className="w-6 h-6 rounded-full bg-stone-300 flex items-center justify-center">
                    <UserIcon className="w-3 h-3 text-white" />
                  </div>
                  <span className="font-semibold text-stone-600 text-sm hidden sm:inline">{user.displayName}</span>
                </div>
                <button 
                  onClick={handleLogout} 
                  className="p-2 bg-stone-50 hover:bg-red-50 text-stone-400 hover:text-red-500 rounded-lg transition-colors"
                  title="退出登录"
                >
                  <LogOut className="w-4 h-4" />
                </button>
              </div>
            )}
          </div>
        </div>
      </nav>

      {/* 主内容 */}
      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-8 pb-20">
        {/* 操作栏 */}
        <div className="flex justify-end mb-4">
          <button
            onClick={handleSyncUsers}
            disabled={syncing}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-stone-600 bg-white border border-stone-200 rounded-xl hover:bg-stone-50 hover:border-stone-300 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <RefreshCw className={`w-4 h-4 ${syncing ? 'animate-spin' : ''}`} />
            {syncing ? '同步中...' : '同步历史用户'}
          </button>
        </div>

        {/* 统计卡片 */}
        <div className="grid grid-cols-3 gap-4 mb-8">
          <div className="glass rounded-2xl p-5 border border-white/50">
            <div className="flex items-center gap-3 mb-2">
              <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center">
                <Users className="w-5 h-5 text-blue-500" />
              </div>
              <span className="text-sm font-medium text-stone-500">总用户数</span>
            </div>
            <p className="text-3xl font-bold text-stone-800">{users.length}</p>
          </div>
          <div className="glass rounded-2xl p-5 border border-white/50">
            <div className="flex items-center gap-3 mb-2">
              <div className="w-10 h-10 rounded-xl bg-emerald-50 flex items-center justify-center">
                <Star className="w-5 h-5 text-emerald-500" />
              </div>
              <span className="text-sm font-medium text-stone-500">新用户</span>
            </div>
            <p className="text-3xl font-bold text-emerald-600">{newUserCount}</p>
          </div>
          <div className="glass rounded-2xl p-5 border border-white/50">
            <div className="flex items-center gap-3 mb-2">
              <div className="w-10 h-10 rounded-xl bg-orange-50 flex items-center justify-center">
                <Gift className="w-5 h-5 text-orange-500" />
              </div>
              <span className="text-sm font-medium text-stone-500">已领取</span>
            </div>
            <p className="text-3xl font-bold text-orange-600">{claimedUserCount}</p>
          </div>
        </div>

        {/* 搜索和筛选 */}
        <div className="flex flex-col sm:flex-row gap-4 mb-6">
          <div className="relative flex-1">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-stone-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="搜索用户名或ID..."
              className="w-full pl-12 pr-4 py-3 bg-white border border-stone-200 rounded-xl focus:border-orange-500 focus:ring-4 focus:ring-orange-100 transition-all outline-none text-stone-800 placeholder-stone-400 font-medium"
            />
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => setFilterType('all')}
              className={`px-4 py-2.5 rounded-xl font-medium text-sm transition-all ${
                filterType === 'all' 
                  ? 'bg-stone-800 text-white' 
                  : 'bg-white border border-stone-200 text-stone-600 hover:bg-stone-50'
              }`}
            >
              全部
            </button>
            <button
              onClick={() => setFilterType('new')}
              className={`px-4 py-2.5 rounded-xl font-medium text-sm transition-all ${
                filterType === 'new' 
                  ? 'bg-emerald-500 text-white' 
                  : 'bg-white border border-stone-200 text-stone-600 hover:bg-stone-50'
              }`}
            >
              🆕 新用户
            </button>
            <button
              onClick={() => setFilterType('claimed')}
              className={`px-4 py-2.5 rounded-xl font-medium text-sm transition-all ${
                filterType === 'claimed' 
                  ? 'bg-orange-500 text-white' 
                  : 'bg-white border border-stone-200 text-stone-600 hover:bg-stone-50'
              }`}
            >
              已领取
            </button>
          </div>
        </div>

        {/* 用户列表 */}
        <div className="glass rounded-3xl shadow-sm overflow-hidden">
          {filteredUsers.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-24 px-4">
              <div className="w-16 h-16 bg-stone-100 rounded-full flex items-center justify-center mb-4">
                <Users className="w-8 h-8 text-stone-400" />
              </div>
              <h2 className="text-lg font-bold text-stone-700 mb-1">暂无用户</h2>
              <p className="text-stone-500 text-sm">
                {searchQuery ? '未找到匹配的用户' : '还没有用户领取过福利'}
              </p>
            </div>
          ) : (
            <div>
              {/* Desktop Table Header */}
              <div className="hidden lg:grid grid-cols-[2fr_1fr_1fr_1fr_1fr_80px] px-8 py-4 bg-stone-50/80 border-b border-stone-200/60 text-xs font-bold text-stone-400 uppercase tracking-wider">
                <div className="pl-2">用户</div>
                <div>状态</div>
                <div>兑换码领取</div>
                <div>抽奖次数</div>
                <div>首次访问</div>
                <div className="text-right pr-2">操作</div>
              </div>
              
              <div className="divide-y divide-stone-100">
                {filteredUsers.map((u) => (
                  <div 
                    key={u.id}
                    onClick={() => handleUserClick(u)}
                    className="group cursor-pointer hover:bg-stone-50/50 transition-colors duration-200"
                  >
                    {/* Desktop View */}
                    <div className="hidden lg:grid grid-cols-[2fr_1fr_1fr_1fr_1fr_80px] px-8 py-5 items-center gap-4">
                      {/* User */}
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-50 to-stone-100 flex items-center justify-center border border-stone-200 group-hover:border-blue-200 transition-colors">
                          <UserIcon className="w-5 h-5 text-blue-500" />
                        </div>
                        <div>
                          <span className="font-bold text-stone-700 text-[15px] group-hover:text-blue-600 transition-colors">{u.username}</span>
                          <p className="text-xs text-stone-400">ID: {u.id}</p>
                        </div>
                      </div>

                      {/* Status */}
                      <div>
                        <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-bold border ${
                          u.isNewUser 
                            ? 'bg-emerald-50 text-emerald-600 border-emerald-100' 
                            : 'bg-stone-100 text-stone-500 border-stone-200'
                        }`}>
                          {u.isNewUser ? '🆕 新用户' : '老用户'}
                        </span>
                      </div>

                      {/* Claims Count */}
                      <div className="flex items-center gap-2">
                        <Gift className="w-4 h-4 text-orange-400" />
                        <span className="text-sm font-semibold text-stone-600">{u.claimsCount} 次</span>
                      </div>

                      {/* Lottery Count */}
                      <div className="flex items-center gap-2">
                        <Sparkles className="w-4 h-4 text-purple-400" />
                        <span className="text-sm font-semibold text-stone-600">{u.lotteryCount} 次</span>
                      </div>

                      {/* First Seen */}
                      <span className="text-sm text-stone-500">
                        {new Date(u.firstSeen).toLocaleDateString()}
                      </span>

                      {/* Actions */}
                      <div className="flex justify-end">
                        <div className="w-8 h-8 rounded-lg bg-stone-50 text-stone-400 flex items-center justify-center border border-stone-100 group-hover:bg-white group-hover:border-blue-200 group-hover:text-blue-500 transition-all">
                          <ChevronRight className="w-4 h-4" />
                        </div>
                      </div>
                    </div>

                    {/* Mobile Card View */}
                    <div className="lg:hidden p-5 flex flex-col gap-4">
                      <div className="flex items-start justify-between">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center border border-blue-100">
                            <UserIcon className="w-5 h-5 text-blue-500" />
                          </div>
                          <div>
                            <h3 className="font-bold text-stone-800 text-base">{u.username}</h3>
                            <p className="text-xs text-stone-400">ID: {u.id}</p>
                          </div>
                        </div>
                        <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-bold border ${
                          u.isNewUser 
                            ? 'bg-emerald-50 text-emerald-600 border-emerald-100' 
                            : 'bg-stone-100 text-stone-500 border-stone-200'
                        }`}>
                          {u.isNewUser ? '🆕 新' : '老用户'}
                        </span>
                      </div>
                      
                      <div className="bg-stone-50/50 rounded-xl p-4 border border-stone-100 grid grid-cols-3 gap-4">
                        <div className="text-center">
                          <p className="text-xs text-stone-500 mb-1">兑换码</p>
                          <p className="font-bold text-stone-800">{u.claimsCount}</p>
                        </div>
                        <div className="text-center border-x border-stone-200">
                          <p className="text-xs text-stone-500 mb-1">抽奖</p>
                          <p className="font-bold text-stone-800">{u.lotteryCount}</p>
                        </div>
                        <div className="text-center">
                          <p className="text-xs text-stone-500 mb-1">首次访问</p>
                          <p className="font-bold text-stone-800 text-xs">{new Date(u.firstSeen).toLocaleDateString()}</p>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              
              {/* 加载更多按钮 */}
              {hasMore && (
                <div className="p-4 text-center border-t border-stone-100">
                  <button
                    onClick={loadMoreUsers}
                    disabled={loadingMore}
                    className="px-6 py-2 bg-blue-500 text-white rounded-lg font-bold text-sm hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                  >
                    {loadingMore ? (
                      <span className="flex items-center gap-2">
                        <Loader2 className="w-4 h-4 animate-spin" />
                        加载中...
                      </span>
                    ) : (
                      `加载更多 (已加载 ${users.length}/${totalUsers})`
                    )}
                  </button>
                </div>
              )}
              
              {!hasMore && users.length > 0 && (
                <div className="p-4 text-center text-stone-400 text-sm border-t border-stone-100">
                  已加载全部 {totalUsers} 位用户
                </div>
              )}
            </div>
          )}
        </div>
      </main>

      {/* 用户详情模态框 */}
      {selectedUser && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 sm:p-6">
          <div 
            className="absolute inset-0 bg-stone-900/20 backdrop-blur-sm transition-opacity"
            onClick={() => setSelectedUser(null)}
          />
          
          <div className="relative w-full max-w-lg bg-white rounded-3xl shadow-2xl overflow-hidden animate-fade-in ring-1 ring-black/5 max-h-[80vh] flex flex-col">
            {/* Header */}
            <div className="px-6 py-4 border-b border-stone-100 flex justify-between items-center bg-stone-50/50 shrink-0">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center border border-blue-100">
                  <UserIcon className="w-5 h-5 text-blue-500" />
                </div>
                <div>
                  <h2 className="text-lg font-bold text-stone-800">{selectedUser.username}</h2>
                  <p className="text-xs text-stone-400">ID: {selectedUser.id}</p>
                </div>
              </div>
              <button 
                onClick={() => setSelectedUser(null)}
                className="w-8 h-8 rounded-full hover:bg-stone-100 flex items-center justify-center text-stone-400 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Content */}
            <div className="p-6 overflow-y-auto flex-1">
              {loadingDetail ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="w-8 h-8 animate-spin text-stone-400" />
                </div>
              ) : (
                <div className="space-y-6">
                  {/* 用户状态 */}
                  <div className="flex items-center gap-3 p-4 rounded-xl bg-stone-50 border border-stone-100">
                    <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
                      selectedUser.isNewUser ? 'bg-emerald-100' : 'bg-orange-100'
                    }`}>
                      {selectedUser.isNewUser ? (
                        <Star className="w-5 h-5 text-emerald-600" />
                      ) : (
                        <CheckCircle2 className="w-5 h-5 text-orange-600" />
                      )}
                    </div>
                    <div>
                      <p className="font-bold text-stone-800">
                        {selectedUser.isNewUser ? '🆕 新用户' : '老用户'}
                      </p>
                      <p className="text-xs text-stone-500">
                        首次访问: {new Date(selectedUser.firstSeen).toLocaleString()}
                      </p>
                    </div>
                  </div>

                  {/* 用户积分 */}
                  <div>
                    <h3 className="text-sm font-bold text-stone-400 uppercase tracking-wide mb-3 flex items-center gap-2">
                      <Coins className="w-4 h-4" />
                      用户积分
                    </h3>
                    <div className="p-4 bg-gradient-to-r from-amber-50 to-yellow-50 rounded-xl border border-amber-200">
                      {/* 当前余额 */}
                      <div className="flex items-center gap-3 mb-4">
                        <div className="w-12 h-12 rounded-full bg-amber-100 flex items-center justify-center">
                          <span className="text-2xl">⭐</span>
                        </div>
                        <div>
                          <p className="text-xs text-amber-600 font-medium">当前积分</p>
                          {pointsError ? (
                            <p className="text-lg font-bold text-red-500">加载失败</p>
                          ) : userPoints === null ? (
                            <p className="text-3xl font-bold text-amber-400">--</p>
                          ) : (
                            <p className="text-3xl font-bold text-amber-700">{userPoints.toLocaleString()}</p>
                          )}
                        </div>
                      </div>
                      
                      {/* 调整表单 */}
                      <div className="space-y-3 pt-3 border-t border-amber-200">
                        <div className="grid grid-cols-2 gap-3">
                          <input
                            type="number"
                            step={1}
                            value={adjustAmount}
                            onChange={(e) => setAdjustAmount(e.target.value)}
                            placeholder="积分数量 (正/负)"
                            className="px-3 py-2 rounded-lg border border-amber-300 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
                          />
                          <input
                            type="text"
                            value={adjustReason}
                            onChange={(e) => setAdjustReason(e.target.value)}
                            placeholder="调整原因"
                            maxLength={100}
                            className="px-3 py-2 rounded-lg border border-amber-300 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
                          />
                        </div>
                        <button
                          onClick={handleAdjustPoints}
                          disabled={adjusting || !adjustAmount || !adjustReason.trim() || userPoints === null}
                          className="w-full py-2 bg-amber-500 hover:bg-amber-600 disabled:bg-amber-300 text-white font-medium rounded-lg text-sm transition-colors flex items-center justify-center gap-2"
                        >
                          {adjusting ? (
                            <>
                              <Loader2 className="w-4 h-4 animate-spin" />
                              处理中...
                            </>
                          ) : (
                            '提交调整'
                          )}
                        </button>
                      </div>
                    </div>
                    
                    {/* 积分流水 */}
                    {pointsError ? (
                      <div className="mt-3 text-xs text-red-500">积分流水加载失败</div>
                    ) : (
                      <div className="mt-3">
                        <div className="flex items-center justify-between mb-2">
                          <p className="text-xs text-stone-400 font-medium">
                            积分流水（仅展示最近10条）
                          </p>
                          <p className="text-[11px] text-stone-400">
                            共 {userPointsLogs.length} 条（最多保留100条）
                          </p>
                        </div>
                        {userPointsLogs.length === 0 ? (
                          <div className="text-center py-3 text-stone-400 text-xs bg-stone-50 rounded-lg border border-stone-100">
                            暂无积分变动记录
                          </div>
                        ) : (
                          <div className="space-y-2 max-h-48 overflow-y-auto">
                            {userPointsLogs.slice(0, 10).map((log) => (
                              <div
                                key={log.id}
                                className="flex items-start justify-between gap-3 p-2 bg-stone-50 rounded-lg text-xs"
                              >
                                <div className="flex items-center gap-2 min-w-0">
                                  <span className={`font-bold ${log.amount >= 0 ? 'text-green-600' : 'text-red-500'}`}>
                                    {log.amount >= 0 ? '+' : ''}{log.amount}
                                  </span>
                                  <span className="text-stone-500 truncate">{getSourceLabel(log.source)}</span>
                                </div>
                                <div className="text-right shrink-0">
                                  <div className="text-stone-400">{new Date(log.createdAt).toLocaleString()}</div>
                                  <div className="text-stone-500">
                                    余额 {Number.isFinite(log.balance) ? log.balance.toLocaleString() : '--'}
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {/* 兑换码领取记录 */}
                  <div>
                    <h3 className="text-sm font-bold text-stone-400 uppercase tracking-wide mb-3 flex items-center gap-2">
                      <Gift className="w-4 h-4" />
                      兑换码领取记录 ({userClaims.length})
                    </h3>
                    {userClaims.length === 0 ? (
                      <div className="text-center py-6 text-stone-400 text-sm bg-stone-50 rounded-xl border border-stone-100">
                        暂无领取记录
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {userClaims.map((claim) => (
                          <div key={claim.id} className="p-4 bg-orange-50/50 rounded-xl border border-orange-100">
                            <div className="flex justify-between items-start mb-2">
                              <span className="font-bold text-stone-800">{claim.projectName}</span>
                              <span className="text-xs text-stone-400 flex items-center gap-1">
                                <Clock className="w-3 h-3" />
                                {new Date(claim.claimedAt).toLocaleString()}
                              </span>
                            </div>
                            <code className="text-sm bg-white px-2 py-1 rounded border border-orange-200 font-mono text-orange-600">
                              {claim.code}
                            </code>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* 抽奖记录 */}
                  <div>
                    <h3 className="text-sm font-bold text-stone-400 uppercase tracking-wide mb-3 flex items-center gap-2">
                      <Sparkles className="w-4 h-4" />
                      抽奖记录 ({userLotteryRecords.length})
                    </h3>
                    {userLotteryRecords.length === 0 ? (
                      <div className="text-center py-6 text-stone-400 text-sm bg-stone-50 rounded-xl border border-stone-100">
                        暂无抽奖记录
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {userLotteryRecords.map((record, idx) => (
                          <div key={idx} className="p-4 bg-purple-50/50 rounded-xl border border-purple-100">
                            <div className="flex justify-between items-start mb-2">
                              <span className="font-bold text-stone-800">{record.tierName}</span>
                              <span className="text-xs text-stone-400 flex items-center gap-1">
                                <Clock className="w-3 h-3" />
                                {new Date(record.createdAt).toLocaleString()}
                              </span>
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-medium text-purple-600">
                                🎁 ${record.tierValue}
                              </span>
                              {record.directCredit && (
                                <span className="text-xs bg-green-100 text-green-600 px-2 py-0.5 rounded-full">
                                  已直充
                                </span>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
