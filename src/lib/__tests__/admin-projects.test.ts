import { describe, expect, it } from 'vitest';
import {
  getProjectProgress,
  getProjectRemaining,
  getProjectRewardKind,
  selectAdminProjects,
  type AdminProject,
} from '@/lib/admin/projects';

function project(overrides: Partial<AdminProject> = {}): AdminProject {
  return {
    id: 'one',
    name: '周末福利',
    description: '新活动',
    maxClaims: 100,
    claimedCount: 20,
    codesCount: 100,
    status: 'active',
    createdAt: 100,
    createdBy: 'lucky',
    rewardType: 'direct',
    directPoints: 500,
    ...overrides,
  };
}
const filters = {
  query: '',
  status: 'all',
  reward: 'all',
  audience: 'all',
  sort: 'pinned',
} as const;

describe('后台项目检索', () => {
  it('可领名额同时受领取上限和兑换码库存约束，历史数据不会显示负库存', () => {
    expect(
      getProjectRemaining(project({ rewardType: 'code', codesCount: 35 })),
    ).toBe(15);
    expect(
      getProjectRemaining(
        project({ rewardType: 'code', codesCount: 200, maxClaims: 30 }),
      ),
    ).toBe(10);
    expect(getProjectRemaining(project({ claimedCount: 150 }))).toBe(0);
    expect(getProjectProgress(project({ maxClaims: 0 }))).toBe(0);
    expect(getProjectProgress(project({ claimedCount: 150 }))).toBe(100);
  });

  it('区分积分直充、历史额度和兑换码，可组合状态、人群与不区分大小写的搜索', () => {
    const items = [
      project(),
      project({ id: 'two', name: '旧额度', directPoints: undefined }),
      project({
        id: 'three',
        rewardType: 'code',
        status: 'paused',
        newUserOnly: true,
      }),
    ];
    expect(items.map(getProjectRewardKind)).toEqual([
      'points',
      'legacy',
      'code',
    ]);
    expect(
      selectAdminProjects(items, {
        ...filters,
        query: ' LUCKY ',
        status: 'paused',
        reward: 'code',
        audience: 'new',
      }).map((item) => item.id),
    ).toEqual(['three']);
    expect(
      selectAdminProjects(items, {
        ...filters,
        query: '旧额度',
        reward: 'points',
      }),
    ).toEqual([]);
  });

  it('置顶优先不受已取消置顶的旧时间干扰，其他排序使用实际名额与进度', () => {
    const items = [
      project({ id: 'old', createdAt: 1, pinnedAt: 999 }),
      project({ id: 'new', createdAt: 200, claimedCount: 90 }),
      project({ id: 'pin', createdAt: 2, pinned: true }),
    ];
    expect(selectAdminProjects(items, filters).map((item) => item.id)).toEqual([
      'pin',
      'new',
      'old',
    ]);
    expect(
      selectAdminProjects(items, { ...filters, sort: 'remaining' })[0].id,
    ).toBe('new');
    expect(
      selectAdminProjects(items, { ...filters, sort: 'progress' })[0].id,
    ).toBe('new');
    expect(items.map((item) => item.id)).toEqual(['old', 'new', 'pin']);
  });
});
