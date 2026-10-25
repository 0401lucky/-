'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from 'react';
import Link from 'next/link';
import {
  ArrowDownWideNarrow,
  ArrowUpRight,
  CalendarClock,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CirclePlay,
  FolderOpen,
  Gift,
  Loader2,
  Package,
  Pause,
  Pin,
  Play,
  Plus,
  RefreshCw,
  Search,
  SlidersHorizontal,
  Ticket,
  Trash2,
} from 'lucide-react';
import {
  AdminDialog,
  AdminError,
  AdminLoading,
  AdminPageHeader,
} from '@/components/admin/AdminUI';
import { useAdminFeedback } from '@/components/admin/AdminFeedback';
import {
  getProjectProgress,
  getProjectRemaining,
  getProjectRewardKind,
  selectAdminProjects,
  type AdminProject,
  type ProjectRewardKind,
  type ProjectSort,
} from '@/lib/admin/projects';
import { adminRequest } from '@/lib/admin/request';
import { formatChinaDateTime, parseChinaDateTimeInput } from '@/lib/time';

const statusLabels = {
  active: '进行中',
  paused: '已暂停',
  exhausted: '已领完',
};
const statusStyles = {
  active: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  paused: 'border-amber-200 bg-amber-50 text-amber-800',
  exhausted: 'border-stone-200 bg-stone-100 text-stone-500',
};
const rewardLabels = {
  points: '直充积分',
  code: '历史兑换码',
  legacy: '历史额度',
};
const emptyDraft = {
  name: '',
  description: '',
  maxClaims: '100',
  directPoints: '500',
  autoPauseAt: '',
  newUserOnly: false,
};

function StatusBadge({ project }: { project: AdminProject }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-md border px-2 py-1 text-xs font-medium ${statusStyles[project.status]}`}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {statusLabels[project.status]}
    </span>
  );
}

function ClaimProgress({ project }: { project: AdminProject }) {
  const progress = getProjectProgress(project);
  return (
    <div className="min-w-28">
      <div className="mb-2 flex items-center justify-between gap-4 text-xs tabular-nums">
        <span className="text-stone-600">
          {project.claimedCount.toLocaleString()}{' '}
          <span className="text-stone-400">
            / {project.maxClaims.toLocaleString()}
          </span>
        </span>
        <span className="text-stone-400">{Math.round(progress)}%</span>
      </div>
      <div
        role="progressbar"
        aria-label={`${project.name}领取进度`}
        aria-valuenow={Math.round(progress)}
        aria-valuemin={0}
        aria-valuemax={100}
        className="h-1.5 overflow-hidden rounded-full bg-stone-100"
      >
        <div
          className={`h-full rounded-full ${progress >= 90 ? 'bg-amber-500' : 'bg-orange-600'}`}
          style={{ width: `${progress}%` }}
        />
      </div>
    </div>
  );
}

export default function AdminPage() {
  const { notify, confirm } = useAdminFeedback();
  const [projects, setProjects] = useState<AdminProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<'all' | AdminProject['status']>('all');
  const [reward, setReward] = useState<'all' | ProjectRewardKind>('all');
  const [audience, setAudience] = useState<'all' | 'new' | 'everyone'>('all');
  const [sort, setSort] = useState<ProjectSort>('pinned');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(15);
  const [pendingIds, setPendingIds] = useState(new Set<string>());
  const pendingRef = useRef(new Set<string>());
  const fetchController = useRef<AbortController | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [draft, setDraft] = useState(emptyDraft);
  const [creating, setCreating] = useState(false);
  const creatingRef = useRef(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const fetchProjects = useCallback(async () => {
    fetchController.current?.abort();
    const controller = new AbortController();
    fetchController.current = controller;
    try {
      const data = await adminRequest<{ projects: AdminProject[] }>(
        '/api/admin/projects',
        { signal: controller.signal },
      );
      if (controller.signal.aborted) return;
      if (!Array.isArray(data.projects))
        throw new Error('项目列表数据异常，请重试');
      setProjects(data.projects);
      setLoaded(true);
      setError(null);
    } catch (error) {
      if (!controller.signal.aborted)
        setError(error instanceof Error ? error.message : '获取项目列表失败');
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, []);

  const refreshProjects = () => {
    setLoading(true);
    setError(null);
    void fetchProjects();
  };

  useEffect(() => {
    void fetchProjects();
    return () => fetchController.current?.abort();
  }, [fetchProjects]);

  const filtered = useMemo(
    () =>
      selectAdminProjects(projects, { query, status, reward, audience, sort }),
    [projects, query, status, reward, audience, sort],
  );
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const visibleProjects = filtered.slice(
    (currentPage - 1) * pageSize,
    currentPage * pageSize,
  );
  const activeFilters = Boolean(
    query ||
      status !== 'all' ||
      reward !== 'all' ||
      audience !== 'all' ||
      sort !== 'pinned',
  );
  const summary = [
    {
      label: '全部项目',
      value: projects.length,
      detail: '当前项目总数',
      Icon: FolderOpen,
    },
    {
      label: '进行中',
      value: projects.filter((item) => item.status === 'active').length,
      detail: '正在开放领取',
      Icon: CirclePlay,
    },
    {
      label: '剩余可领名额',
      value: projects
        .filter((item) => item.status === 'active')
        .reduce((sum, item) => sum + getProjectRemaining(item), 0),
      detail: '仅统计进行中的项目',
      Icon: Ticket,
    },
    {
      label: '累计领取',
      value: projects.reduce((sum, item) => sum + item.claimedCount, 0),
      detail: '全部项目领取总量',
      Icon: CheckCircle2,
    },
  ];

  const resetFilters = () => {
    setQuery('');
    setStatus('all');
    setReward('all');
    setAudience('all');
    setSort('pinned');
    setPage(1);
  };

  const mutateProject = async (
    project: AdminProject,
    patch: Partial<AdminProject> | null,
    message: string,
  ) => {
    if (pendingRef.current.has(project.id)) return;
    pendingRef.current.add(project.id);
    setPendingIds(new Set(pendingRef.current));
    // 避免操作前发出的刷新响应覆盖已成功的更新。
    fetchController.current?.abort();
    setLoading(false);
    try {
      await adminRequest(
        `/api/admin/projects/${encodeURIComponent(project.id)}`,
        patch
          ? {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(patch),
            }
          : { method: 'DELETE' },
      );
      setProjects((current) =>
        patch
          ? current.map((item) =>
              item.id === project.id
                ? {
                    ...item,
                    ...patch,
                    ...(patch.pinned === true ? { pinnedAt: Date.now() } : {}),
                  }
                : item,
            )
          : current.filter((item) => item.id !== project.id),
      );
      notify(message);
    } catch (error) {
      notify(
        error instanceof Error ? error.message : '操作失败，请重试',
        'error',
      );
    } finally {
      pendingRef.current.delete(project.id);
      setPendingIds(new Set(pendingRef.current));
    }
  };

  const deleteProject = async (project: AdminProject) => {
    if (
      await confirm({
        title: '删除项目？',
        description: `确定删除「${project.name}」吗？删除后项目无法恢复，请确认已完成相关记录核对。`,
        confirmLabel: '删除项目',
        danger: true,
      })
    ) {
      await mutateProject(project, null, `已删除「${project.name}」`);
    }
  };

  const renderActions = (project: AdminProject) => {
    const busy = pendingIds.has(project.id);
    const canStart =
      getProjectRemaining(project) > 0 && project.status !== 'exhausted';
    return (
      <div className="flex items-center justify-end gap-1" aria-busy={busy}>
        <button
          type="button"
          className={`admin-icon-button ${project.pinned ? 'bg-orange-50 text-orange-700' : ''}`}
          disabled={busy}
          title={project.pinned ? '取消置顶' : '置顶项目'}
          aria-label={`${project.pinned ? '取消置顶' : '置顶'}「${project.name}」`}
          onClick={() =>
            void mutateProject(
              project,
              { pinned: !project.pinned },
              project.pinned ? '已取消置顶' : '项目已置顶',
            )
          }
        >
          <Pin className={`h-4 w-4 ${project.pinned ? 'fill-current' : ''}`} />
        </button>
        <button
          type="button"
          className="admin-icon-button"
          disabled={busy || (project.status !== 'active' && !canStart)}
          title={
            project.status === 'active'
              ? '暂停项目'
              : canStart
                ? '恢复项目'
                : '请在详情中追加名额'
          }
          aria-label={`${project.status === 'active' ? '暂停' : '恢复'}「${project.name}」`}
          onClick={() =>
            void mutateProject(
              project,
              { status: project.status === 'active' ? 'paused' : 'active' },
              project.status === 'active' ? '项目已暂停' : '项目已恢复',
            )
          }
        >
          {busy ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : project.status === 'active' ? (
            <Pause className="h-4 w-4" />
          ) : (
            <Play className="h-4 w-4" />
          )}
        </button>
        <button
          type="button"
          className="admin-icon-button admin-icon-button-danger"
          disabled={busy}
          title="删除项目"
          aria-label={`删除「${project.name}」`}
          onClick={() => void deleteProject(project)}
        >
          <Trash2 className="h-4 w-4" />
        </button>
        <Link
          href={`/admin/project/${encodeURIComponent(project.id)}`}
          className="admin-icon-button"
          title="查看详情"
          aria-label={`查看「${project.name}」详情`}
        >
          <ArrowUpRight className="h-4 w-4" />
        </Link>
      </div>
    );
  };

  const handleCreate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (creatingRef.current) return;
    const points = Number(draft.directPoints);
    const count = Number(draft.maxClaims);
    if (!draft.name.trim()) {
      setCreateError('请输入项目名称');
      return;
    }
    if (
      !Number.isSafeInteger(points) ||
      points <= 0 ||
      !Number.isSafeInteger(count) ||
      count <= 0
    ) {
      setCreateError('限领人数和每人积分必须是有效的正整数');
      return;
    }
    const pauseAt = draft.autoPauseAt
      ? parseChinaDateTimeInput(draft.autoPauseAt)
      : null;
    if (draft.autoPauseAt && (pauseAt === null || pauseAt <= Date.now())) {
      setCreateError('请选择有效的未来暂停时间（中国时间）');
      return;
    }
    creatingRef.current = true;
    setCreating(true);
    setCreateError(null);
    try {
      const formData = new FormData();
      formData.append('name', draft.name.trim());
      formData.append('description', draft.description.trim());
      formData.append('maxClaims', String(count));
      formData.append('directPoints', String(points));
      formData.append('newUserOnly', String(draft.newUserOnly));
      formData.append('rewardType', 'direct');
      if (draft.autoPauseAt) formData.append('autoPauseAt', draft.autoPauseAt);
      const data = await adminRequest<{ project: AdminProject }>(
        '/api/admin/projects',
        { method: 'POST', body: formData },
      );
      fetchController.current?.abort();
      setLoading(false);
      if (data.project?.id && loaded) {
        setProjects((current) => [data.project, ...current]);
        setLoaded(true);
      } else {
        setLoading(true);
        void fetchProjects();
      }
      setError(null);
      setCreateOpen(false);
      setDraft(emptyDraft);
      resetFilters();
      notify(
        `项目已创建，每人 ${points.toLocaleString()} 积分，共 ${count.toLocaleString()} 份`,
      );
    } catch (error) {
      setCreateError(
        error instanceof Error ? error.message : '创建失败，请重试',
      );
    } finally {
      creatingRef.current = false;
      setCreating(false);
    }
  };

  return (
    <div className="space-y-6">
      <AdminPageHeader
        eyebrow="运营管理 / PROJECTS"
        title="项目管理"
        description="管理积分福利与历史项目，跟进领取进度和剩余名额。"
        actions={
          <>
            <button
              type="button"
              className="admin-button-secondary"
              onClick={refreshProjects}
              disabled={loading || pendingIds.size > 0 || creating}
            >
              <RefreshCw
                className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`}
                aria-hidden="true"
              />
              刷新
            </button>
            <button
              type="button"
              className="admin-button-primary"
              onClick={() => {
                setCreateError(null);
                setCreateOpen(true);
              }}
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              新建项目
            </button>
          </>
        }
      />

      <section
        aria-label="项目概览"
        className="grid grid-cols-2 gap-3 xl:grid-cols-4"
      >
        {summary.map(({ label, value, detail, Icon }) => (
          <div key={label} className="admin-panel px-3 py-3 sm:px-5 sm:py-4">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-stone-500">
                {label}
              </span>
              <Icon className="h-4 w-4 text-stone-400" aria-hidden="true" />
            </div>
            <p className="mt-2 text-xl font-semibold tabular-nums tracking-tight text-stone-900 sm:mt-3 sm:text-2xl">
              {loaded ? value.toLocaleString() : '—'}
            </p>
            <p className="mt-1.5 hidden text-[11px] text-stone-400 sm:block">{detail}</p>
          </div>
        ))}
      </section>

      {error && (
        <AdminError
          message={`${error}${loaded ? '，当前保留上次加载的列表。' : ''}`}
          onRetry={refreshProjects}
        />
      )}

      <section className="admin-panel overflow-hidden" aria-label="项目列表">
        <div className="space-y-3 border-b border-stone-200 p-4 sm:p-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="relative w-full sm:max-w-sm">
              <Search
                className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-stone-400"
                aria-hidden="true"
              />
              <input
                className="admin-input pl-9"
                aria-label="搜索项目"
                placeholder="搜索项目名称、描述或创建人…"
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setPage(1);
                }}
              />
            </div>
            <div className="flex items-center gap-2 text-xs text-stone-400">
              <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden="true" />
              <span>
                {loaded
                  ? `共 ${filtered.length.toLocaleString()} 个项目`
                  : '等待加载'}
              </span>
              {activeFilters && (
                <button
                  type="button"
                  className="ml-2 font-medium text-orange-700 hover:underline"
                  onClick={resetFilters}
                >
                  重置筛选
                </button>
              )}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <select
              className="admin-input"
              aria-label="项目状态"
              value={status}
              onChange={(event) => {
                setStatus(event.target.value as typeof status);
                setPage(1);
              }}
            >
              <option value="all">全部状态</option>
              <option value="active">进行中</option>
              <option value="paused">已暂停</option>
              <option value="exhausted">已领完</option>
            </select>
            <select
              className="admin-input"
              aria-label="奖励类型"
              value={reward}
              onChange={(event) => {
                setReward(event.target.value as typeof reward);
                setPage(1);
              }}
            >
              <option value="all">全部奖励类型</option>
              <option value="points">直充积分</option>
              <option value="code">历史兑换码</option>
              <option value="legacy">历史额度</option>
            </select>
            <select
              className="admin-input"
              aria-label="领取人群"
              value={audience}
              onChange={(event) => {
                setAudience(event.target.value as typeof audience);
                setPage(1);
              }}
            >
              <option value="all">全部领取人群</option>
              <option value="new">仅限新用户</option>
              <option value="everyone">不限新老用户</option>
            </select>
            <div className="relative">
              <ArrowDownWideNarrow
                className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-stone-400"
                aria-hidden="true"
              />
              <select
                className="admin-input pl-9"
                aria-label="项目排序"
                value={sort}
                onChange={(event) => {
                  setSort(event.target.value as ProjectSort);
                  setPage(1);
                }}
              >
                <option value="pinned">置顶优先</option>
                <option value="newest">最近创建</option>
                <option value="oldest">最早创建</option>
                <option value="remaining">剩余名额最少</option>
                <option value="progress">领取进度最高</option>
              </select>
            </div>
          </div>
        </div>

        {loading && !loaded ? (
          <AdminLoading label="正在加载项目…" />
        ) : !loaded && error ? (
          <div className="py-20 text-center text-sm text-stone-400">
            项目列表暂时不可用，请重试。
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center px-6 py-20 text-center">
            <Package
              className="mb-4 h-9 w-9 text-stone-300"
              aria-hidden="true"
            />
            <h2 className="text-base font-semibold text-stone-700">
              {activeFilters ? '没有匹配的项目' : '还没有福利项目'}
            </h2>
            <p className="mt-2 text-sm text-stone-400">
              {activeFilters
                ? '调整关键词或筛选条件，查找其他项目。'
                : '创建第一个积分福利项目，开始发放奖励。'}
            </p>
            <button
              type="button"
              className="admin-button-secondary mt-5"
              onClick={activeFilters ? resetFilters : () => setCreateOpen(true)}
            >
              {activeFilters ? '清除筛选' : '新建项目'}
            </button>
          </div>
        ) : (
          <>
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full min-w-[900px] text-left text-sm">
                <thead className="bg-stone-50/80 text-xs text-stone-500">
                  <tr>
                    <th scope="col" className="px-5 py-3 font-medium">
                      项目 / 奖励
                    </th>
                    <th scope="col" className="px-4 py-3 font-medium">
                      状态
                    </th>
                    <th scope="col" className="px-4 py-3 font-medium">
                      领取进度
                    </th>
                    <th scope="col" className="px-4 py-3 font-medium">
                      剩余名额
                    </th>
                    <th scope="col" className="px-4 py-3 font-medium">
                      时间（中国）
                    </th>
                    <th
                      scope="col"
                      className="px-5 py-3 text-right font-medium"
                    >
                      操作
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100">
                  {visibleProjects.map((project) => (
                    <tr
                      key={project.id}
                      className="transition-colors hover:bg-stone-50/70"
                    >
                      <td className="max-w-72 px-5 py-5">
                        <div className="flex items-center gap-2">
                          <Link
                            href={`/admin/project/${encodeURIComponent(project.id)}`}
                            className="truncate font-semibold text-stone-800 hover:text-orange-700"
                          >
                            {project.name}
                          </Link>
                          {project.pinned && (
                            <Pin
                              className="h-3.5 w-3.5 shrink-0 fill-orange-100 text-orange-700"
                              aria-label="已置顶"
                            />
                          )}
                          {project.newUserOnly && (
                            <span className="shrink-0 rounded border border-sky-100 bg-sky-50 px-1.5 py-0.5 text-[10px] text-sky-700">
                              新人
                            </span>
                          )}
                        </div>
                        <p className="mt-1.5 text-xs text-stone-400">
                          {rewardLabels[getProjectRewardKind(project)]}
                          {getProjectRewardKind(project) === 'points' && (
                            <span className="ml-2 tabular-nums text-stone-500">
                              {project.directPoints?.toLocaleString()} 积分 / 人
                            </span>
                          )}
                        </p>
                      </td>
                      <td className="px-4 py-5">
                        <StatusBadge project={project} />
                      </td>
                      <td className="w-44 px-4 py-5">
                        <ClaimProgress project={project} />
                      </td>
                      <td className="px-4 py-5">
                        <span
                          className={`font-semibold tabular-nums ${getProjectRemaining(project) > 0 && getProjectRemaining(project) <= 10 ? 'text-amber-700' : 'text-stone-700'}`}
                        >
                          {getProjectRemaining(project).toLocaleString()}
                        </span>
                        <span className="ml-1.5 text-xs text-stone-400">
                          份
                        </span>
                      </td>
                      <td className="px-4 py-5 text-xs">
                        <p className="whitespace-nowrap text-stone-500">
                          {formatChinaDateTime(project.createdAt)}
                        </p>
                        {project.autoPauseAt && (
                          <p className="mt-1.5 whitespace-nowrap text-amber-700">
                            暂停 {formatChinaDateTime(project.autoPauseAt)}
                          </p>
                        )}
                      </td>
                      <td className="px-4 py-5">{renderActions(project)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="divide-y divide-stone-100 md:hidden">
              {visibleProjects.map((project) => (
                <article key={project.id} className="space-y-4 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <Link
                        href={`/admin/project/${encodeURIComponent(project.id)}`}
                        className="break-words text-sm font-semibold text-stone-800"
                      >
                        {project.name}
                        {project.pinned && (
                          <Pin
                            className="ml-1 inline h-3 w-3 text-orange-700"
                            aria-label="已置顶"
                          />
                        )}
                      </Link>
                      <p className="mt-1.5 text-xs text-stone-400">
                        {rewardLabels[getProjectRewardKind(project)]}
                        {getProjectRewardKind(project) === 'points'
                          ? ` · ${project.directPoints?.toLocaleString()} 积分 / 人`
                          : ''}
                        {project.newUserOnly ? ' · 仅限新人' : ''}
                      </p>
                    </div>
                    <StatusBadge project={project} />
                  </div>
                  <ClaimProgress project={project} />
                  <div className="flex items-center justify-between text-xs text-stone-500">
                    <span>
                      剩余{' '}
                      <strong className="font-semibold text-stone-800">
                        {getProjectRemaining(project).toLocaleString()}
                      </strong>{' '}
                      份
                    </span>
                    <span>
                      {formatChinaDateTime(project.createdAt).slice(0, 10)}
                    </span>
                  </div>
                  {project.autoPauseAt && (
                    <p className="flex items-center gap-1.5 text-xs text-amber-700">
                      <CalendarClock
                        className="h-3.5 w-3.5"
                        aria-hidden="true"
                      />
                      自动暂停 {formatChinaDateTime(project.autoPauseAt)}
                    </p>
                  )}
                  <div className="flex items-center justify-between border-t border-stone-100 pt-3">
                    <Link
                      href={`/admin/project/${encodeURIComponent(project.id)}`}
                      className="text-xs font-medium text-orange-700"
                    >
                      查看项目
                    </Link>
                    {renderActions(project)}
                  </div>
                </article>
              ))}
            </div>
          </>
        )}

        {loaded && filtered.length > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-stone-200 px-4 py-3 text-xs text-stone-500 sm:px-5">
            <div className="flex items-center gap-2">
              <label htmlFor="project-page-size">每页</label>
              <select
                id="project-page-size"
                value={pageSize}
                onChange={(event) => {
                  setPageSize(Number(event.target.value));
                  setPage(1);
                }}
                className="rounded-md border border-stone-200 bg-white px-1.5 py-1.5"
              >
                <option value={15}>15 条</option>
                <option value={30}>30 条</option>
                <option value={50}>50 条</option>
              </select>
              <span className="hidden sm:inline">
                第 {(currentPage - 1) * pageSize + 1}–
                {Math.min(currentPage * pageSize, filtered.length)} 条
              </span>
            </div>
            <div className="flex items-center gap-3">
              <span className="tabular-nums">
                {currentPage} / {totalPages} 页
              </span>
              <button
                type="button"
                className="admin-icon-button"
                disabled={currentPage === 1}
                aria-label="上一页"
                onClick={() => setPage(currentPage - 1)}
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <button
                type="button"
                className="admin-icon-button"
                disabled={currentPage === totalPages}
                aria-label="下一页"
                onClick={() => setPage(currentPage + 1)}
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        )}
      </section>

      <AdminDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        busy={creating}
        wide
        title="新建福利项目"
        description="发布站内积分福利，用户领取后积分将直接到账。"
        footer={
          <>
            <button
              type="button"
              className="admin-button-secondary"
              disabled={creating}
              onClick={() => setCreateOpen(false)}
            >
              取消
            </button>
            <button
              type="submit"
              form="create-project-form"
              className="admin-button-primary"
              disabled={creating}
            >
              {creating ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Plus className="h-4 w-4" />
              )}
              {creating ? '创建中…' : '创建项目'}
            </button>
          </>
        }
      >
        <form
          id="create-project-form"
          onSubmit={(event) => void handleCreate(event)}
          className="space-y-5"
        >
          {createError && <AdminError message={createError} />}
          <fieldset disabled={creating} className="space-y-5">
            <div>
              <label htmlFor="project-name" className="admin-field-label">
                项目名称 <span className="text-orange-700">*</span>
              </label>
              <input
                id="project-name"
                className="admin-input"
                required
                value={draft.name}
                onChange={(event) =>
                  setDraft({ ...draft, name: event.target.value })
                }
                placeholder="例如：周末积分福利"
              />
            </div>
            <div>
              <label
                htmlFor="project-description"
                className="admin-field-label"
              >
                项目描述
              </label>
              <textarea
                id="project-description"
                className="admin-input resize-y"
                rows={3}
                value={draft.description}
                onChange={(event) =>
                  setDraft({ ...draft, description: event.target.value })
                }
                placeholder="说明活动内容和参与方式…"
              />
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="project-claims" className="admin-field-label">
                  限领人数 <span className="text-orange-700">*</span>
                </label>
                <input
                  id="project-claims"
                  type="number"
                  min={1}
                  max={Number.MAX_SAFE_INTEGER}
                  step={1}
                  required
                  className="admin-input"
                  value={draft.maxClaims}
                  onChange={(event) =>
                    setDraft({ ...draft, maxClaims: event.target.value })
                  }
                />
              </div>
              <div>
                <label htmlFor="project-points" className="admin-field-label">
                  每人积分 <span className="text-orange-700">*</span>
                </label>
                <input
                  id="project-points"
                  type="number"
                  min={1}
                  max={Number.MAX_SAFE_INTEGER}
                  step={1}
                  required
                  className="admin-input"
                  value={draft.directPoints}
                  onChange={(event) =>
                    setDraft({ ...draft, directPoints: event.target.value })
                  }
                />
              </div>
            </div>
            <div>
              <label htmlFor="project-pause" className="admin-field-label">
                自动暂停时间{' '}
                <span className="font-normal text-stone-400">
                  （可选，中国时间）
                </span>
              </label>
              <input
                id="project-pause"
                type="datetime-local"
                className="admin-input"
                value={draft.autoPauseAt}
                onChange={(event) =>
                  setDraft({ ...draft, autoPauseAt: event.target.value })
                }
              />
              <p className="mt-2 text-xs text-stone-400">
                到点后服务器自动暂停，无需保持后台页面打开。
              </p>
            </div>
            <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-stone-200 p-4">
              <input
                type="checkbox"
                className="mt-0.5 h-4 w-4 accent-orange-700"
                checked={draft.newUserOnly}
                onChange={(event) =>
                  setDraft({ ...draft, newUserOnly: event.target.checked })
                }
              />
              <span>
                <span className="block text-sm font-medium text-stone-700">
                  仅限新用户领取
                </span>
                <span className="mt-1 block text-xs text-stone-400">
                  开启后按照站点新人资格规则限制领取。
                </span>
              </span>
            </label>
            <div className="flex items-start gap-2 rounded-lg border border-orange-100 bg-orange-50 p-3 text-xs leading-5 text-orange-800">
              <Gift className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <p>
                新项目统一发放站内积分；历史兑换码与额度项目仍可在列表中查看。
              </p>
            </div>
          </fieldset>
        </form>
      </AdminDialog>
    </div>
  );
}
