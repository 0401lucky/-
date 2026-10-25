import {
  Activity,
  Gift,
  Layers,
  Megaphone,
  MessageSquareText,
  Package,
  Recycle,
  Send,
  Settings,
  ShoppingBag,
  Sparkles,
  Users,
} from 'lucide-react';

export const ADMIN_NAV_GROUPS = [
  {
    label: '运营管理',
    items: [
      { name: '运营仪表盘', href: '/admin/dashboard', icon: Activity },
      { name: '项目管理', href: '/admin', icon: Package },
      { name: '抽奖管理', href: '/admin/lottery', icon: Sparkles },
      { name: '多人抽奖', href: '/admin/raffle', icon: Gift },
      { name: '奖励发放', href: '/admin/rewards', icon: Send },
    ],
  },
  {
    label: '内容与用户',
    items: [
      { name: '用户管理', href: '/admin/users', icon: Users },
      { name: '反馈管理', href: '/admin/feedback', icon: MessageSquareText },
      { name: '公告管理', href: '/admin/announcements', icon: Megaphone },
    ],
  },
  {
    label: '商城与收藏',
    items: [
      { name: '商品管理', href: '/admin/store', icon: ShoppingBag },
      { name: '卡牌管理', href: '/admin/cards', icon: Layers },
      { name: '环保管理', href: '/admin/eco', icon: Recycle },
    ],
  },
  {
    label: '系统',
    items: [{ name: '系统设置', href: '/admin/settings', icon: Settings }],
  },
];

export function isAdminNavActive(href: string, pathname: string) {
  if (href === '/admin')
    return pathname === '/admin' || pathname.startsWith('/admin/project/');
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function getAdminLocation(pathname: string) {
  for (const group of ADMIN_NAV_GROUPS) {
    const item = group.items.find((candidate) =>
      isAdminNavActive(candidate.href, pathname),
    );
    if (item) return { group: group.label, ...item };
  }
  return { group: '管理后台', name: '管理后台', href: '/admin' };
}
