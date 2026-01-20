'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { 
  ArrowLeft, Loader2, Search, Users, 
  LayoutDashboard, LogOut, User as UserIcon, X, 
  ChevronRight, Gift, Sparkles, Clock, CheckCircle2, Star
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
  lotteryId: string;
  lotteryName: string;
  prizeId: string;
  prizeName: string;
  wonAt: number;
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
  
  // 用户详情模态框
  const [selectedUser, setSelectedUser] = useState<UserWithStats | null>(null);
  const [userClaims, setUserClaims] = useState<ClaimRecord[]>([]);
  const [userLotteryRecords, setUserLotteryRecords] = useState<LotteryRecord[]>([]);
  const [loadingDetail, setLoadingDetail] = useState(false);
  
  const router = useRouter();

  useEffect(() => {
    fetchData();
  }, []);

  useEffect(() => {
    let result = users;
    
    // 搜索过滤
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      result = result.filter(u => 
        u.username.toLowerCase().includes(query) ||
        u.id.toString().includes(query)
      );
    }
    
    // 类型过滤
    if (filterType === 'new') {
      result = result.filter(u => u.isNewUser);
    } else if (filterType === 'claimed') {
      result = result.filter(u => !u.isNewUser);
    }
    
    setFilteredUsers(result);
  }, [users, searchQuery, filterType]);

  const fetchData = async () => {
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

      const usersRes = await fetch('/api/admin/users');
      if (usersRes.ok) {
        const data = await usersRes.json();
        if (data.success) {
          setUsers(data.users);
          setFilteredUsers(data.users);
        }
      }
    } catch (error) {
      console.error('Fetch error:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleUserClick = async (u: UserWithStats) => {
    setSelectedUser(u);
    setLoadingDetail(true);
    
    try {
      const res = await fetch(`/api/admin/users/${u.id}`);
      if (res.ok) {
        const data = await res.json();
        if (data.success) {
          setUserClaims(data.claims || []);
          setUserLotteryRecords(data.lotteryRecords || []);
        }
      }
    } catch (error) {
      console.error('Fetch user detail error:', error);
    } finally {
      setLoadingDetail(false);
    }
  };

  const handleLogout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.push('/');
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
                              <span className="font-bold text-stone-800">{record.lotteryName}</span>
                              <span className="text-xs text-stone-400 flex items-center gap-1">
                                <Clock className="w-3 h-3" />
                                {new Date(record.wonAt).toLocaleString()}
                              </span>
                            </div>
                            <span className="text-sm font-medium text-purple-600">
                              🎁 {record.prizeName}
                            </span>
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
