'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft, Loader2, Search, Users,
  LogOut, User as UserIcon, X,
  ChevronRight, RefreshCw, CreditCard, LayoutGrid, Layers,
  BookOpen, Save, Edit2, Star
} from 'lucide-react';
import { CARDS } from '@/lib/cards/config';

interface UserWithCardStats {
  id: number;
  username: string;
  firstSeen: number;
  cardCount: number;
  fragments: number;
  drawsAvailable: number;
  pityCounter: number;
}

interface UserCardData {
  inventory: string[];
  fragments: number;
  pityCounter: number;
  drawsAvailable: number;
  collectionRewards: string[];
}

interface UserData {
  id: number;
  username: string;
  displayName: string;
  isAdmin: boolean;
}

interface AlbumData {
  id: string;
  name: string;
  description: string;
  season?: string;
  defaultReward: number;
  currentReward: number;
}

interface TierData {
  id: string;
  name: string;
  defaultReward: number;
  currentReward: number;
}

export default function AdminCardsPage() {
  const [users, setUsers] = useState<UserWithCardStats[]>([]);
  const [user, setUser] = useState<UserData | null>(null);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  
  // 分页状态
  const [page, setPage] = useState(1);
  const [totalUsers, setTotalUsers] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  
  // 详情模态框
  const [selectedUser, setSelectedUser] = useState<UserWithCardStats | null>(null);
  const [detailData, setDetailData] = useState<UserCardData | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [resetting, setResetting] = useState(false);

  // 卡册管理
  const [albums, setAlbums] = useState<AlbumData[]>([]);
  const [tiers, setTiers] = useState<TierData[]>([]);
  const [editingAlbum, setEditingAlbum] = useState<string | null>(null);
  const [editingTier, setEditingTier] = useState<string | null>(null);
  const [editReward, setEditReward] = useState<number>(0);
  const [savingReward, setSavingReward] = useState(false);
  const [activeTab, setActiveTab] = useState<'users' | 'albums'>('users');

  const router = useRouter();

  const fetchData = useCallback(async (
    { resetPage = true, search = '' }: { resetPage?: boolean; search?: string } = {}
  ) => {
    try {
      const userRes = await fetch('/api/auth/me');
      if (!userRes.ok) {
        router.push('/login?redirect=/admin/cards');
        return;
      }
      const userData = await userRes.json();
      if (!userData.success || !userData.user?.isAdmin) {
        router.push('/');
        return;
      }
      setUser(userData.user);

      if (resetPage) {
        setPage(1);
        setUsers([]);
      }
      
      const trimmedSearch = search.trim();
      const searchParam = trimmedSearch ? `&search=${encodeURIComponent(trimmedSearch)}` : '';
      const usersRes = await fetch(`/api/admin/cards/users?page=1&limit=50${searchParam}`);
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

  const fetchAlbums = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/cards/albums');
      if (res.ok) {
        const data = await res.json();
        if (data.success) {
          setAlbums(data.albums);
          setTiers(data.tiers || []);
        }
      }
    } catch (error) {
      console.error('Fetch albums error:', error);
    }
  }, []);

  useEffect(() => {
    void fetchData({ resetPage: true, search: '' });
    void fetchAlbums();
  }, [fetchData, fetchAlbums]);

  const loadMoreUsers = async () => {
    if (loadingMore || !hasMore) return;
    
    setLoadingMore(true);
    try {
      const nextPage = page + 1;
      const searchParam = searchQuery.trim() ? `&search=${encodeURIComponent(searchQuery.trim())}` : '';
      const res = await fetch(`/api/admin/cards/users?page=${nextPage}&limit=50${searchParam}`);
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

  const handleUserClick = async (u: UserWithCardStats) => {
    setSelectedUser(u);
    setLoadingDetail(true);
    setDetailData(null);
    try {
      const res = await fetch(`/api/admin/cards/user/${u.id}`);
      if (res.ok) {
        const data = await res.json();
        if (data.success) {
          setDetailData(data.data);
        }
      }
    } catch (error) {
      console.error('Fetch detail error:', error);
    } finally {
      setLoadingDetail(false);
    }
  };

  const handleResetProgress = async () => {
    if (!selectedUser || !confirm(`确定要重置用户 "${selectedUser.username}" 的所有卡牌进度吗？\n此操作不可恢复！\n\n将清空：\n- 所有卡牌库存\n- 所有碎片\n- 抽卡次数重置为 10\n- 保底计数器清零`)) return;

    setResetting(true);
    try {
      const res = await fetch('/api/admin/cards/reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: selectedUser.id })
      });
      const data = await res.json();
      if (data.success) {
        alert('重置成功');
        setSelectedUser(null);
        fetchData({ resetPage: true, search: searchQuery }); // 刷新列表
      } else {
        alert(data.message || '重置失败');
      }
    } catch (error) {
      console.error('Reset error:', error);
      alert('重置失败');
    } finally {
      setResetting(false);
    }
  };

  const handleLogout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.push('/');
  };

  const handleSaveReward = async (albumId?: string, tierId?: string) => {
    setSavingReward(true);
    try {
      const body = tierId
        ? { tierId, reward: editReward }
        : { albumId, reward: editReward };
      const res = await fetch('/api/admin/cards/albums', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      const data = await res.json();
      if (data.success) {
        setEditingAlbum(null);
        setEditingTier(null);
        fetchAlbums();
        alert('奖励更新成功');
      } else {
        alert(data.message || '更新失败');
      }
    } catch (error) {
      console.error('Save reward error:', error);
      alert('更新失败');
    } finally {
      setSavingReward(false);
    }
  };

  const startEditReward = (album: AlbumData) => {
    setEditingAlbum(album.id);
    setEditingTier(null);
    setEditReward(album.currentReward);
  };

  const startEditTierReward = (tier: TierData) => {
    setEditingTier(tier.id);
    setEditingAlbum(null);
    setEditReward(tier.currentReward);
  };

  // Helper to get card name from ID
  const getCardName = (id: string) => {
    const card = CARDS.find(c => c.id === id);
    return card ? card.name : id;
  };
  
  const getCardRarity = (id: string) => {
    const card = CARDS.find(c => c.id === id);
    return card ? card.rarity : 'common';
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#fafaf9]">
        <div className="text-center text-orange-500">
          <Loader2 className="w-10 h-10 animate-spin mx-auto" />
          <p className="mt-4 text-sm font-medium text-stone-500">加载数据...</p>
        </div>
      </div>
    );
  }

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
                <div className="w-8 h-8 rounded-lg bg-indigo-100 flex items-center justify-center">
                  <CreditCard className="w-4 h-4 text-indigo-600" />
                </div>
                <span className="text-lg font-bold text-stone-800 tracking-tight">卡牌管理</span>
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
        {/* 标签页切换 */}
        <div className="flex gap-2 mb-6">
          <button
            onClick={() => setActiveTab('users')}
            className={`px-4 py-2 rounded-lg font-bold text-sm transition-all ${
              activeTab === 'users'
                ? 'bg-indigo-500 text-white'
                : 'bg-white text-stone-600 border border-stone-200 hover:bg-stone-50'
            }`}
          >
            <Users className="w-4 h-4 inline mr-2" />
            用户管理
          </button>
          <button
            onClick={() => setActiveTab('albums')}
            className={`px-4 py-2 rounded-lg font-bold text-sm transition-all ${
              activeTab === 'albums'
                ? 'bg-indigo-500 text-white'
                : 'bg-white text-stone-600 border border-stone-200 hover:bg-stone-50'
            }`}
          >
            <BookOpen className="w-4 h-4 inline mr-2" />
            卡册奖励
          </button>
        </div>

        {activeTab === 'users' && (
          <>
        {/* 搜索 */}
        <div className="flex flex-col sm:flex-row gap-4 mb-6">
          <div className="relative flex-1">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-stone-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="搜索用户名或ID..."
              className="w-full pl-12 pr-4 py-3 bg-white border border-stone-200 rounded-xl focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100 transition-all outline-none text-stone-800 placeholder-stone-400 font-medium"
            />
          </div>
        </div>

        {/* 用户列表 */}
        <div className="bg-white/95 rounded-3xl shadow-sm overflow-hidden border border-stone-200/60">
          {users.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-24 px-4">
              <div className="w-16 h-16 bg-stone-100 rounded-full flex items-center justify-center mb-4">
                <Users className="w-8 h-8 text-stone-400" />
              </div>
              <h2 className="text-lg font-bold text-stone-700 mb-1">暂无用户</h2>
              <p className="text-stone-500 text-sm">
                {searchQuery ? '未找到匹配的用户' : '还没有用户'}
              </p>
            </div>
          ) : (
            <div>
              {/* Desktop Table Header */}
              <div className="hidden lg:grid grid-cols-[2fr_1fr_1fr_1fr_1fr_80px] px-8 py-4 bg-stone-50/80 border-b border-stone-200/60 text-xs font-bold text-stone-400 uppercase tracking-wider">
                <div className="pl-2">用户</div>
                <div>卡牌数</div>
                <div>碎片</div>
                <div>剩余抽数</div>
                <div>保底计数</div>
                <div className="text-right pr-2">操作</div>
              </div>
              
              <div className="divide-y divide-stone-100" style={{ transform: 'translateZ(0)' }}>
                {users.map((u) => (
                  <div
                    key={u.id}
                    onClick={() => handleUserClick(u)}
                    className="group cursor-pointer hover:bg-stone-50/80 transition-colors"
                  >
                    {/* Desktop View */}
                    <div className="hidden lg:grid grid-cols-[2fr_1fr_1fr_1fr_1fr_80px] px-8 py-5 items-center gap-4">
                      {/* User */}
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-50 to-stone-100 flex items-center justify-center border border-stone-200 group-hover:border-indigo-200">
                          <UserIcon className="w-5 h-5 text-indigo-500" />
                        </div>
                        <div>
                          <span className="font-bold text-stone-700 text-[15px] group-hover:text-indigo-600">{u.username}</span>
                          <p className="text-xs text-stone-400">ID: {u.id}</p>
                        </div>
                      </div>

                      {/* Card Count */}
                      <div className="flex items-center gap-2">
                        <CreditCard className="w-4 h-4 text-blue-400" />
                        <span className="text-sm font-semibold text-stone-600">{u.cardCount} 张</span>
                      </div>

                      {/* Fragments */}
                      <div className="flex items-center gap-2">
                        <Layers className="w-4 h-4 text-purple-400" />
                        <span className="text-sm font-semibold text-stone-600">{u.fragments}</span>
                      </div>

                      {/* Draws */}
                      <div className="flex items-center gap-2">
                        <RefreshCw className="w-4 h-4 text-green-400" />
                        <span className="text-sm font-semibold text-stone-600">{u.drawsAvailable}</span>
                      </div>

                      {/* Pity */}
                      <span className="text-sm text-stone-500 font-mono bg-stone-100 px-2 py-1 rounded-md text-center inline-block w-fit">
                        {u.pityCounter} / 200
                      </span>

                      {/* Actions */}
                      <div className="flex justify-end">
                        <div className="w-8 h-8 rounded-lg bg-stone-50 text-stone-400 flex items-center justify-center border border-stone-100 group-hover:bg-white group-hover:border-indigo-200 group-hover:text-indigo-500">
                          <ChevronRight className="w-4 h-4" />
                        </div>
                      </div>
                    </div>

                    {/* Mobile Card View */}
                    <div className="lg:hidden p-5 flex flex-col gap-4">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-indigo-50 flex items-center justify-center border border-indigo-100">
                          <UserIcon className="w-5 h-5 text-indigo-500" />
                        </div>
                        <div>
                          <h3 className="font-bold text-stone-800 text-base">{u.username}</h3>
                          <p className="text-xs text-stone-400">ID: {u.id}</p>
                        </div>
                      </div>
                      
                      <div className="bg-stone-50/50 rounded-xl p-4 border border-stone-100 grid grid-cols-4 gap-2">
                        <div className="text-center">
                          <p className="text-xs text-stone-500 mb-1">卡牌</p>
                          <p className="font-bold text-stone-800">{u.cardCount}</p>
                        </div>
                        <div className="text-center border-l border-stone-200">
                          <p className="text-xs text-stone-500 mb-1">碎片</p>
                          <p className="font-bold text-stone-800">{u.fragments}</p>
                        </div>
                        <div className="text-center border-l border-stone-200">
                          <p className="text-xs text-stone-500 mb-1">次数</p>
                          <p className="font-bold text-stone-800">{u.drawsAvailable}</p>
                        </div>
                        <div className="text-center border-l border-stone-200">
                          <p className="text-xs text-stone-500 mb-1">保底</p>
                          <p className="font-bold text-stone-800">{u.pityCounter}</p>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              
              {/* 加载更多 */}
              {hasMore && (
                <div className="p-4 text-center border-t border-stone-100">
                  <button
                    onClick={loadMoreUsers}
                    disabled={loadingMore}
                    className="px-6 py-2 bg-indigo-500 text-white rounded-lg font-bold text-sm hover:bg-indigo-600 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
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
            </div>
          )}
        </div>
          </>
        )}

        {/* 卡册奖励管理 */}
        {activeTab === 'albums' && (
          <>
            <div className="bg-white/95 rounded-3xl shadow-sm overflow-hidden border border-stone-200/60">
            <div className="px-8 py-4 bg-stone-50/80 border-b border-stone-200/60">
              <h2 className="text-sm font-bold text-stone-500 uppercase tracking-wider">卡册奖励设置</h2>
              <p className="text-xs text-stone-400 mt-1">修改各卡册集齐全套后的奖励积分</p>
            </div>
            <div className="divide-y divide-stone-100">
              {albums.map((album) => (
                <div key={album.id} className="px-8 py-5 flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 rounded-xl bg-indigo-50 flex items-center justify-center border border-indigo-100">
                      <BookOpen className="w-6 h-6 text-indigo-500" />
                    </div>
                    <div>
                      <h3 className="font-bold text-stone-700">{album.name}</h3>
                      <p className="text-xs text-stone-400">{album.season} · {album.description}</p>
                    </div>
                  </div>

                  <div className="flex items-center gap-4">
                    {editingAlbum === album.id ? (
                      <div className="flex items-center gap-2">
                        <input
                          type="number"
                          value={editReward}
                          onChange={(e) => setEditReward(Number(e.target.value))}
                          className="w-28 px-3 py-2 border border-stone-200 rounded-lg text-right font-bold text-stone-700 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 outline-none"
                          min={0}
                        />
                        <button
                          onClick={() => handleSaveReward(album.id)}
                          disabled={savingReward}
                          className="p-2 bg-green-500 text-white rounded-lg hover:bg-green-600 disabled:opacity-50"
                        >
                          <Save className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => setEditingAlbum(null)}
                          className="p-2 bg-stone-100 text-stone-500 rounded-lg hover:bg-stone-200"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-3">
                        <div className="text-right">
                          <p className="text-xs text-stone-400">全套奖励</p>
                          <p className="text-lg font-bold text-amber-600">{album.currentReward.toLocaleString()} 积分</p>
                          {album.currentReward !== album.defaultReward && (
                            <p className="text-xs text-stone-400">默认: {album.defaultReward.toLocaleString()}</p>
                          )}
                        </div>
                        <button
                          onClick={() => startEditReward(album)}
                          className="p-2 bg-stone-100 text-stone-500 rounded-lg hover:bg-indigo-50 hover:text-indigo-500 transition-colors"
                        >
                          <Edit2 className="w-4 h-4" />
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* 稀有度奖励设置 */}
          <div className="bg-white/95 rounded-3xl shadow-sm overflow-hidden border border-stone-200/60 mt-6">
            <div className="px-8 py-4 bg-purple-50/80 border-b border-purple-200/60">
              <h2 className="text-sm font-bold text-purple-500 uppercase tracking-wider">稀有度奖励设置</h2>
              <p className="text-xs text-purple-400 mt-1">修改集齐各稀有度卡牌后的奖励积分（全局生效）</p>
            </div>
            <div className="divide-y divide-stone-100">
              {tiers.map((tier) => (
                <div key={tier.id} className="px-8 py-4 flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <div className={`w-10 h-10 rounded-lg flex items-center justify-center border ${
                      tier.id === 'legendary_rare' ? 'bg-pink-50 border-pink-200' :
                      tier.id === 'legendary' ? 'bg-amber-50 border-amber-200' :
                      tier.id === 'epic' ? 'bg-purple-50 border-purple-200' :
                      tier.id === 'rare' ? 'bg-blue-50 border-blue-200' :
                      'bg-stone-50 border-stone-200'
                    }`}>
                      <Star className={`w-5 h-5 ${
                        tier.id === 'legendary_rare' ? 'text-pink-500' :
                        tier.id === 'legendary' ? 'text-amber-500' :
                        tier.id === 'epic' ? 'text-purple-500' :
                        tier.id === 'rare' ? 'text-blue-500' :
                        'text-stone-400'
                      }`} />
                    </div>
                    <span className="font-bold text-stone-700">{tier.name}</span>
                  </div>
                  <div className="flex items-center gap-4">
                    {editingTier === tier.id ? (
                      <div className="flex items-center gap-2">
                        <input
                          type="number"
                          value={editReward}
                          onChange={(e) => setEditReward(Number(e.target.value))}
                          className="w-24 px-3 py-2 border border-stone-200 rounded-lg text-right font-bold text-stone-700 focus:border-purple-500 focus:ring-2 focus:ring-purple-100 outline-none"
                          min={0}
                        />
                        <button
                          onClick={() => handleSaveReward(undefined, tier.id)}
                          disabled={savingReward}
                          className="p-2 bg-green-500 text-white rounded-lg hover:bg-green-600 disabled:opacity-50"
                        >
                          <Save className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => setEditingTier(null)}
                          className="p-2 bg-stone-100 text-stone-500 rounded-lg hover:bg-stone-200"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-3">
                        <div className="text-right">
                          <p className="text-lg font-bold text-purple-600">{tier.currentReward.toLocaleString()} 积分</p>
                          {tier.currentReward !== tier.defaultReward && (
                            <p className="text-xs text-stone-400">默认: {tier.defaultReward.toLocaleString()}</p>
                          )}
                        </div>
                        <button
                          onClick={() => startEditTierReward(tier)}
                          className="p-2 bg-stone-100 text-stone-500 rounded-lg hover:bg-purple-50 hover:text-purple-500 transition-colors"
                        >
                          <Edit2 className="w-4 h-4" />
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
          </>
        )}
      </main>

      {/* 详情模态框 */}
      {selectedUser && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 sm:p-6">
          <div
            className="absolute inset-0 bg-stone-900/30 backdrop-blur-sm"
            onClick={() => setSelectedUser(null)}
          />
          
          <div className="relative w-full max-w-2xl bg-white rounded-3xl shadow-2xl overflow-hidden animate-fade-in ring-1 ring-black/5 max-h-[85vh] flex flex-col">
            {/* Header */}
            <div className="px-6 py-4 border-b border-stone-100 flex justify-between items-center bg-stone-50/50 shrink-0">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-indigo-50 flex items-center justify-center border border-indigo-100">
                  <UserIcon className="w-5 h-5 text-indigo-500" />
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
              ) : detailData ? (
                <div className="space-y-6">
                  {/* Stats Grid */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <div className="p-3 bg-blue-50 rounded-xl border border-blue-100 text-center">
                      <p className="text-xs text-blue-500 mb-1">收集进度</p>
                      <p className="text-lg font-bold text-blue-700">{detailData.inventory.length} / {CARDS.length}</p>
                    </div>
                    <div className="p-3 bg-purple-50 rounded-xl border border-purple-100 text-center">
                      <p className="text-xs text-purple-500 mb-1">碎片数量</p>
                      <p className="text-lg font-bold text-purple-700">{detailData.fragments}</p>
                    </div>
                    <div className="p-3 bg-green-50 rounded-xl border border-green-100 text-center">
                      <p className="text-xs text-green-500 mb-1">剩余次数</p>
                      <p className="text-lg font-bold text-green-700">{detailData.drawsAvailable}</p>
                    </div>
                    <div className="p-3 bg-amber-50 rounded-xl border border-amber-100 text-center">
                      <p className="text-xs text-amber-500 mb-1">保底计数</p>
                      <p className="text-lg font-bold text-amber-700">{detailData.pityCounter}</p>
                    </div>
                  </div>

                  {/* Inventory Grid */}
                  <div>
                    <h3 className="text-sm font-bold text-stone-500 uppercase tracking-wide mb-3 flex items-center gap-2">
                      <LayoutGrid className="w-4 h-4" />
                      卡牌库存 ({detailData.inventory.length})
                    </h3>
                    
                    {detailData.inventory.length === 0 ? (
                      <div className="text-center py-8 bg-stone-50 rounded-xl border border-stone-100 text-stone-400 text-sm">
                        该用户暂无卡牌
                      </div>
                    ) : (
                      <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-2">
                        {detailData.inventory.map((cardId, idx) => {
                           const rarity = getCardRarity(cardId);
                           const colorMap = {
                             common: 'bg-stone-100 text-stone-600 border-stone-200',
                             rare: 'bg-blue-50 text-blue-600 border-blue-200',
                             epic: 'bg-purple-50 text-purple-600 border-purple-200',
                             legendary: 'bg-orange-50 text-orange-600 border-orange-200',
                             legendary_rare: 'bg-rose-50 text-rose-600 border-rose-200',
                           };
                           return (
                             <div key={`${cardId}-${idx}`} className={`p-2 rounded-lg border text-center ${colorMap[rarity]} text-xs font-medium`}>
                               {getCardName(cardId)}
                             </div>
                           );
                        })}
                      </div>
                    )}
                  </div>
                  
                  {/* Danger Zone */}
                  <div className="pt-6 border-t border-stone-100">
                    <h3 className="text-sm font-bold text-red-500 uppercase tracking-wide mb-3 flex items-center gap-2">
                      危险区域
                    </h3>
                    <div className="p-4 bg-red-50 rounded-xl border border-red-100 flex items-center justify-between">
                      <div>
                        <p className="font-bold text-red-700 text-sm">重置用户进度</p>
                        <p className="text-xs text-red-500 mt-1">清空所有卡牌、碎片、保底，重置次数为10</p>
                      </div>
                      <button
                        onClick={handleResetProgress}
                        disabled={resetting}
                        className="px-4 py-2 bg-white text-red-600 border border-red-200 hover:bg-red-50 hover:border-red-300 rounded-lg text-sm font-bold transition-colors disabled:opacity-50"
                      >
                         {resetting ? '处理中...' : '重置进度'}
                      </button>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="text-center py-12 text-stone-400">无法加载数据</div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
