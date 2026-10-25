export interface AdminProject {
  id: string;
  name: string;
  description: string;
  maxClaims: number;
  claimedCount: number;
  codesCount: number;
  status: 'active' | 'paused' | 'exhausted';
  createdAt: number;
  createdBy: string;
  rewardType?: 'code' | 'direct';
  directPoints?: number;
  directDollars?: number;
  newUserOnly?: boolean;
  pinned?: boolean;
  pinnedAt?: number;
  autoPauseAt?: number;
  autoPausedAt?: number;
}

export type ProjectRewardKind = 'points' | 'code' | 'legacy';
export type ProjectSort =
  | 'pinned'
  | 'newest'
  | 'oldest'
  | 'remaining'
  | 'progress';

export function getProjectRewardKind(project: AdminProject): ProjectRewardKind {
  if (project.rewardType !== 'direct') return 'code';
  return (project.directPoints ?? 0) > 0 ? 'points' : 'legacy';
}

export function getProjectRemaining(project: AdminProject) {
  const capacity =
    project.rewardType === 'direct'
      ? project.maxClaims
      : Math.min(project.maxClaims, project.codesCount);
  return Math.max(0, capacity - project.claimedCount);
}

export function getProjectProgress(project: AdminProject) {
  return project.maxClaims > 0
    ? Math.min(
        100,
        Math.max(0, (project.claimedCount / project.maxClaims) * 100),
      )
    : 0;
}

export function selectAdminProjects(
  projects: AdminProject[],
  filters: {
    query: string;
    status: 'all' | AdminProject['status'];
    reward: 'all' | ProjectRewardKind;
    audience: 'all' | 'new' | 'everyone';
    sort: ProjectSort;
  },
) {
  const query = filters.query.trim().toLocaleLowerCase('zh-CN');
  return projects
    .filter((project) => {
      if (filters.status !== 'all' && project.status !== filters.status)
        return false;
      if (
        filters.reward !== 'all' &&
        getProjectRewardKind(project) !== filters.reward
      )
        return false;
      if (filters.audience === 'new' && !project.newUserOnly) return false;
      if (filters.audience === 'everyone' && project.newUserOnly) return false;
      return (
        !query ||
        [project.name, project.description, project.id, project.createdBy].some(
          (value) => value?.toLocaleLowerCase('zh-CN').includes(query),
        )
      );
    })
    .sort((left, right) => {
      let delta = 0;
      if (filters.sort === 'pinned')
        delta =
          Number(Boolean(right.pinned)) - Number(Boolean(left.pinned)) ||
          (right.pinned ? (right.pinnedAt ?? 0) : 0) -
            (left.pinned ? (left.pinnedAt ?? 0) : 0);
      if (filters.sort === 'oldest') delta = left.createdAt - right.createdAt;
      if (filters.sort === 'remaining')
        delta = getProjectRemaining(left) - getProjectRemaining(right);
      if (filters.sort === 'progress')
        delta = getProjectProgress(right) - getProjectProgress(left);
      return (
        delta ||
        right.createdAt - left.createdAt ||
        left.id.localeCompare(right.id)
      );
    });
}
