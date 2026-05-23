import { describe, expect, it, vi } from 'vitest';
import type { Project } from '../kv';
import { normalizeProjectDirectPoints, toPublicProject } from '../kv';

vi.mock('@/lib/d1-kv', () => ({
  kv: {},
}));

describe('project direct reward normalization', () => {
  it('rounds legacy decimal direct dollars to integer points', () => {
    expect(normalizeProjectDirectPoints({ directDollars: 29.99 })).toBe(30);
  });

  it('parses numeric strings stored by older admin forms', () => {
    expect(normalizeProjectDirectPoints({ directPoints: '29.99' } as unknown as Pick<Project, 'directPoints' | 'directDollars'>)).toBe(30);
  });

  it('normalizes public direct project payloads', () => {
    const project: Project = {
      id: 'proj-1',
      name: '30',
      description: '',
      maxClaims: 100,
      claimedCount: 56,
      codesCount: 100,
      status: 'active',
      createdAt: 1,
      createdBy: 'admin',
      rewardType: 'direct',
      directDollars: 29.99,
    };

    const publicProject = toPublicProject(project);

    expect(publicProject.directPoints).toBe(30);
    expect(publicProject.directDollars).toBeUndefined();
  });
});
