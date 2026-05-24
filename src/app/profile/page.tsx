'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Album,
  ArrowDownLeft,
  ArrowUpRight,
  CalendarDays,
  Coins,
  Flame,
  Gamepad2,
  Gift,
  Globe,
  HelpCircle,
  ImagePlus,
  Link2,
  Loader2,
  Lock,
  LogOut,
  Mail,
  RefreshCw,
  Settings,
  ShoppingBag,
  Sparkles,
  TrendingUp,
  Trophy,
  Upload,
  UserRound,
  X,
} from 'lucide-react';
import SiteSidebar from '@/components/SiteSidebar';
import type {
  AchievementDef,
  AchievementId,
  ProfileAchievementStats,
  PublicAchievement,
  UserAchievementGrant,
} from '@/lib/profile-achievements';

interface ProfileOverviewData {
  user: {
    id: number;
    username: string;
    customDisplayName: string | null;
    customAvatarUrl: string | null;
    customQqEmail: string | null;
  };
  points: {
    balance: number;
    recentLogs: Array<{
      amount: number;
      source: string;
      description: string;
      createdAt: number;
    }>;
  };
  cards: {
    owned: number;
    total: number;
    fragments: number;
    drawsAvailable: number;
    completionRate: number;
    albums: Array<{
      id: string;
      name: string;
      owned: number;
      total: number;
      completionRate: number;
    }>;
  };
  gameplay: {
    checkinStreak: number;
    totalCheckinDays: number;
    recentRecords: Array<{
      gameType: string;
      score: number;
      pointsEarned: number;
      createdAt: number;
    }>;
  };
  notifications: {
    unreadCount: number;
    recent: Array<{
      id: string;
      title: string;
      content: string;
      type: string;
      createdAt: number;
      isRead: boolean;
    }>;
  };
  achievementStats: ProfileAchievementStats;
  achievements: {
    grants: UserAchievementGrant[];
    equippedId: AchievementId | null;
    equipped: PublicAchievement | null;
    items: AchievementDef[];
  };
}

const ALBUM_COLORS = ['c-green', 'c-purple', 'c-orange', 'c-pink'];

function formatDateTime(timestamp: number): string {
  try {
    return new Date(timestamp).toLocaleString('zh-CN', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
  } catch {
    return '—';
  }
}

// 积分流水来源映射：中文标签、视觉主题（复用 .game-row 的 t-* 颜色）、图标
type LogTheme = 't-lottery' | 't-game' | 't-card' | 't-checkin' | 't-other';

const SOURCE_META: Record<string, { label: string; theme: LogTheme; icon: React.ReactNode }> = {
  game_play: { label: '游戏获得', theme: 't-game', icon: <Gamepad2 /> },
  game_win: { label: '游戏获胜', theme: 't-game', icon: <Gamepad2 /> },
  daily_login: { label: '每日登录', theme: 't-other', icon: <Sparkles /> },
  checkin_bonus: { label: '签到奖励', theme: 't-checkin', icon: <CalendarDays /> },
  exchange: { label: '商店兑换', theme: 't-lottery', icon: <ShoppingBag /> },
  exchange_refund: { label: '兑换退还', theme: 't-checkin', icon: <ShoppingBag /> },
  exchange_withdraw: { label: '提现至额度', theme: 't-lottery', icon: <ArrowUpRight /> },
  exchange_topup: { label: '额度兑换', theme: 't-checkin', icon: <ArrowDownLeft /> },
  admin_adjust: { label: '管理员调整', theme: 't-other', icon: <Settings /> },
  card_collection: { label: '卡牌奖励', theme: 't-card', icon: <Album /> },
  ranking_reward: { label: '排行奖励', theme: 't-card', icon: <Trophy /> },
  reward_claim: { label: '福利领取', theme: 't-lottery', icon: <Gift /> },
  lottery_win: { label: '幸运抽奖', theme: 't-lottery', icon: <Sparkles /> },
  raffle_win: { label: '多人抽奖', theme: 't-lottery', icon: <Trophy /> },
  number_bomb_bet: { label: '数字炸弹下注', theme: 't-lottery', icon: <Flame /> },
  number_bomb_refund: { label: '数字炸弹退还', theme: 't-checkin', icon: <ArrowDownLeft /> },
  number_bomb_reward: { label: '数字炸弹奖励', theme: 't-lottery', icon: <Flame /> },
};

function getSourceMeta(source: string): { label: string; theme: LogTheme; icon: React.ReactNode } {
  return SOURCE_META[source] ?? { label: source || '其他', theme: 't-other', icon: <Coins /> };
}

// 头像最大边长（像素）：用于本地图片压缩
const AVATAR_MAX_DIMENSION = 256;
// 压缩后 dataURL 大小上限（字节，与服务端校验保持一致）
const AVATAR_MAX_DATAURL_SIZE = 80 * 1024;
// 昵称长度上限（与服务端校验保持一致）
const DISPLAY_NAME_MAX = 30;

/**
 * 将 File 压缩为 webp/jpeg dataURL，最长边不超过 AVATAR_MAX_DIMENSION。
 */
async function compressImageToDataUrl(file: File): Promise<string> {
  if (!file.type.startsWith('image/')) {
    throw new Error('请选择图片文件');
  }
  // 读取为 ImageBitmap（更高性能），不可用时降级到 HTMLImageElement
  let width: number;
  let height: number;
  let drawSource: CanvasImageSource;
  if (typeof createImageBitmap === 'function') {
    const bitmap = await createImageBitmap(file);
    width = bitmap.width;
    height = bitmap.height;
    drawSource = bitmap;
  } else {
    const url = URL.createObjectURL(file);
    try {
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const el = new Image();
        el.onload = () => resolve(el);
        el.onerror = () => reject(new Error('图片读取失败'));
        el.src = url;
      });
      width = img.naturalWidth;
      height = img.naturalHeight;
      drawSource = img;
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  const scale = Math.min(1, AVATAR_MAX_DIMENSION / Math.max(width, height));
  const targetWidth = Math.max(1, Math.round(width * scale));
  const targetHeight = Math.max(1, Math.round(height * scale));

  const canvas = document.createElement('canvas');
  canvas.width = targetWidth;
  canvas.height = targetHeight;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('当前浏览器不支持图片处理');
  }
  ctx.drawImage(drawSource, 0, 0, targetWidth, targetHeight);

  // 优先尝试 webp，回退到 jpeg；若过大再阶梯下降画质
  const tryEncode = (mime: string, quality: number): string => canvas.toDataURL(mime, quality);
  const candidates: Array<{ mime: string; quality: number }> = [
    { mime: 'image/webp', quality: 0.85 },
    { mime: 'image/webp', quality: 0.7 },
    { mime: 'image/jpeg', quality: 0.85 },
    { mime: 'image/jpeg', quality: 0.7 },
    { mime: 'image/jpeg', quality: 0.5 },
  ];
  let lastDataUrl = '';
  for (const c of candidates) {
    const dataUrl = tryEncode(c.mime, c.quality);
    lastDataUrl = dataUrl;
    if (dataUrl.length <= AVATAR_MAX_DATAURL_SIZE) {
      return dataUrl;
    }
  }
  // 仍然过大：报错提示用户换更小的图
  if (lastDataUrl.length > AVATAR_MAX_DATAURL_SIZE) {
    throw new Error('图片体积过大，请选择更小或更简单的图片');
  }
  return lastDataUrl;
}

interface ProfileSettingsModalProps {
  currentDisplayName: string | null;
  currentAvatarUrl: string | null;
  currentQqEmail: string | null;
  fallbackUsername: string;
  onClose: () => void;
  onUpdated: (next: { displayName: string | null; avatarUrl: string | null; qqEmail: string | null }) => void;
}

function ProfileSettingsModal({
  currentDisplayName,
  currentAvatarUrl,
  currentQqEmail,
  fallbackUsername,
  onClose,
  onUpdated,
}: ProfileSettingsModalProps) {
  const [displayName, setDisplayName] = useState<string>(currentDisplayName ?? '');
  const [qqEmail, setQqEmail] = useState<string>(currentQqEmail ?? '');
  const [avatarMode, setAvatarMode] = useState<'upload' | 'url'>(
    currentAvatarUrl?.startsWith('http') ? 'url' : 'upload'
  );
  // 当前编辑的头像值；空串表示清空
  const [avatarValue, setAvatarValue] = useState<string>(currentAvatarUrl ?? '');
  const [avatarUrlInput, setAvatarUrlInput] = useState<string>(
    currentAvatarUrl?.startsWith('http') ? currentAvatarUrl : ''
  );
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const previewInitial = ((displayName || fallbackUsername || '?')[0] || '?').toUpperCase();

  const handlePickFile = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    // 重置 input value，便于重复选择同一文件
    event.target.value = '';
    if (!file) return;
    setErrorMsg(null);
    setHint('正在压缩图片...');
    try {
      const dataUrl = await compressImageToDataUrl(file);
      setAvatarValue(dataUrl);
      setAvatarMode('upload');
      setHint('图片已就绪，点击保存生效');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : '图片处理失败');
      setHint(null);
    }
  };

  const handleApplyUrl = () => {
    const trimmed = avatarUrlInput.trim();
    if (!trimmed) {
      setErrorMsg('请输入有效的图床链接');
      return;
    }
    try {
      const url = new URL(trimmed);
      if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        setErrorMsg('图床链接必须以 http:// 或 https:// 开头');
        return;
      }
    } catch {
      setErrorMsg('图床链接格式无效');
      return;
    }
    setErrorMsg(null);
    setAvatarValue(trimmed);
    setAvatarMode('url');
    setHint('链接已就绪，点击保存生效');
  };

  const handleClearAvatar = () => {
    setAvatarValue('');
    setAvatarUrlInput('');
    setHint('将清除头像，使用默认字母头像');
    setErrorMsg(null);
  };

  const handleSubmit = async () => {
    setSubmitting(true);
    setErrorMsg(null);
    try {
      const trimmedName = displayName.trim();
      // 仅提交发生变化的字段
      const payload: Record<string, string | null> = {};
      const desiredName = trimmedName.length === 0 ? null : trimmedName;
      if (desiredName !== (currentDisplayName ?? null)) {
        payload.displayName = desiredName;
      }
      const desiredAvatar = avatarValue.length === 0 ? null : avatarValue;
      if (desiredAvatar !== (currentAvatarUrl ?? null)) {
        payload.avatarUrl = desiredAvatar;
      }
      const desiredQqEmail = qqEmail.trim().length === 0 ? null : qqEmail.trim();
      if (desiredQqEmail !== (currentQqEmail ?? null)) {
        payload.qqEmail = desiredQqEmail;
      }
      if (Object.keys(payload).length === 0) {
        setErrorMsg('未做任何修改');
        setSubmitting(false);
        return;
      }

      const res = await fetch('/api/profile/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        cache: 'no-store',
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.message || '保存失败');
      }
      // 通知页内其它组件（如 SiteSidebar）同步刷新头像/昵称
      if (typeof window !== 'undefined') {
        window.dispatchEvent(
          new CustomEvent('lucky:profile-updated', {
            detail: {
              displayName: json.data?.displayName ?? null,
              avatarUrl: json.data?.avatarUrl ?? null,
            },
          })
        );
      }
      onUpdated({
        displayName: json.data?.displayName ?? null,
        avatarUrl: json.data?.avatarUrl ?? null,
        qqEmail: json.data?.qqEmail ?? null,
      });
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : '保存失败');
      setSubmitting(false);
    }
  };

  return (
    <div className="pf-modal-mask" role="dialog" aria-modal="true" aria-label="编辑个人资料">
      <div className="pf-modal">
        <div className="pf-modal-header">
          <h3>
            <Settings />
            编辑个人资料
          </h3>
          <button type="button" className="pf-modal-close" onClick={onClose} aria-label="关闭">
            <X />
          </button>
        </div>
        <div className="pf-modal-body">
          {/* 头像预览 */}
          <div className="pf-form-row pf-avatar-preview-row">
            <div className="pf-avatar-preview">
              {avatarValue ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={avatarValue} alt="头像预览" />
              ) : (
                previewInitial
              )}
            </div>
            <div className="pf-avatar-tip">
              <p className="pf-form-label">头像预览</p>
              <p className="pf-muted-text">支持本地上传（自动压缩）或粘贴图床链接</p>
              {avatarValue && (
                <button type="button" className="pf-link-btn" onClick={handleClearAvatar}>
                  清除头像
                </button>
              )}
            </div>
          </div>

          {/* 头像选择 Tab */}
          <div className="pf-form-row">
            <p className="pf-form-label">头像来源</p>
            <div className="pf-tabs">
              <button
                type="button"
                className={`pf-tab ${avatarMode === 'upload' ? 'active' : ''}`}
                onClick={() => setAvatarMode('upload')}
              >
                <Upload />
                本地上传
              </button>
              <button
                type="button"
                className={`pf-tab ${avatarMode === 'url' ? 'active' : ''}`}
                onClick={() => setAvatarMode('url')}
              >
                <Link2 />
                图床链接
              </button>
            </div>
            {avatarMode === 'upload' ? (
              <div className="pf-upload-zone">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handleFileChange}
                  style={{ display: 'none' }}
                />
                <button type="button" className="pf-upload-btn" onClick={handlePickFile}>
                  <ImagePlus />
                  选择图片
                </button>
                <p className="pf-muted-text">单张图片，最长边将自动压缩到 256px 以内</p>
              </div>
            ) : (
              <div className="pf-url-zone">
                <input
                  type="url"
                  className="pf-input"
                  value={avatarUrlInput}
                  onChange={(e) => setAvatarUrlInput(e.target.value)}
                  placeholder="https://example.com/avatar.png"
                />
                <button type="button" className="pf-secondary-btn" onClick={handleApplyUrl}>
                  应用链接
                </button>
              </div>
            )}
          </div>

          {/* 昵称 */}
          <div className="pf-form-row">
            <label className="pf-form-label" htmlFor="pf-display-name">
              昵称
            </label>
            <input
              id="pf-display-name"
              type="text"
              className="pf-input"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value.slice(0, DISPLAY_NAME_MAX))}
              placeholder={fallbackUsername}
              maxLength={DISPLAY_NAME_MAX}
            />
            <div className="pf-form-meta">
              <span className="pf-muted-text">留空将使用账号名 {fallbackUsername}</span>
              <span className="pf-muted-text">{displayName.length} / {DISPLAY_NAME_MAX}</span>
            </div>
          </div>

          {/* QQ 邮箱 */}
          <div className="pf-form-row">
            <label className="pf-form-label" htmlFor="pf-qq-email">
              农场提醒 QQ 邮箱
            </label>
            <div className="pf-input-icon-row">
              <Mail />
              <input
                id="pf-qq-email"
                type="email"
                className="pf-input"
                value={qqEmail}
                onChange={(e) => setQqEmail(e.target.value.slice(0, 254))}
                placeholder="123456@qq.com"
                inputMode="email"
                autoComplete="email"
              />
            </div>
            <div className="pf-form-meta">
              <span className="pf-muted-text">填写后，成年宠物在场时作物成熟会发送邮件提醒；留空关闭提醒。</span>
            </div>
          </div>

          {hint && <div className="pf-hint">{hint}</div>}
          {errorMsg && <div className="pf-modal-error">{errorMsg}</div>}
        </div>
        <div className="pf-modal-footer">
          <button
            type="button"
            className="pf-secondary-btn"
            onClick={onClose}
            disabled={submitting}
          >
            取消
          </button>
          <button
            type="button"
            className="pf-primary-btn"
            onClick={handleSubmit}
            disabled={submitting}
          >
            {submitting ? <Loader2 className="pf-btn-spin" /> : <Settings />}
            保存修改
          </button>
        </div>
      </div>
    </div>
  );
}

interface AchievementsHelpModalProps {
  achievements: AchievementDef[];
  onClose: () => void;
}

function AchievementsHelpModal({ achievements, onClose }: AchievementsHelpModalProps) {
  return (
    <div className="pf-modal-mask" role="dialog" aria-modal="true" aria-label="成就获取方法">
      <div className="pf-modal pf-modal-help">
        <div className="pf-modal-header">
          <h3>
            <Trophy />
            成就获取方法
          </h3>
          <button type="button" className="pf-modal-close" onClick={onClose} aria-label="关闭">
            <X />
          </button>
        </div>
        <div className="pf-modal-body">
          <p className="pf-muted-text">
            完成任务、管理员颁发或周期结算后即可解锁对应成就。已解锁成就可在成就墙中点击佩戴。
          </p>
          <ul className="pf-help-list">
            {achievements.map((a) => (
              <li key={a.id} className={`pf-help-item ${a.unlocked ? 'unlocked' : 'locked'}`}>
                <div className="pf-help-emoji">{a.emoji}</div>
                <div className="pf-help-info">
                  <div className="pf-help-name">
                    {a.name}
                    {a.series && <span className="pf-help-badge series">{a.series}</span>}
                    {a.unlocked ? (
                      <span className="pf-help-badge ok">已解锁</span>
                    ) : (
                      <span className="pf-help-badge lock">
                        <Lock />
                        未解锁
                      </span>
                    )}
                  </div>
                  <div className="pf-help-desc">
                    {a.desc}
                    {a.expiresAt ? ` · 有效至 ${formatDateTime(a.expiresAt)}` : ''}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </div>
        <div className="pf-modal-footer">
          <button type="button" className="pf-primary-btn" onClick={onClose}>
            知道了
          </button>
        </div>
      </div>
    </div>
  );
}

export default function ProfilePage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshSpin, setRefreshSpin] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<ProfileOverviewData | null>(null);
  // 设置弹窗：修改昵称、头像
  const [settingsOpen, setSettingsOpen] = useState(false);
  // 成就帮助弹窗
  const [achievementsHelpOpen, setAchievementsHelpOpen] = useState(false);
  const [equipSubmittingId, setEquipSubmittingId] = useState<AchievementId | null>(null);

  const fetchData = async (silent = false) => {
    if (silent) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }
    setError(null);

    try {
      const meRes = await fetch('/api/auth/me', { cache: 'no-store' });
      if (!meRes.ok) {
        router.push('/login?redirect=/profile');
        return;
      }
      const meData = await meRes.json();
      if (!meData.success) {
        router.push('/login?redirect=/profile');
        return;
      }

      const overviewRes = await fetch('/api/profile/overview', { cache: 'no-store' });
      const overviewData = await overviewRes.json();

      if (!overviewRes.ok || !overviewData.success) {
        throw new Error(overviewData.message || '获取个人主页失败');
      }

      setData(overviewData.data as ProfileOverviewData);
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载失败');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    void fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const triggerRefresh = () => {
    if (refreshing) return;
    setRefreshSpin(true);
    void fetchData(true).finally(() => {
      setTimeout(() => setRefreshSpin(false), 600);
    });
  };

  const handleLogout = async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } finally {
      router.push('/login');
    }
  };

  const recentPointsDelta = useMemo(() => {
    const logs = data?.points.recentLogs ?? [];
    return logs.slice(0, 5).reduce((sum, item) => sum + item.amount, 0);
  }, [data]);

  const achievements = useMemo<AchievementDef[]>(
    () => data?.achievements.items ?? [],
    [data]
  );

  const unlockedCount = achievements.filter((a) => a.unlocked).length;
  const equippedAchievement = data?.achievements.equipped ?? null;

  const customDisplayName = data?.user.customDisplayName ?? null;
  const fallbackUsername = data?.user.username ?? 'User';
  const username = customDisplayName ?? fallbackUsername;
  const initial = (username[0] || '?').toUpperCase();
  const customAvatarUrl = data?.user.customAvatarUrl ?? null;
  const customQqEmail = data?.user.customQqEmail ?? null;

  const handleProfileUpdated = (next: { displayName: string | null; avatarUrl: string | null; qqEmail: string | null }) => {
    setData((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        user: {
          ...prev.user,
          customDisplayName: next.displayName,
          customAvatarUrl: next.avatarUrl,
          customQqEmail: next.qqEmail,
        },
      };
    });
  };

  const handleEquipAchievement = async (achievement: AchievementDef) => {
    if (!achievement.unlocked || equipSubmittingId) return;

    setEquipSubmittingId(achievement.id);
    setError(null);
    try {
      const response = await fetch('/api/profile/achievements/equip', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ achievementId: achievement.id }),
        cache: 'no-store',
      });
      const json = await response.json();
      if (!response.ok || !json.success) {
        throw new Error(json.message || '佩戴成就失败');
      }

      const equipped = json.data?.equipped ?? null;
      if (typeof window !== 'undefined') {
        window.dispatchEvent(
          new CustomEvent('lucky:profile-updated', {
            detail: {
              equippedAchievement: equipped,
            },
          })
        );
      }

      setData((prev) => {
        if (!prev) return prev;
        const equippedId = equipped?.id ?? achievement.id;
        return {
          ...prev,
          achievements: {
            ...prev.achievements,
            equippedId,
            equipped,
            items: prev.achievements.items.map((item) => ({
              ...item,
              equipped: item.id === equippedId && item.unlocked,
            })),
          },
        };
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : '佩戴成就失败');
    } finally {
      setEquipSubmittingId(null);
    }
  };

  if (loading) {
    return (
      <div className="lucky-profile-loading">
        <Loader2 className="spin" />
        <style jsx>{`
          .lucky-profile-loading {
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            background: #f8fafc;
          }
          .spin {
            width: 32px;
            height: 32px;
            color: #f97316;
            animation: pf-spin 1s linear infinite;
          }
          @keyframes pf-spin {
            from { transform: rotate(0); }
            to { transform: rotate(360deg); }
          }
        `}</style>
      </div>
    );
  }

  return (
    <div className="lucky-profile">
      <div className="mesh-bg" />

      <div className="layout">
        {/* 左栏 */}
        <SiteSidebar activeNav="profile" />

        {/* 右栏 */}
        <main className="panel-right">
          {/* 顶部页头 */}
          <div className="page-header">
            <div className="header-left">
              <h2 className="section-title">
                <UserRound />
                个人主页
              </h2>
              <p className="header-subtitle">浏览您的账户概览、收藏图鉴与游戏战绩。</p>
            </div>
            <div className="header-actions">
              <button
                type="button"
                className={`btn-icon ${refreshSpin ? 'spinning' : ''}`}
                onClick={triggerRefresh}
                disabled={refreshing}
                aria-label="刷新"
              >
                <RefreshCw />
              </button>
              <button
                type="button"
                className="btn-icon btn-icon-logout"
                onClick={handleLogout}
                aria-label="退出登录"
                title="退出登录"
              >
                <LogOut />
              </button>
            </div>
          </div>

          {error && <div className="pf-error">{error}</div>}

          {/* 个人信息 Hero */}
          <section className="profile-hero">
            <button
              type="button"
              className="ph-settings-btn"
              onClick={() => setSettingsOpen(true)}
              aria-label="编辑个人资料"
            >
              <Settings />
              <span>设置</span>
            </button>
            <div className="ph-row">
              <div className="ph-avatar-box">
                <div className="ph-avatar">
                  {customAvatarUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={customAvatarUrl} alt={username} className="ph-avatar-img" />
                  ) : (
                    initial
                  )}
                </div>
              </div>
              <div className="ph-info">
                <div className="ph-name-row">
                  <h2 className="ph-name">{username}</h2>
                </div>
                <div className="ph-meta">
                  <span>
                    <Globe />
                    ID: <strong>#{String(data?.user.id ?? '').padStart(6, '0')}</strong>
                  </span>
                  <span className={`ph-achievement ${equippedAchievement ? 'active' : ''}`}>
                    <Trophy />
                    {equippedAchievement ? (
                      <strong>{equippedAchievement.emoji} {equippedAchievement.name}</strong>
                    ) : (
                      <strong>未佩戴成就</strong>
                    )}
                  </span>
                </div>
              </div>
            </div>
          </section>

          {/* 4 数据卡片 */}
          <section className="stats-grid">
            <div className="stat-card s-1">
              <div className="stat-icon">
                <Coins />
              </div>
              <div className="stat-label">当前积分</div>
              <div className="stat-value">{(data?.points.balance ?? 0).toLocaleString()}</div>
              <div className={`stat-sub ${recentPointsDelta > 0 ? 'up' : recentPointsDelta < 0 ? 'down' : ''}`}>
                {recentPointsDelta !== 0 && <TrendingUp />}
                近 5 条流水净变动 {recentPointsDelta >= 0 ? '+' : ''}
                {recentPointsDelta}
              </div>
            </div>
            <div className="stat-card s-2">
              <div className="stat-icon">
                <Album />
              </div>
              <div className="stat-label">卡牌收集进度</div>
              <div className="stat-value">
                {data?.cards.owned ?? 0}
                <span className="unit">/ {data?.cards.total ?? 0}</span>
              </div>
              <div className="stat-sub">
                完成率{' '}
                <strong style={{ color: 'var(--c-purple)' }}>
                  {data?.cards.completionRate ?? 0}%
                </strong>
              </div>
            </div>
            <div className="stat-card s-3">
              <div className="stat-icon">
                <Flame />
              </div>
              <div className="stat-label">连续签到</div>
              <div className="stat-value">
                {data?.gameplay.checkinStreak ?? 0}
                <span className="unit">天</span>
              </div>
              <div className="stat-sub">
                累计签到{' '}
                <strong style={{ color: 'var(--c-green)' }}>
                  {data?.gameplay.totalCheckinDays ?? 0} 天
                </strong>
              </div>
            </div>
            <div className="stat-card s-4">
              <div className="stat-icon">
                <Sparkles />
              </div>
              <div className="stat-label">可抽卡次数</div>
              <div className="stat-value">
                {data?.cards.drawsAvailable ?? 0}
                <span className="unit">次</span>
              </div>
              <div className="stat-sub">
                持有碎片{' '}
                <strong style={{ color: 'var(--c-blue)' }}>
                  {data?.cards.fragments ?? 0}
                </strong>
              </div>
            </div>
          </section>

          {/* 双列：图鉴 + 游戏记录 */}
          <section className="two-col">
            <div className="panel-card">
              <div className="panel-card-header">
                <h3 className="panel-card-title t-purple">
                  <span className="icon-box">
                    <Album />
                  </span>
                  图鉴进度
                </h3>
                <Link href="/cards" className="panel-link">
                  查看全部 →
                </Link>
              </div>

              {data?.cards.albums.length ? (
                <div className="album-list">
                  {data.cards.albums.map((album, i) => {
                    const colorCls = ALBUM_COLORS[i % ALBUM_COLORS.length];
                    const pct = Math.min(100, album.completionRate);
                    return (
                      <div key={album.id} className={`album-row ${colorCls}`}>
                        <div className="a-head">
                          <div className="a-name">{album.name}</div>
                          <div className="a-count">
                            <strong>{album.owned}</strong> / {album.total}
                          </div>
                        </div>
                        <div className="a-track">
                          <div className="a-bar" style={{ width: `${pct}%` }} />
                        </div>
                        <div className="a-foot">
                          <span>完成率</span>
                          <span className="a-percent">{pct.toFixed(pct === 100 ? 0 : 1)}%</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="pf-muted">暂无图鉴数据</p>
              )}
            </div>

            <div className="panel-card">
              <div className="panel-card-header">
                <h3 className="panel-card-title t-green">
                  <span className="icon-box">
                    <Coins />
                  </span>
                  积分变动记录
                </h3>
              </div>

              {data?.points.recentLogs.length ? (
                <div className="game-list">
                  {data.points.recentLogs.map((log, idx) => {
                    const meta = getSourceMeta(log.source);
                    const amount = log.amount;
                    const amountCls = amount > 0 ? 'up' : amount < 0 ? 'down' : 'zero';
                    return (
                      <div
                        key={`${log.source}-${log.createdAt}-${idx}`}
                        className={`game-row ${meta.theme}`}
                      >
                        <div className="game-icon">
                          {meta.icon}
                        </div>
                        <div className="game-info">
                          <div className="game-name">{meta.label}</div>
                          <div className="game-time">
                            {log.description ? `${log.description} · ` : ''}
                            {formatDateTime(log.createdAt)}
                          </div>
                        </div>
                        <div className="game-result">
                          <div className={`log-amount ${amountCls}`}>
                            {amount >= 0 ? '+' : ''}
                            {amount.toLocaleString()}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="pf-muted">暂无积分变动</p>
              )}
            </div>
          </section>

          {/* 成就墙 */}
          <section className="panel-card">
            <div className="panel-card-header">
              <h3 className="panel-card-title t-orange">
                <span className="icon-box">
                  <Trophy />
                </span>
                成就墙
                <button
                  type="button"
                  className="achv-help-btn"
                  onClick={() => setAchievementsHelpOpen(true)}
                  aria-label="查看成就获取方法"
                  title="查看成就获取方法"
                >
                  <HelpCircle />
                </button>
              </h3>
              <span className="panel-link">
                {unlockedCount} / {achievements.length} 已解锁
              </span>
            </div>

            <div className="achievements">
              {achievements.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  className={`achv-item ${a.unlocked ? '' : 'locked'} ${a.shine && a.unlocked ? 'shine' : ''} ${a.equipped ? 'equipped' : ''}`}
                  title={`${a.name} · ${a.desc}${a.unlocked ? '（点击佩戴）' : '（未解锁）'}`}
                  disabled={!a.unlocked || equipSubmittingId !== null}
                  onClick={() => void handleEquipAchievement(a)}
                >
                  {a.series && <span className="achv-series">{a.series}</span>}
                  {a.equipped && <span className="achv-equipped">佩戴中</span>}
                  <div className="achv-emoji">{a.emoji}</div>
                  <div className="achv-name">{a.name}</div>
                </button>
              ))}
            </div>
          </section>

        </main>
      </div>

      {/* 设置弹窗 */}
      {settingsOpen && data && (
        <ProfileSettingsModal
          currentDisplayName={customDisplayName}
          currentAvatarUrl={customAvatarUrl}
          currentQqEmail={customQqEmail}
          fallbackUsername={fallbackUsername}
          onClose={() => setSettingsOpen(false)}
          onUpdated={(next) => {
            handleProfileUpdated(next);
            setSettingsOpen(false);
          }}
        />
      )}

      {/* 成就获取方法弹窗 */}
      {achievementsHelpOpen && (
        <AchievementsHelpModal
          achievements={achievements}
          onClose={() => setAchievementsHelpOpen(false)}
        />
      )}

      <style jsx global>{`
        .lucky-profile {
          --text-main: #0f172a;
          --text-light: #64748b;
          --card-bg: rgba(255, 255, 255, 0.65);
          --card-border: rgba(255, 255, 255, 1);
          --card-shadow: 0 24px 48px rgba(15, 23, 42, 0.05);
          --radius-xl: 32px;
          --radius-lg: 24px;
          --c-green: #10b981;
          --c-purple: #8b5cf6;
          --c-orange: #f97316;
          --c-red: #f43f5e;
          --c-blue: #3b82f6;
          --c-pink: #ec4899;
          --c-amber: #fbbf24;
          background-color: #f8fafc;
          color: var(--text-main);
          font-family: 'Outfit', 'Noto Sans SC', sans-serif;
          min-height: 100vh;
          position: relative;
          isolation: isolate;
          -webkit-font-smoothing: antialiased;
          -webkit-tap-highlight-color: transparent;
        }

        .lucky-profile * { box-sizing: border-box; }
        .lucky-profile a { color: inherit; text-decoration: none; }
        .lucky-profile button { font-family: inherit; }

        .lucky-profile .mesh-bg {
          position: fixed;
          inset: 0;
          z-index: -1;
          background-image:
            radial-gradient(circle at 15% 50%, rgba(255, 228, 230, 0.8) 0%, transparent 50%),
            radial-gradient(circle at 85% 30%, rgba(224, 231, 255, 0.8) 0%, transparent 50%),
            radial-gradient(circle at 50% 90%, rgba(254, 243, 199, 0.8) 0%, transparent 50%),
            radial-gradient(circle at 50% 10%, rgba(243, 232, 255, 0.8) 0%, transparent 50%);
          filter: blur(60px);
          animation: pf-fluid 15s infinite alternate ease-in-out;
        }

        @keyframes pf-fluid {
          0% { transform: scale(1) rotate(0deg); }
          50% { transform: scale(1.05) rotate(2deg); }
          100% { transform: scale(1.1) rotate(-2deg); }
        }

        .lucky-profile .layout {
          display: flex;
          min-height: 100vh;
          max-width: 1600px;
          margin: 0 auto;
        }

        /* 左栏 */
        .lucky-profile .panel-left {
          width: 40%;
          padding: 4rem 5rem;
          position: sticky;
          top: 0;
          height: 100vh;
          display: flex;
          flex-direction: column;
          justify-content: space-between;
        }

        .lucky-profile .brand {
          display: flex;
          align-items: center;
          gap: 12px;
          font-size: 24px;
          font-weight: 800;
          letter-spacing: -0.5px;
          color: var(--text-main);
        }

        .lucky-profile .brand-icon {
          width: 40px;
          height: 40px;
          background: linear-gradient(135deg, #ff7a00, #ff004c);
          border-radius: 12px;
          display: flex;
          align-items: center;
          justify-content: center;
          box-shadow: 0 10px 20px rgba(255, 122, 0, 0.3);
        }

        .lucky-profile .brand-icon svg {
          width: 24px;
          height: 24px;
          color: #fff;
          stroke-width: 2.5;
        }

        .lucky-profile .hero-content {
          margin-top: -5vh;
        }

        .lucky-profile .hero-title {
          font-size: 64px;
          font-weight: 800;
          line-height: 1.1;
          letter-spacing: -2px;
          margin: 0 0 24px;
        }

        .lucky-profile .hero-title span {
          background: linear-gradient(135deg, #ff5a00, #ff0080);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          background-clip: text;
        }

        .lucky-profile .nav-list {
          display: flex;
          flex-direction: column;
          gap: 12px;
        }

        .lucky-profile .nav-item {
          display: flex;
          align-items: center;
          gap: 16px;
          padding: 16px 24px;
          background: rgba(255, 255, 255, 0.4);
          border: 1px solid rgba(255, 255, 255, 0.6);
          border-radius: 20px;
          font-size: 16px;
          font-weight: 600;
          color: var(--text-main);
          cursor: pointer;
          transition: all 0.3s ease;
          backdrop-filter: blur(10px);
          width: fit-content;
          min-width: 200px;
        }

        .lucky-profile .nav-item svg { width: 20px; height: 20px; }

        .lucky-profile .nav-item:hover {
          background: rgba(255, 255, 255, 0.9);
          transform: translateX(8px);
          box-shadow: 0 10px 20px rgba(0, 0, 0, 0.03);
          color: var(--c-orange);
        }

        .lucky-profile .user-profile {
          display: flex;
          align-items: center;
          gap: 16px;
          padding: 16px;
          background: linear-gradient(135deg, rgba(255, 122, 0, 0.08), rgba(255, 0, 76, 0.05));
          border: 2px solid rgba(255, 122, 0, 0.2);
          border-radius: 999px;
          box-shadow: 0 16px 40px rgba(255, 122, 0, 0.12);
          width: fit-content;
          cursor: pointer;
          transition: transform 0.2s;
          position: relative;
        }

        .lucky-profile .user-profile::before {
          content: '当前';
          position: absolute;
          top: -8px;
          left: 16px;
          background: linear-gradient(135deg, #ff7a00, #ff004c);
          color: #fff;
          font-size: 10px;
          font-weight: 700;
          padding: 2px 8px;
          border-radius: 999px;
          letter-spacing: 0.5px;
        }

        .lucky-profile .user-profile:hover { transform: scale(1.02); }

        .lucky-profile .avatar {
          width: 48px;
          height: 48px;
          border-radius: 50%;
          background: linear-gradient(135deg, #a8edea 0%, #fed6e3 100%);
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 20px;
          font-weight: 800;
          color: #fff;
          text-transform: uppercase;
        }

        .lucky-profile .user-info h4 {
          font-size: 16px;
          font-weight: 700;
          margin: 0 0 2px;
        }

        .lucky-profile .user-info p {
          font-size: 13px;
          color: var(--text-light);
          margin: 0;
        }

        .lucky-profile .profile-arrow {
          width: 20px;
          height: 20px;
          color: #64748b;
          margin-left: auto;
        }

        /* 右栏 */
        .lucky-profile .panel-right {
          width: 60%;
          padding: 4rem 5rem 4rem 0;
          display: flex;
          flex-direction: column;
          gap: 20px;
        }

        /* 页头 */
        .lucky-profile .page-header {
          display: flex;
          justify-content: space-between;
          align-items: flex-end;
          gap: 16px;
          flex-wrap: wrap;
          margin-bottom: 4px;
        }

        .lucky-profile .header-left .section-title {
          font-size: 24px;
          font-weight: 800;
          display: flex;
          align-items: center;
          gap: 10px;
          color: var(--text-main);
          margin: 0 0 4px;
          letter-spacing: -0.5px;
        }

        .lucky-profile .header-left .section-title svg {
          width: 28px;
          height: 28px;
          color: var(--c-orange);
          stroke-width: 2.5;
        }

        .lucky-profile .header-subtitle {
          font-size: 14px;
          color: var(--text-light);
          margin: 0;
        }

        .lucky-profile .header-actions {
          display: flex;
          gap: 10px;
          align-items: center;
        }

        .lucky-profile .btn-ghost {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          padding: 10px 18px;
          background: rgba(255, 255, 255, 0.7);
          border: 1px solid rgba(255, 255, 255, 0.9);
          border-radius: 999px;
          font-size: 13px;
          font-weight: 600;
          color: var(--text-main);
          cursor: pointer;
          backdrop-filter: blur(10px);
          transition: all 0.2s;
          min-height: 40px;
        }

        .lucky-profile .btn-ghost svg { width: 16px; height: 16px; }

        .lucky-profile .btn-ghost:hover:not(:disabled) {
          background: #fff;
          transform: translateY(-2px);
          box-shadow: 0 8px 16px rgba(0, 0, 0, 0.05);
        }

        .lucky-profile .btn-icon {
          width: 40px;
          height: 40px;
          border-radius: 50%;
          background: rgba(255, 255, 255, 0.7);
          border: 1px solid rgba(255, 255, 255, 0.9);
          display: inline-flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          color: var(--text-light);
          transition: all 0.2s;
        }

        .lucky-profile .btn-icon svg { width: 16px; height: 16px; }

        .lucky-profile .btn-icon:hover:not(:disabled) {
          background: #fff;
          color: var(--text-main);
        }

        .lucky-profile .btn-icon-logout:hover:not(:disabled) {
          background: #fff;
          color: var(--c-red);
          box-shadow: 0 8px 16px rgba(244, 63, 94, 0.18);
        }

        .lucky-profile .btn-icon.spinning svg {
          animation: pf-rotate 0.6s ease;
        }

        @keyframes pf-rotate {
          from { transform: rotate(0); }
          to { transform: rotate(360deg); }
        }

        .lucky-profile .pf-error {
          padding: 12px 16px;
          border-radius: 14px;
          background: rgba(244, 63, 94, 0.08);
          border: 1px solid rgba(244, 63, 94, 0.25);
          color: var(--c-red);
          font-size: 13px;
          font-weight: 600;
        }

        .lucky-profile .pf-muted {
          color: var(--text-light);
          font-size: 13px;
        }

        /* Profile Hero */
        .lucky-profile .profile-hero {
          background: var(--card-bg);
          backdrop-filter: blur(30px);
          -webkit-backdrop-filter: blur(30px);
          border: 1px solid var(--card-border);
          border-radius: var(--radius-xl);
          padding: 32px;
          box-shadow: var(--card-shadow);
          position: relative;
          overflow: hidden;
        }

        .lucky-profile .profile-hero::before {
          content: '';
          position: absolute;
          top: -40%;
          right: -10%;
          width: 360px;
          height: 360px;
          background: radial-gradient(circle, rgba(255, 122, 0, 0.18) 0%, transparent 70%);
          pointer-events: none;
        }

        .lucky-profile .profile-hero::after {
          content: '';
          position: absolute;
          bottom: -50%;
          left: -10%;
          width: 320px;
          height: 320px;
          background: radial-gradient(circle, rgba(139, 92, 246, 0.12) 0%, transparent 70%);
          pointer-events: none;
        }

        .lucky-profile .ph-row {
          display: flex;
          gap: 24px;
          align-items: center;
          position: relative;
          z-index: 1;
          flex-wrap: wrap;
        }

        .lucky-profile .ph-avatar-box {
          position: relative;
          flex-shrink: 0;
        }

        .lucky-profile .ph-avatar {
          width: 96px;
          height: 96px;
          border-radius: 28px;
          background: linear-gradient(135deg, #a8edea 0%, #fed6e3 100%);
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 38px;
          font-weight: 800;
          color: #fff;
          text-transform: uppercase;
          letter-spacing: -1px;
          box-shadow: 0 16px 40px rgba(168, 237, 234, 0.5);
          border: 4px solid #fff;
        }

        .lucky-profile .ph-info {
          flex: 1;
          min-width: 0;
        }

        .lucky-profile .ph-name-row {
          display: flex;
          align-items: center;
          gap: 10px;
          margin-bottom: 4px;
          flex-wrap: wrap;
        }

        .lucky-profile .ph-name {
          font-size: 28px;
          font-weight: 800;
          letter-spacing: -0.8px;
          margin: 0;
        }

        .lucky-profile .ph-meta {
          display: flex;
          gap: 16px;
          color: var(--text-light);
          font-size: 13px;
          font-weight: 500;
          flex-wrap: wrap;
        }

        .lucky-profile .ph-meta span {
          display: inline-flex;
          align-items: center;
          gap: 6px;
        }

        .lucky-profile .ph-meta svg {
          width: 13px;
          height: 13px;
        }

        .lucky-profile .ph-meta strong {
          color: var(--text-main);
          font-weight: 700;
        }

        .lucky-profile .ph-meta .ph-achievement {
          padding: 4px 10px;
          border-radius: 999px;
          background: rgba(15, 23, 42, 0.06);
          border: 1px solid rgba(15, 23, 42, 0.06);
        }

        .lucky-profile .ph-meta .ph-achievement.active {
          color: #9a3412;
          background: rgba(251, 191, 36, 0.18);
          border-color: rgba(251, 191, 36, 0.35);
        }

        /* 4 数据卡片 */
        .lucky-profile .stats-grid {
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          gap: 16px;
        }

        .lucky-profile .stat-card {
          background: var(--card-bg);
          backdrop-filter: blur(30px);
          -webkit-backdrop-filter: blur(30px);
          border: 1px solid var(--card-border);
          border-radius: var(--radius-lg);
          padding: 22px;
          box-shadow: var(--card-shadow);
          transition: all 0.3s ease;
          position: relative;
          overflow: hidden;
        }

        .lucky-profile .stat-card::before {
          content: '';
          position: absolute;
          top: -30%;
          right: -30%;
          width: 100px;
          height: 100px;
          border-radius: 50%;
          opacity: 0;
          transition: opacity 0.3s;
        }

        .lucky-profile .stat-card.s-1::before { background: radial-gradient(circle, rgba(249, 115, 22, 0.3), transparent); }
        .lucky-profile .stat-card.s-2::before { background: radial-gradient(circle, rgba(139, 92, 246, 0.3), transparent); }
        .lucky-profile .stat-card.s-3::before { background: radial-gradient(circle, rgba(16, 185, 129, 0.3), transparent); }
        .lucky-profile .stat-card.s-4::before { background: radial-gradient(circle, rgba(59, 130, 246, 0.3), transparent); }

        .lucky-profile .stat-card:hover {
          transform: translateY(-4px);
          box-shadow: 0 30px 50px rgba(15, 23, 42, 0.08);
        }

        .lucky-profile .stat-card:hover::before { opacity: 1; }

        .lucky-profile .stat-icon {
          width: 42px;
          height: 42px;
          border-radius: 12px;
          display: flex;
          align-items: center;
          justify-content: center;
          background: #fff;
          margin-bottom: 14px;
          position: relative;
          z-index: 1;
        }

        .lucky-profile .stat-icon svg { width: 20px; height: 20px; }

        .lucky-profile .stat-card.s-1 .stat-icon { color: var(--c-orange); box-shadow: 0 10px 20px rgba(249, 115, 22, 0.15); }
        .lucky-profile .stat-card.s-2 .stat-icon { color: var(--c-purple); box-shadow: 0 10px 20px rgba(139, 92, 246, 0.15); }
        .lucky-profile .stat-card.s-3 .stat-icon { color: var(--c-green); box-shadow: 0 10px 20px rgba(16, 185, 129, 0.15); }
        .lucky-profile .stat-card.s-4 .stat-icon { color: var(--c-blue); box-shadow: 0 10px 20px rgba(59, 130, 246, 0.15); }

        .lucky-profile .stat-label {
          font-size: 12px;
          color: var(--text-light);
          font-weight: 600;
          margin-bottom: 4px;
          position: relative;
          z-index: 1;
        }

        .lucky-profile .stat-value {
          font-size: 28px;
          font-weight: 800;
          letter-spacing: -1px;
          line-height: 1.1;
          position: relative;
          z-index: 1;
          margin-bottom: 6px;
        }

        .lucky-profile .stat-value .unit {
          font-size: 13px;
          color: var(--text-light);
          font-weight: 600;
          margin-left: 2px;
        }

        .lucky-profile .stat-sub {
          font-size: 12px;
          color: var(--text-light);
          font-weight: 500;
          position: relative;
          z-index: 1;
          display: flex;
          align-items: center;
          gap: 4px;
        }

        .lucky-profile .stat-sub svg { width: 11px; height: 11px; stroke-width: 2.5; }
        .lucky-profile .stat-sub.up { color: var(--c-green); }
        .lucky-profile .stat-sub.down { color: var(--c-red); }

        /* 通用面板 */
        .lucky-profile .panel-card {
          background: var(--card-bg);
          backdrop-filter: blur(30px);
          -webkit-backdrop-filter: blur(30px);
          border: 1px solid var(--card-border);
          border-radius: var(--radius-xl);
          padding: 28px;
          box-shadow: var(--card-shadow);
        }

        .lucky-profile .panel-card-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 20px;
        }

        .lucky-profile .panel-card-title {
          font-size: 17px;
          font-weight: 800;
          display: flex;
          align-items: center;
          gap: 8px;
          letter-spacing: -0.3px;
          margin: 0;
        }

        .lucky-profile .panel-card-title .icon-box {
          width: 30px;
          height: 30px;
          border-radius: 10px;
          display: flex;
          align-items: center;
          justify-content: center;
          background: rgba(255, 255, 255, 0.6);
        }

        .lucky-profile .panel-card-title .icon-box svg { width: 16px; height: 16px; stroke-width: 2.5; }

        .lucky-profile .panel-card-title.t-purple .icon-box { color: var(--c-purple); box-shadow: 0 6px 12px rgba(139, 92, 246, 0.15); }
        .lucky-profile .panel-card-title.t-green .icon-box { color: var(--c-green); box-shadow: 0 6px 12px rgba(16, 185, 129, 0.15); }
        .lucky-profile .panel-card-title.t-orange .icon-box { color: var(--c-orange); box-shadow: 0 6px 12px rgba(249, 115, 22, 0.15); }

        .lucky-profile .panel-link {
          font-size: 13px;
          color: var(--text-light);
          font-weight: 600;
          text-decoration: none;
          display: inline-flex;
          align-items: center;
          gap: 4px;
          transition: gap 0.2s, color 0.2s;
        }

        .lucky-profile .panel-link:hover {
          color: var(--text-main);
          gap: 8px;
        }

        /* 双列 */
        .lucky-profile .two-col {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 20px;
        }

        .lucky-profile .two-col > .panel-card {
          display: flex;
          flex-direction: column;
          max-height: 480px;
        }

        /* 图鉴 */
        .lucky-profile .album-list {
          display: flex;
          flex-direction: column;
          gap: 18px;
          flex: 1;
          min-height: 0;
          overflow-y: auto;
          padding-right: 4px;
        }

        .lucky-profile .album-list::-webkit-scrollbar { width: 4px; }
        .lucky-profile .album-list::-webkit-scrollbar-thumb { background: rgba(15, 23, 42, 0.1); border-radius: 999px; }

        .lucky-profile .album-row .a-head {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 8px;
        }

        .lucky-profile .album-row .a-name {
          display: flex;
          align-items: center;
          gap: 10px;
          font-size: 14px;
          font-weight: 700;
          color: var(--text-main);
        }

        .lucky-profile .album-row .a-count {
          font-size: 13px;
          color: var(--text-light);
          font-weight: 600;
        }

        .lucky-profile .album-row .a-count strong {
          color: var(--text-main);
          font-weight: 700;
        }

        .lucky-profile .album-row .a-track {
          height: 10px;
          background: rgba(15, 23, 42, 0.05);
          border-radius: 999px;
          overflow: hidden;
          position: relative;
        }

        .lucky-profile .album-row .a-bar {
          height: 100%;
          border-radius: 999px;
          transition: width 0.6s cubic-bezier(0.16, 1, 0.3, 1);
        }

        .lucky-profile .album-row.c-green .a-bar { background: linear-gradient(90deg, #10b981, #34d399); }
        .lucky-profile .album-row.c-purple .a-bar { background: linear-gradient(90deg, #8b5cf6, #c4b5fd); }
        .lucky-profile .album-row.c-orange .a-bar { background: linear-gradient(90deg, #f97316, #fbbf24); }
        .lucky-profile .album-row.c-pink .a-bar { background: linear-gradient(90deg, #ec4899, #f9a8d4); }

        .lucky-profile .album-row .a-foot {
          display: flex;
          justify-content: space-between;
          margin-top: 6px;
          font-size: 11px;
          color: var(--text-light);
        }

        .lucky-profile .album-row .a-percent { font-weight: 700; }

        /* 游戏记录 */
        .lucky-profile .game-list {
          display: flex;
          flex-direction: column;
          gap: 10px;
          flex: 1;
          min-height: 0;
          overflow-y: auto;
          padding-right: 4px;
        }

        .lucky-profile .game-list::-webkit-scrollbar { width: 4px; }
        .lucky-profile .game-list::-webkit-scrollbar-thumb { background: rgba(15, 23, 42, 0.1); border-radius: 999px; }

        .lucky-profile .game-row {
          display: flex;
          align-items: center;
          gap: 14px;
          padding: 14px 16px;
          background: rgba(255, 255, 255, 0.5);
          border: 1px solid rgba(255, 255, 255, 0.8);
          border-radius: 16px;
          transition: all 0.2s ease;
        }

        .lucky-profile .game-row:hover {
          background: #fff;
          transform: translateX(3px);
          box-shadow: 0 8px 16px rgba(15, 23, 42, 0.04);
        }

        .lucky-profile .game-icon {
          width: 38px;
          height: 38px;
          border-radius: 10px;
          display: flex;
          align-items: center;
          justify-content: center;
          background: #fff;
          flex-shrink: 0;
        }

        .lucky-profile .game-icon svg { width: 18px; height: 18px; }

        .lucky-profile .game-row.t-lottery .game-icon { color: var(--c-orange); box-shadow: 0 6px 12px rgba(249, 115, 22, 0.12); }
        .lucky-profile .game-row.t-game .game-icon { color: var(--c-blue); box-shadow: 0 6px 12px rgba(59, 130, 246, 0.12); }
        .lucky-profile .game-row.t-card .game-icon { color: var(--c-purple); box-shadow: 0 6px 12px rgba(139, 92, 246, 0.12); }
        .lucky-profile .game-row.t-checkin .game-icon { color: var(--c-green); box-shadow: 0 6px 12px rgba(16, 185, 129, 0.12); }
        .lucky-profile .game-row.t-other .game-icon { color: var(--text-light); box-shadow: 0 6px 12px rgba(15, 23, 42, 0.08); }

        .lucky-profile .game-info {
          flex: 1;
          min-width: 0;
        }

        .lucky-profile .game-name {
          font-size: 14px;
          font-weight: 700;
          color: var(--text-main);
          margin-bottom: 2px;
        }

        .lucky-profile .game-time {
          font-size: 11.5px;
          color: var(--text-light);
          font-weight: 500;
        }

        .lucky-profile .game-result { text-align: right; flex-shrink: 0; }

        .lucky-profile .log-amount {
          font-size: 18px;
          font-weight: 800;
          line-height: 1;
          letter-spacing: -0.5px;
          color: var(--text-main);
          font-variant-numeric: tabular-nums;
        }

        .lucky-profile .log-amount.up { color: var(--c-green); }
        .lucky-profile .log-amount.down { color: var(--c-red); }
        .lucky-profile .log-amount.zero { color: var(--text-light); }

        /* 成就墙 */
        .lucky-profile .achievements {
          display: grid;
          grid-template-columns: repeat(6, 1fr);
          gap: 12px;
        }

        .lucky-profile .achv-item {
          aspect-ratio: 1;
          border-radius: 16px;
          background: rgba(255, 255, 255, 0.5);
          border: 1px solid rgba(255, 255, 255, 0.8);
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 4px;
          padding: 8px;
          cursor: pointer;
          transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
          position: relative;
          overflow: hidden;
          color: inherit;
        }

        .lucky-profile .achv-item:hover:not(:disabled) {
          transform: translateY(-4px) scale(1.04);
          box-shadow: 0 16px 32px rgba(15, 23, 42, 0.08);
        }

        .lucky-profile .achv-item.locked {
          opacity: 0.4;
          filter: grayscale(0.7);
          cursor: not-allowed;
        }

        .lucky-profile .achv-item.equipped {
          border-color: rgba(251, 191, 36, 0.9);
          background: linear-gradient(180deg, rgba(255, 251, 235, 0.92), rgba(255, 255, 255, 0.72));
          box-shadow: 0 14px 28px rgba(251, 191, 36, 0.18);
        }

        .lucky-profile .achv-series,
        .lucky-profile .achv-equipped {
          position: absolute;
          top: 6px;
          padding: 2px 6px;
          border-radius: 999px;
          font-size: 9px;
          font-weight: 800;
          line-height: 1.1;
          white-space: nowrap;
        }

        .lucky-profile .achv-series {
          left: 6px;
          color: #92400e;
          background: rgba(251, 191, 36, 0.18);
        }

        .lucky-profile .achv-equipped {
          right: 6px;
          color: #fff;
          background: var(--c-orange);
        }

        .lucky-profile .achv-emoji {
          font-size: 26px;
          line-height: 1;
        }

        .lucky-profile .achv-name {
          font-size: 10.5px;
          font-weight: 700;
          color: var(--text-main);
          text-align: center;
          line-height: 1.2;
        }

        .lucky-profile .achv-item.shine::after {
          content: '';
          position: absolute;
          inset: 0;
          background: linear-gradient(120deg, transparent 30%, rgba(255, 255, 255, 0.6) 50%, transparent 70%);
          transform: translateX(-100%);
          animation: pf-shineSweep 2.5s ease-in-out infinite;
        }

        @keyframes pf-shineSweep {
          0%, 60% { transform: translateX(-100%); }
          70%, 100% { transform: translateX(100%); }
        }

        /* 头像图片（替换字母时使用） */
        .lucky-profile .avatar-img,
        .lucky-profile .ph-avatar-img {
          width: 100%;
          height: 100%;
          object-fit: cover;
          border-radius: inherit;
        }

        /* 设置按钮（profile-hero 内） */
        .lucky-profile .ph-settings-btn {
          position: absolute;
          top: 16px;
          right: 16px;
          z-index: 2;
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 8px 14px;
          background: rgba(255, 255, 255, 0.85);
          border: 1px solid rgba(15, 23, 42, 0.06);
          border-radius: 999px;
          font-size: 12.5px;
          font-weight: 700;
          color: var(--text-main);
          cursor: pointer;
          transition: all 0.2s ease;
          box-shadow: 0 6px 18px rgba(15, 23, 42, 0.05);
        }

        .lucky-profile .ph-settings-btn svg { width: 14px; height: 14px; }

        .lucky-profile .ph-settings-btn:hover {
          background: #fff;
          color: var(--c-orange);
          transform: translateY(-1px);
          box-shadow: 0 10px 24px rgba(249, 115, 22, 0.2);
        }

        /* 成就墙提示按钮 */
        .lucky-profile .achv-help-btn {
          width: 24px;
          height: 24px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          margin-left: 4px;
          padding: 0;
          border: 1px solid rgba(249, 115, 22, 0.25);
          background: rgba(249, 115, 22, 0.08);
          color: var(--c-orange);
          border-radius: 50%;
          cursor: pointer;
          transition: all 0.2s ease;
        }

        .lucky-profile .achv-help-btn svg { width: 14px; height: 14px; stroke-width: 2.5; }

        .lucky-profile .achv-help-btn:hover {
          background: var(--c-orange);
          color: #fff;
          transform: scale(1.08);
          box-shadow: 0 6px 14px rgba(249, 115, 22, 0.35);
        }

        /* 通用 Modal */
        .lucky-profile .pf-modal-mask {
          position: fixed;
          inset: 0;
          background: rgba(15, 23, 42, 0.45);
          backdrop-filter: blur(6px);
          -webkit-backdrop-filter: blur(6px);
          z-index: 1000;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 24px;
          animation: pf-fade-in 0.2s ease-out;
        }

        @keyframes pf-fade-in {
          from { opacity: 0; }
          to { opacity: 1; }
        }

        .lucky-profile .pf-modal {
          background: #fff;
          border-radius: 24px;
          width: 100%;
          max-width: 480px;
          max-height: calc(100vh - 48px);
          display: flex;
          flex-direction: column;
          box-shadow: 0 32px 64px rgba(15, 23, 42, 0.2);
          overflow: hidden;
          animation: pf-slide-up 0.25s cubic-bezier(0.16, 1, 0.3, 1);
        }

        .lucky-profile .pf-modal-help {
          max-width: 540px;
        }

        @keyframes pf-slide-up {
          from { transform: translateY(20px); opacity: 0; }
          to { transform: translateY(0); opacity: 1; }
        }

        .lucky-profile .pf-modal-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 20px 24px;
          border-bottom: 1px solid rgba(15, 23, 42, 0.06);
        }

        .lucky-profile .pf-modal-header h3 {
          font-size: 16px;
          font-weight: 800;
          margin: 0;
          display: flex;
          align-items: center;
          gap: 8px;
          letter-spacing: -0.3px;
        }

        .lucky-profile .pf-modal-header h3 svg {
          width: 18px;
          height: 18px;
          color: var(--c-orange);
        }

        .lucky-profile .pf-modal-close {
          width: 32px;
          height: 32px;
          border-radius: 50%;
          border: none;
          background: rgba(15, 23, 42, 0.05);
          color: var(--text-light);
          cursor: pointer;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          transition: all 0.2s;
        }

        .lucky-profile .pf-modal-close svg { width: 16px; height: 16px; }

        .lucky-profile .pf-modal-close:hover {
          background: rgba(244, 63, 94, 0.12);
          color: var(--c-red);
        }

        .lucky-profile .pf-modal-body {
          padding: 22px 24px;
          overflow-y: auto;
          flex: 1;
          min-height: 0;
        }

        .lucky-profile .pf-modal-footer {
          padding: 16px 24px;
          border-top: 1px solid rgba(15, 23, 42, 0.06);
          display: flex;
          justify-content: flex-end;
          gap: 10px;
        }

        .lucky-profile .pf-form-row {
          margin-bottom: 18px;
        }

        .lucky-profile .pf-form-row:last-child { margin-bottom: 0; }

        .lucky-profile .pf-form-label {
          font-size: 13px;
          font-weight: 700;
          color: var(--text-main);
          margin: 0 0 8px;
          display: block;
        }

        .lucky-profile .pf-input {
          width: 100%;
          padding: 10px 14px;
          font-size: 14px;
          background: #f8fafc;
          border: 1px solid rgba(15, 23, 42, 0.08);
          border-radius: 12px;
          color: var(--text-main);
          transition: all 0.2s;
          font-family: inherit;
        }

        .lucky-profile .pf-input:focus {
          outline: none;
          border-color: var(--c-orange);
          background: #fff;
          box-shadow: 0 0 0 3px rgba(249, 115, 22, 0.12);
        }

        .lucky-profile .pf-input-icon-row {
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .lucky-profile .pf-input-icon-row > svg {
          width: 18px;
          height: 18px;
          color: var(--text-light);
          flex-shrink: 0;
        }

        .lucky-profile .pf-input-icon-row .pf-input {
          flex: 1;
          min-width: 0;
        }

        .lucky-profile .pf-form-meta {
          margin-top: 6px;
          display: flex;
          justify-content: space-between;
          gap: 8px;
        }

        .lucky-profile .pf-muted-text {
          font-size: 12px;
          color: var(--text-light);
          margin: 0;
        }

        .lucky-profile .pf-link-btn {
          background: none;
          border: none;
          padding: 0;
          font-size: 12px;
          font-weight: 600;
          color: var(--c-red);
          cursor: pointer;
          margin-top: 4px;
        }

        .lucky-profile .pf-link-btn:hover { text-decoration: underline; }

        .lucky-profile .pf-tabs {
          display: flex;
          gap: 8px;
          margin-bottom: 12px;
        }

        .lucky-profile .pf-tab {
          flex: 1;
          padding: 9px 12px;
          background: #f8fafc;
          border: 1px solid rgba(15, 23, 42, 0.06);
          border-radius: 12px;
          font-size: 13px;
          font-weight: 600;
          color: var(--text-light);
          cursor: pointer;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 6px;
          transition: all 0.2s;
        }

        .lucky-profile .pf-tab svg { width: 14px; height: 14px; }

        .lucky-profile .pf-tab.active {
          background: var(--c-orange);
          color: #fff;
          border-color: var(--c-orange);
          box-shadow: 0 6px 14px rgba(249, 115, 22, 0.25);
        }

        .lucky-profile .pf-upload-zone {
          padding: 16px;
          border: 1.5px dashed rgba(15, 23, 42, 0.1);
          border-radius: 14px;
          background: #f8fafc;
          text-align: center;
        }

        .lucky-profile .pf-upload-btn {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          padding: 9px 18px;
          background: #fff;
          border: 1px solid rgba(15, 23, 42, 0.08);
          border-radius: 999px;
          font-size: 13px;
          font-weight: 700;
          color: var(--text-main);
          cursor: pointer;
          margin-bottom: 8px;
          transition: all 0.2s;
        }

        .lucky-profile .pf-upload-btn:hover {
          border-color: var(--c-orange);
          color: var(--c-orange);
        }

        .lucky-profile .pf-upload-btn svg { width: 14px; height: 14px; }

        .lucky-profile .pf-url-zone {
          display: flex;
          gap: 8px;
          align-items: stretch;
        }

        .lucky-profile .pf-url-zone .pf-input { flex: 1; }

        .lucky-profile .pf-secondary-btn {
          padding: 10px 16px;
          background: #f1f5f9;
          color: var(--text-main);
          border: 1px solid rgba(15, 23, 42, 0.06);
          border-radius: 12px;
          font-size: 13px;
          font-weight: 700;
          cursor: pointer;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 6px;
          transition: all 0.2s;
          white-space: nowrap;
        }

        .lucky-profile .pf-secondary-btn:hover:not(:disabled) {
          background: #e2e8f0;
        }

        .lucky-profile .pf-primary-btn {
          padding: 10px 18px;
          background: linear-gradient(135deg, #ff7a00, #ff004c);
          color: #fff;
          border: none;
          border-radius: 12px;
          font-size: 13px;
          font-weight: 700;
          cursor: pointer;
          display: inline-flex;
          align-items: center;
          gap: 6px;
          transition: all 0.2s;
          box-shadow: 0 8px 18px rgba(255, 122, 0, 0.25);
        }

        .lucky-profile .pf-primary-btn:hover:not(:disabled) {
          transform: translateY(-1px);
          box-shadow: 0 10px 22px rgba(255, 122, 0, 0.32);
        }

        .lucky-profile .pf-primary-btn:disabled,
        .lucky-profile .pf-secondary-btn:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }

        .lucky-profile .pf-primary-btn svg,
        .lucky-profile .pf-secondary-btn svg { width: 14px; height: 14px; }

        .lucky-profile .pf-btn-spin {
          animation: pf-spin 0.8s linear infinite;
        }

        @keyframes pf-spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }

        .lucky-profile .pf-modal-error {
          margin-top: 12px;
          padding: 10px 14px;
          font-size: 12.5px;
          font-weight: 600;
          color: var(--c-red);
          background: rgba(244, 63, 94, 0.08);
          border: 1px solid rgba(244, 63, 94, 0.2);
          border-radius: 12px;
        }

        .lucky-profile .pf-hint {
          margin-top: 12px;
          padding: 10px 14px;
          font-size: 12.5px;
          font-weight: 600;
          color: var(--c-green);
          background: rgba(16, 185, 129, 0.08);
          border: 1px solid rgba(16, 185, 129, 0.2);
          border-radius: 12px;
        }

        .lucky-profile .pf-avatar-preview-row {
          display: flex;
          align-items: center;
          gap: 16px;
        }

        .lucky-profile .pf-avatar-preview {
          width: 84px;
          height: 84px;
          border-radius: 24px;
          background: linear-gradient(135deg, #a8edea 0%, #fed6e3 100%);
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 32px;
          font-weight: 800;
          color: #fff;
          text-transform: uppercase;
          flex-shrink: 0;
          overflow: hidden;
          border: 3px solid #fff;
          box-shadow: 0 8px 24px rgba(168, 237, 234, 0.4);
        }

        .lucky-profile .pf-avatar-preview img {
          width: 100%;
          height: 100%;
          object-fit: cover;
        }

        .lucky-profile .pf-avatar-tip {
          flex: 1;
          min-width: 0;
        }

        .lucky-profile .pf-avatar-tip .pf-form-label {
          margin-bottom: 4px;
        }

        /* 成就帮助列表 */
        .lucky-profile .pf-help-list {
          list-style: none;
          padding: 0;
          margin: 16px 0 0;
          display: flex;
          flex-direction: column;
          gap: 8px;
        }

        .lucky-profile .pf-help-item {
          display: flex;
          align-items: center;
          gap: 14px;
          padding: 12px 14px;
          background: #f8fafc;
          border: 1px solid rgba(15, 23, 42, 0.05);
          border-radius: 14px;
          transition: all 0.2s;
        }

        .lucky-profile .pf-help-item.unlocked {
          background: rgba(16, 185, 129, 0.06);
          border-color: rgba(16, 185, 129, 0.18);
        }

        .lucky-profile .pf-help-item.locked {
          opacity: 0.7;
        }

        .lucky-profile .pf-help-emoji {
          font-size: 26px;
          line-height: 1;
          flex-shrink: 0;
          width: 40px;
          text-align: center;
        }

        .lucky-profile .pf-help-info {
          flex: 1;
          min-width: 0;
        }

        .lucky-profile .pf-help-name {
          font-size: 14px;
          font-weight: 800;
          color: var(--text-main);
          display: flex;
          align-items: center;
          gap: 8px;
          margin-bottom: 2px;
          flex-wrap: wrap;
        }

        .lucky-profile .pf-help-badge {
          display: inline-flex;
          align-items: center;
          gap: 3px;
          padding: 2px 8px;
          font-size: 10.5px;
          font-weight: 700;
          border-radius: 999px;
          letter-spacing: 0.3px;
        }

        .lucky-profile .pf-help-badge.ok {
          background: var(--c-green);
          color: #fff;
        }

        .lucky-profile .pf-help-badge.series {
          background: rgba(251, 191, 36, 0.18);
          color: #92400e;
        }

        .lucky-profile .pf-help-badge.lock {
          background: rgba(15, 23, 42, 0.08);
          color: var(--text-light);
        }

        .lucky-profile .pf-help-badge.lock svg { width: 10px; height: 10px; }

        .lucky-profile .pf-help-desc {
          font-size: 12.5px;
          color: var(--text-light);
          line-height: 1.4;
        }

        /* 响应式 */
        @media (max-width: 1200px) {
          .lucky-profile .hero-title { font-size: 42px; }
          .lucky-profile .panel-left { padding: 3rem; }
          .lucky-profile .panel-right { padding: 3rem 3rem 3rem 0; gap: 18px; }
          .lucky-profile .stats-grid { grid-template-columns: repeat(2, 1fr); }
          .lucky-profile .profile-hero { padding: 24px; }
          .lucky-profile .ph-name { font-size: 24px; }
        }

        @media (max-width: 992px) {
          .lucky-profile .layout {
            flex-direction: column;
            padding-left: env(safe-area-inset-left);
            padding-right: env(safe-area-inset-right);
          }

          .lucky-profile .panel-left {
            width: 100%;
            height: auto;
            position: relative;
            padding: 1.5rem 2rem 0;
            flex-shrink: 0;
            display: flex;
            flex-direction: column;
            align-items: flex-start;
            text-align: left;
            z-index: 10;
            padding-top: max(1.5rem, env(safe-area-inset-top));
          }

          .lucky-profile .brand { font-size: 20px; }
          .lucky-profile .brand-icon { width: 32px; height: 32px; border-radius: 10px; }
          .lucky-profile .brand-icon svg { width: 18px; height: 18px; }

          .lucky-profile .user-profile {
            position: absolute;
            top: max(1.5rem, env(safe-area-inset-top));
            right: 2rem;
            margin: 0;
            padding: 0;
            width: auto;
            background: transparent;
            border: none;
            box-shadow: none;
          }
          .lucky-profile .user-profile::before { display: none; }
          .lucky-profile .user-profile .user-info,
          .lucky-profile .user-profile .profile-arrow { display: none; }
          .lucky-profile .user-profile .avatar {
            width: 40px;
            height: 40px;
            margin: 0;
            border: 2px solid var(--c-orange);
          }

          .lucky-profile .hero-content { margin-top: 1rem; width: 100%; }
          .lucky-profile .hero-title { font-size: 36px; margin-bottom: 16px; }

          .lucky-profile .nav-list {
            flex-direction: row;
            flex-wrap: nowrap;
            overflow-x: auto;
            width: 100%;
            gap: 12px;
            padding-bottom: 16px;
            -webkit-overflow-scrolling: touch;
            scrollbar-width: none;
          }
          .lucky-profile .nav-list::-webkit-scrollbar { display: none; }
          .lucky-profile .nav-item {
            flex: 0 0 auto;
            padding: 10px 16px;
            font-size: 14px;
            min-width: 0;
            min-height: 40px;
          }
          .lucky-profile .nav-item:hover { transform: none; }

          .lucky-profile .panel-right {
            width: 100%;
            padding: 1rem 2rem 4rem;
            padding-bottom: max(4rem, calc(2rem + env(safe-area-inset-bottom)));
            gap: 18px;
          }

          .lucky-profile .two-col { grid-template-columns: 1fr; }
          .lucky-profile .stats-grid { grid-template-columns: repeat(4, 1fr); gap: 12px; }
        }

        @media (max-width: 640px) {
          .lucky-profile .panel-left { padding: 1rem 1.25rem 0; }
          .lucky-profile .brand { font-size: 18px; gap: 10px; }
          .lucky-profile .brand-icon { width: 30px; height: 30px; }
          .lucky-profile .user-profile { right: 1.25rem; }
          .lucky-profile .user-profile .avatar { width: 36px; height: 36px; font-size: 14px; }

          .lucky-profile .hero-content { margin-top: 0.5rem; }
          .lucky-profile .hero-title { font-size: 28px; line-height: 1.2; word-wrap: break-word; margin-bottom: 12px; }

          .lucky-profile .nav-item { padding: 9px 14px; font-size: 13px; }
          .lucky-profile .nav-item svg { width: 16px; height: 16px; }

          .lucky-profile .panel-right {
            padding: 0.875rem 1rem max(3rem, calc(2rem + env(safe-area-inset-bottom)));
            gap: 14px;
          }

          .lucky-profile .page-header { gap: 12px; align-items: flex-start; margin-bottom: 0; }
          .lucky-profile .header-left .section-title { font-size: 21px; gap: 8px; }
          .lucky-profile .header-left .section-title svg { width: 22px; height: 22px; }
          .lucky-profile .header-subtitle { font-size: 13px; }
          .lucky-profile .btn-ghost { padding: 8px 14px; font-size: 12px; min-height: 36px; }
          .lucky-profile .btn-icon { width: 36px; height: 36px; }

          .lucky-profile .profile-hero { padding: 18px; border-radius: 22px; }
          .lucky-profile .ph-row { gap: 16px; flex-direction: column; align-items: stretch; }
          .lucky-profile .ph-avatar-box { align-self: center; }
          .lucky-profile .ph-avatar { width: 80px; height: 80px; border-radius: 24px; font-size: 32px; }
          .lucky-profile .ph-info { text-align: center; }
          .lucky-profile .ph-name-row { justify-content: center; }
          .lucky-profile .ph-name { font-size: 22px; }
          .lucky-profile .ph-meta {
            justify-content: center;
            gap: 8px;
            font-size: 12px;
            flex-wrap: wrap;
          }

          .lucky-profile .stats-grid { grid-template-columns: repeat(2, 1fr); gap: 10px; }
          .lucky-profile .stat-card { padding: 14px; border-radius: 18px; }
          .lucky-profile .stat-icon { width: 36px; height: 36px; margin-bottom: 10px; }
          .lucky-profile .stat-icon svg { width: 18px; height: 18px; }
          .lucky-profile .stat-value { font-size: 22px; }

          .lucky-profile .panel-card { padding: 16px; border-radius: 20px; }
          .lucky-profile .panel-card-header { margin-bottom: 16px; flex-wrap: wrap; gap: 8px; }
          .lucky-profile .panel-card-title { font-size: 15px; }

          .lucky-profile .album-list { gap: 14px; }
          .lucky-profile .album-row .a-name { font-size: 13px; }
          .lucky-profile .album-row .a-count { font-size: 12px; }
          .lucky-profile .album-row .a-track { height: 8px; }

          .lucky-profile .game-row { padding: 12px 14px; gap: 12px; border-radius: 14px; }
          .lucky-profile .game-icon { width: 34px; height: 34px; }
          .lucky-profile .game-icon svg { width: 16px; height: 16px; }
          .lucky-profile .game-name { font-size: 13px; }
          .lucky-profile .game-time { font-size: 11px; }
          .lucky-profile .log-amount { font-size: 16px; }

          .lucky-profile .achievements {
            grid-template-columns: none;
            grid-template-rows: repeat(2, minmax(96px, 1fr));
            grid-auto-flow: column;
            grid-auto-columns: calc((100% - 20px) / 3);
            gap: 10px;
            overflow-x: auto;
            padding: 2px 2px 8px;
            scroll-snap-type: x mandatory;
            -webkit-overflow-scrolling: touch;
            scrollbar-width: none;
          }
          .lucky-profile .achievements::-webkit-scrollbar { display: none; }
          .lucky-profile .achv-item { min-height: 96px; border-radius: 16px; }
          .lucky-profile .achievements .achv-item { scroll-snap-align: start; }
          .lucky-profile .achv-emoji { font-size: 24px; }
          .lucky-profile .achv-name { font-size: 10.5px; }
        }

        @media (max-width: 480px) {
          .lucky-profile .panel-left { padding: 0.875rem 1rem 0; }
          .lucky-profile .panel-right { padding: 0.75rem 0.875rem 2.5rem; }
          .lucky-profile .user-profile { right: 1rem; }

          .lucky-profile .hero-title { font-size: 26px; }
          .lucky-profile .hero-content { margin-top: 0.25rem; }

          .lucky-profile .profile-hero { padding: 16px; border-radius: 20px; }
          .lucky-profile .ph-avatar { width: 72px; height: 72px; font-size: 28px; }
          .lucky-profile .ph-name { font-size: 20px; }

          .lucky-profile .stat-card { padding: 13px; }
          .lucky-profile .stat-value { font-size: 20px; }
          .lucky-profile .achievements {
            grid-template-columns: none;
            grid-auto-columns: calc((100% - 16px) / 3);
            gap: 8px;
          }
          .lucky-profile .panel-card { padding: 14px; border-radius: 18px; }

          .lucky-profile .ph-settings-btn {
            top: 12px;
            right: 12px;
            padding: 6px 10px;
            font-size: 11.5px;
          }

          .lucky-profile .ph-settings-btn svg { width: 12px; height: 12px; }

          .lucky-profile .pf-modal-mask { padding: 12px; }
          .lucky-profile .pf-modal { max-height: calc(100vh - 24px); border-radius: 20px; }
          .lucky-profile .pf-modal-header { padding: 16px 18px; }
          .lucky-profile .pf-modal-body { padding: 18px; }
          .lucky-profile .pf-modal-footer { padding: 12px 18px; }
          .lucky-profile .pf-avatar-preview { width: 72px; height: 72px; font-size: 28px; border-radius: 20px; }
          .lucky-profile .pf-url-zone { flex-direction: column; }
        }
      `}</style>
    </div>
  );
}
