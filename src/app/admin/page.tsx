'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import Link from 'next/link';
import {
  Plus, Pause, Play, Trash2, Upload,
  Loader2, AlertCircle, Package,
  ChevronRight, X, Check, Gift, Pin,
} from 'lucide-react';

interface Project {
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
  directDollars?: number;
  newUserOnly?: boolean;
  pinned?: boolean;
  pinnedAt?: number;
}

export default function AdminPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const successTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [maxClaims, setMaxClaims] = useState('100');
  const [rewardType, setRewardType] = useState<'code' | 'direct'>('code');
  const [directDollars, setDirectDollars] = useState('5');
  const [codesFile, setCodesFile] = useState<File | null>(null);
  const [newUserOnly, setNewUserOnly] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      const projectsRes = await fetch('/api/admin/projects');
      if (projectsRes.ok) {
        const data = await projectsRes.json();
        if (data.success) {
          setProjects(data.projects);
        }
      }
    } catch (error) {
      console.error('Fetch error:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  const scheduleSuccessClear = useCallback(() => {
    if (successTimeoutRef.current) {
      clearTimeout(successTimeoutRef.current);
    }
    successTimeoutRef.current = setTimeout(() => {
      setSuccess(null);
      successTimeoutRef.current = null;
    }, 5000);
  }, []);

  useEffect(() => {
    return () => {
      if (successTimeoutRef.current) {
        clearTimeout(successTimeoutRef.current);
      }
    };
  }, []);

  const handleCreateProject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError('请输入项目名称');
      return;
    }
    if (rewardType === 'direct') {
      const dollars = parseFloat(directDollars);
      if (!Number.isFinite(dollars) || dollars <= 0) {
        setError('请输入有效的直充金额（> 0）');
        return;
      }
    }

    setCreating(true);
    setError(null);

    try {
      const formData = new FormData();
      formData.append('name', name.trim());
      formData.append('description', description.trim());
      formData.append('maxClaims', maxClaims);
      formData.append('newUserOnly', newUserOnly.toString());
      formData.append('rewardType', rewardType);
      if (rewardType === 'direct') {
        formData.append('directDollars', directDollars);
      }
      if (rewardType === 'code' && codesFile) {
        formData.append('codes', codesFile);
      }

      const res = await fetch('/api/admin/projects', {
        method: 'POST',
        body: formData,
      });

      const data = await res.json();

      if (data.success) {
        const created = data.project as Project | undefined;
        if (created?.rewardType === 'direct') {
          setSuccess(`项目创建成功! 每人直充 $${created.directDollars}，共 ${created.maxClaims} 份`);
        } else {
          setSuccess(`项目创建成功! 添加了 ${data.codesAdded} 个兑换码`);
        }
        setShowCreateModal(false);
        setName('');
        setDescription('');
        setMaxClaims('100');
        setRewardType('code');
        setDirectDollars('5');
        setCodesFile(null);
        setNewUserOnly(false);
        fetchData();
        scheduleSuccessClear();
      } else {
        setError(data.message || '创建失败');
      }
    } catch {
      setError('请求失败，请稍后重试');
    } finally {
      setCreating(false);
    }
  };

  const handleToggleStatus = async (project: Project, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const newStatus = project.status === 'active' ? 'paused' : 'active';
    try {
      const res = await fetch(`/api/admin/projects/${project.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      });
      if (res.ok) fetchData();
    } catch (err) {
      console.error('Toggle status error:', err);
    }
  };

  const handleDelete = async (project: Project, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!confirm(`确定要删除项目 "${project.name}" 吗？`)) return;
    try {
      const res = await fetch(`/api/admin/projects/${project.id}`, { method: 'DELETE' });
      if (res.ok) fetchData();
    } catch (err) {
      console.error('Delete error:', err);
    }
  };

  const handleTogglePinned = async (project: Project, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      const res = await fetch(`/api/admin/projects/${project.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pinned: !project.pinned }),
      });
      if (res.ok) fetchData();
    } catch (err) {
      console.error('Toggle pinned error:', err);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-32">
        <Loader2 className="w-8 h-8 animate-spin text-orange-500" />
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8 pb-20">
      {/* 成功提示 */}
      {success && (
        <div className="mb-6 p-4 bg-emerald-50/80 backdrop-blur-sm rounded-2xl border border-emerald-100 flex justify-between items-center animate-fade-in shadow-sm">
          <div className="flex items-center gap-3 text-emerald-700">
            <div className="w-6 h-6 rounded-full bg-emerald-100 flex items-center justify-center shrink-0">
              <Check className="w-3.5 h-3.5" />
            </div>
            <span className="font-semibold text-sm">{success}</span>
          </div>
          <button
            onClick={() => setSuccess(null)}
            className="p-1 hover:bg-emerald-100 rounded-lg text-emerald-500 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* 头部 */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-end gap-4 mb-8">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-stone-800 mb-1 tracking-tight">项目列表</h1>
          <p className="text-stone-500 text-sm">创建和管理您的兑换码分发项目</p>
        </div>
        <button
          onClick={() => setShowCreateModal(true)}
          className="w-full sm:w-auto flex items-center justify-center gap-2 px-6 py-3.5 gradient-warm text-white hover:opacity-90 transition-all rounded-2xl font-black shadow-lg shadow-orange-500/30 active:translate-y-0.5 hover:scale-105"
        >
          <Plus className="w-5 h-5" />
          新建项目
        </button>
      </div>

      {/* 项目列表容器 */}
      <div className="space-y-4 min-h-[400px]">
        {projects.length === 0 ? (
          <div className="glass rounded-3xl flex flex-col items-center justify-center py-24 px-4 border border-stone-200/60 dashed-border">
            <div className="w-20 h-20 bg-stone-50 rounded-full flex items-center justify-center mb-6 shadow-inner animate-float">
              <Package className="w-10 h-10 text-stone-300" />
            </div>
            <h2 className="text-xl font-black text-stone-700 mb-2">暂无项目</h2>
            <p className="text-stone-400 text-sm font-bold">快去创建你的第一个福利活动吧！</p>
          </div>
        ) : (
          <>
            {/* Header for desktop */}
            <div className="hidden lg:grid grid-cols-[2fr_1fr_1.5fr_1fr_1fr_100px] px-8 text-xs font-black text-stone-400 uppercase tracking-widest pl-6">
              <div>项目名称</div>
              <div>状态</div>
              <div>领取进度</div>
              <div>库存</div>
              <div>创建时间</div>
              <div className="text-right">操作</div>
            </div>

            <div className="space-y-3">
              {projects.map((project) => (
                <Link
                  key={project.id}
                  href={`/admin/project/${project.id}`}
                  className="group block"
                >
                  <div className="glass-card rounded-2xl border-white/60 hover:border-orange-200 transition-all duration-300 hover:scale-[1.01]">
                    {/* Desktop View */}
                    <div className="hidden lg:grid grid-cols-[2fr_1fr_1.5fr_1fr_1fr_100px] px-6 py-4 items-center gap-4">
                      {/* Name */}
                      <div className="flex items-center gap-4">
                        <div className={`w-12 h-12 rounded-2xl flex items-center justify-center border transition-all duration-300 shadow-sm group-hover:rotate-6 ${project.status === 'active'
                          ? 'bg-gradient-to-br from-orange-50 to-orange-100 border-orange-200'
                          : 'bg-gradient-to-br from-stone-50 to-stone-100 border-stone-200'
                          }`}>
                          <Gift className={`w-6 h-6 ${project.status === 'active' ? 'text-orange-500' : 'text-stone-400'}`} />
                        </div>
                        <div className="flex flex-col gap-1">
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-stone-700 text-base group-hover:text-orange-600 transition-colors">{project.name}</span>
                            {project.pinned && (
                              <span className="w-5 h-5 bg-orange-100 text-orange-600 rounded-lg flex items-center justify-center text-[10px] shadow-sm transform -rotate-12">📌</span>
                            )}
                            {project.newUserOnly && (
                              <span className="px-1.5 py-0.5 bg-emerald-100 text-emerald-600 rounded-md text-[10px] font-black tracking-tighter uppercase border border-emerald-200">New</span>
                            )}
                          </div>

                          <button
                            type="button"
                            onClick={(e) => handleTogglePinned(project, e)}
                            className={`text-xs ml-auto transition-colors font-bold ${project.pinned ? 'text-orange-500' : 'text-stone-300 hover:text-orange-400 opacity-0 group-hover:opacity-100'
                              }`}
                          >
                            {project.pinned ? '已置顶' : '置顶项目'}
                          </button>

                        </div>
                      </div>

                      {/* Status */}
                      <div>
                        <span className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-bold border shadow-sm ${project.status === 'active'
                          ? 'bg-gradient-to-r from-emerald-50 to-emerald-100 text-emerald-700 border-emerald-200'
                          : project.status === 'paused'
                            ? 'bg-gradient-to-r from-amber-50 to-amber-100 text-amber-700 border-amber-200'
                            : 'bg-stone-100 text-stone-500 border-stone-200'
                          }`}>
                          <span className={`w-1.5 h-1.5 rounded-full mr-1.5 ${project.status === 'active' ? 'bg-emerald-500 animate-pulse' : project.status === 'paused' ? 'bg-amber-500' : 'bg-stone-400'
                            }`}></span>
                          {project.status === 'active' ? '进行中' : project.status === 'paused' ? '已暂停' : '已领完'}
                        </span>
                      </div>

                      {/* Progress */}
                      <div className="pr-4">
                        <div className="flex items-center justify-between mb-1.5">
                          <span className="text-[10px] font-bold text-stone-400 uppercase tracking-wider">Progress</span>
                          <span className="text-xs font-bold text-stone-600">{Math.round((project.claimedCount / project.maxClaims) * 100)}%</span>
                        </div>
                        <div className="h-2.5 bg-stone-100 rounded-full overflow-hidden border border-stone-200/50 shadow-inner">
                          <div
                            className="h-full bg-gradient-to-r from-orange-400 to-red-500 rounded-full shadow-[0_0_10px_rgba(249,115,22,0.4)] relative overflow-hidden"
                            style={{ width: `${Math.min(100, (project.claimedCount / project.maxClaims) * 100)}%` }}
                          >
                            <div className="absolute inset-0 bg-white/30 w-full h-full animate-shine-fast"></div>
                          </div>
                        </div>

                      </div>

                      {/* Stock */}
                      <div className="flex flex-col">
                        <span className="text-xl font-black text-stone-700 leading-none">{project.codesCount - project.claimedCount}</span>
                        <span className="text-[10px] text-stone-400 font-bold uppercase tracking-wider">Left</span>
                      </div>

                      {/* Date */}
                      <div className="flex flex-col">
                        <span className="text-sm font-bold text-stone-600">{new Date(project.createdAt).toLocaleDateString()}</span>
                      </div>

                      {/* Actions */}
                      <div className="flex justify-end gap-2" onClick={(e) => e.preventDefault()}>
                        <button
                          onClick={(e) => handleToggleStatus(project, e)}
                          className={`w-9 h-9 rounded-xl flex items-center justify-center transition-all hover:scale-105 active:scale-95 shadow-sm border ${project.status === 'active'
                            ? 'bg-white text-amber-500 border-amber-100 hover:bg-amber-50 hover:border-amber-200'
                            : 'bg-white text-emerald-500 border-emerald-100 hover:bg-emerald-50 hover:border-emerald-200'
                            }`}
                          title={project.status === 'active' ? '暂停项目' : '启动项目'}
                        >
                          {project.status === 'active' ? <Pause className="w-4 h-4 fill-current" /> : <Play className="w-4 h-4 fill-current ml-0.5" />}
                        </button>
                        <button
                          onClick={(e) => handleDelete(project, e)}
                          className="w-9 h-9 rounded-xl bg-white text-stone-300 border border-stone-100 hover:text-red-500 hover:border-red-200 hover:bg-red-50 hover:shadow-sm flex items-center justify-center transition-all hover:scale-105 active:scale-95"
                          title="删除项目"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>

                    {/* Mobile Card View (Enhanced) */}
                    <div className="lg:hidden p-5 flex flex-col gap-4">
                      <div className="flex items-start justify-between">
                        <div className="flex items-center gap-3">
                          <div className={`w-12 h-12 rounded-2xl flex items-center justify-center border transition-all duration-300 shadow-sm ${project.status === 'active'
                            ? 'bg-gradient-to-br from-orange-50 to-orange-100 border-orange-200'
                            : 'bg-gradient-to-br from-stone-50 to-stone-100 border-stone-200'
                            }`}>
                            <Gift className={`w-6 h-6 ${project.status === 'active' ? 'text-orange-500' : 'text-stone-400'}`} />
                          </div>
                          <div>
                            <div className="flex items-center gap-2">
                              <h3 className="font-bold text-stone-800 text-lg">{project.name}</h3>
                              {project.pinned && <span className="text-xs">📌</span>}
                            </div>
                            <div className="flex items-center gap-2 text-xs font-bold text-stone-400 mt-0.5">
                              <span>{new Date(project.createdAt).toLocaleDateString()}</span>
                              {project.newUserOnly && <span className="bg-emerald-100 text-emerald-600 px-1.5 py-0.5 rounded text-[10px] border border-emerald-200">NEW USER</span>}
                            </div>
                          </div>
                        </div>
                        <button
                          onClick={(e) => handleToggleStatus(project, e)}
                          className={`p-2 rounded-xl transition-all active:scale-95 border ${project.status === 'active'
                            ? 'bg-amber-50 text-amber-500 border-amber-200'
                            : 'bg-emerald-50 text-emerald-500 border-emerald-200'
                            }`}
                        >
                          {project.status === 'active' ? <Pause className="w-5 h-5 fill-current" /> : <Play className="w-5 h-5 fill-current ml-0.5" />}
                        </button>
                      </div>

                      <div className="bg-stone-50/80 rounded-2xl p-4 border border-stone-100">
                        <div className="flex justify-between items-center mb-2">
                          <span className="text-xs font-black text-stone-400 uppercase">Claims</span>
                          <div className="text-xs font-bold">
                            <span className="text-stone-800">{project.claimedCount}</span>
                            <span className="text-stone-300 mx-1">/</span>
                            <span className="text-stone-500">{project.maxClaims}</span>
                          </div>
                        </div>
                        <div className="h-3 bg-stone-200/50 rounded-full overflow-hidden border border-stone-200/50">
                          <div
                            className="h-full bg-gradient-to-r from-orange-400 to-red-500 rounded-full shadow-sm"
                            style={{ width: `${Math.min(100, (project.claimedCount / project.maxClaims) * 100)}%` }}
                          />
                        </div>
                        <div className="flex justify-between items-center mt-3 pt-3 border-t border-stone-200/60 dashed-border-t">
                          <span className="text-xs font-bold text-stone-500">剩余库存</span>
                          <span className="font-black text-stone-800 text-lg">{project.codesCount - project.claimedCount}</span>
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-3" onClick={(e) => e.preventDefault()}>
                        <button
                          onClick={(e) => handleTogglePinned(project, e)}
                          className={`py-3 rounded-xl text-sm font-bold flex items-center justify-center gap-2 transition-all active:scale-95 border ${project.pinned
                            ? 'bg-orange-50 text-orange-600 border-orange-200'
                            : 'bg-white text-stone-400 border-stone-200 hover:border-orange-200 hover:text-orange-500'
                            }`}
                        >
                          <Pin className="w-4 h-4" />
                          {project.pinned ? '已置顶' : '置顶'}
                        </button>
                        <button
                          onClick={(e) => handleDelete(project, e)}
                          className="py-3 rounded-xl bg-white text-stone-400 border border-stone-200 hover:text-red-500 hover:border-red-200 hover:bg-red-50 flex items-center justify-center gap-2 text-sm font-bold transition-all active:scale-95"
                        >
                          <Trash2 className="w-4 h-4" />
                          删除
                        </button>
                      </div>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          </>
        )}
      </div>
      {/* 创建项目弹窗 */}
      {showCreateModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 sm:p-6 overflow-y-auto">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-stone-900/40 backdrop-blur-md transition-opacity duration-300"
            onClick={() => setShowCreateModal(false)}
          />

          {/* Modal Content - Bouncy Glass */}
          <div className="relative w-full max-w-md bg-white/90 backdrop-blur-xl rounded-[2rem] shadow-2xl overflow-hidden animate-scale-in ring-1 ring-white/50 max-h-[90vh] my-6 border border-white/60">
            {/* Header */}
            <div className="px-8 py-6 border-b border-stone-100 flex justify-between items-center bg-gradient-to-r from-orange-50/50 to-stone-50/50">
              <h2 className="text-xl font-black text-stone-800 flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-gradient-to-br from-orange-400 to-red-500 flex items-center justify-center shadow-lg shadow-orange-500/30 text-white">
                  <Plus className="w-5 h-5" />
                </div>
                创建新项目
              </h2>
              <button
                onClick={() => setShowCreateModal(false)}
                className="w-8 h-8 rounded-full bg-stone-100 hover:bg-stone-200 flex items-center justify-center text-stone-400 hover:text-stone-600 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Form */}
            <form onSubmit={handleCreateProject} className="p-8 overflow-y-auto max-h-[calc(90vh-88px)]">
              {error && (
                <div className="mb-6 p-4 bg-red-50 border border-red-100 rounded-2xl flex items-center gap-3 text-red-600 text-sm font-bold animate-pulse">
                  <AlertCircle className="w-5 h-5 flex-shrink-0" />
                  {error}
                </div>
              )}

              <div className="space-y-6">
                <div>
                  <label className="block text-xs font-black text-stone-400 uppercase tracking-widest mb-2 pl-1">
                    项目名称 <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="例如: 5刀福利"
                    className="w-full px-5 py-3.5 bg-stone-50 border-2 border-stone-100 rounded-2xl focus:bg-white focus:border-orange-400 focus:ring-4 focus:ring-orange-100 transition-all outline-none text-stone-800 placeholder-stone-400 font-bold"
                  />
                </div>

                <div>
                  <label className="block text-xs font-black text-stone-400 uppercase tracking-widest mb-2 pl-1">
                    项目描述
                  </label>
                  <textarea
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="简要描述活动内容..."
                    rows={3}
                    className="w-full px-5 py-3.5 bg-stone-50 border-2 border-stone-100 rounded-2xl focus:bg-white focus:border-orange-400 focus:ring-4 focus:ring-orange-100 transition-all outline-none text-stone-800 placeholder-stone-400 font-medium resize-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-black text-stone-400 uppercase tracking-widest mb-2 pl-1">
                    限领人数 <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="number"
                    value={maxClaims}
                    onChange={(e) => setMaxClaims(e.target.value)}
                    min="1"
                    className="w-full px-5 py-3.5 bg-stone-50 border-2 border-stone-100 rounded-2xl focus:bg-white focus:border-orange-400 focus:ring-4 focus:ring-orange-100 transition-all outline-none text-stone-800 placeholder-stone-400 font-bold"
                  />
                </div>

                <div>
                  <label className="block text-xs font-black text-stone-400 uppercase tracking-widest mb-2 pl-1">
                    奖励方式 <span className="text-red-500">*</span>
                  </label>
                  <div className="grid grid-cols-2 gap-3 p-1 bg-stone-100 rounded-2xl border border-stone-200">
                    <button
                      type="button"
                      onClick={() => {
                        setRewardType('code');
                      }}
                      className={`px-4 py-3 rounded-xl text-sm font-black transition-all duration-300 ${rewardType === 'code'
                          ? 'bg-white text-orange-600 shadow-sm scale-[1.02]'
                          : 'text-stone-400 hover:text-stone-600'
                        }`}
                    >
                      兑换码
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setRewardType('direct');
                        setCodesFile(null);
                      }}
                      className={`px-4 py-3 rounded-xl text-sm font-black transition-all duration-300 ${rewardType === 'direct'
                          ? 'bg-white text-orange-600 shadow-sm scale-[1.02]'
                          : 'text-stone-400 hover:text-stone-600'
                        }`}
                    >
                      直充额度
                    </button>
                  </div>
                </div>

                {rewardType === 'direct' && (
                  <div className="animate-fade-in">
                    <label className="block text-xs font-black text-stone-400 uppercase tracking-widest mb-2 pl-1">
                      直充金额（USD） <span className="text-red-500">*</span>
                    </label>
                    <div className="relative">
                      <span className="absolute left-4 top-1/2 -translate-y-1/2 text-stone-400 font-bold">$</span>
                      <input
                        type="number"
                        value={directDollars}
                        onChange={(e) => setDirectDollars(e.target.value)}
                        min="0.01"
                        step="0.01"
                        className="w-full pl-8 pr-5 py-3.5 bg-stone-50 border-2 border-stone-100 rounded-2xl focus:bg-white focus:border-orange-400 focus:ring-4 focus:ring-orange-100 transition-all outline-none text-stone-800 placeholder-stone-400 font-bold"
                      />
                    </div>
                    <p className="mt-2 text-xs text-stone-400 font-bold pl-1">
                      用户领取后将直接充值到其 new-api 账户余额。
                    </p>
                  </div>
                )}

                <div>
                  <label className="block text-xs font-black text-stone-400 uppercase tracking-widest mb-2 pl-1">
                    导入兑换码
                  </label>
                  {rewardType === 'direct' ? (
                    <div className="border-2 border-stone-100 rounded-2xl p-6 bg-stone-50/50 text-center flex flex-col items-center justify-center border-dashed">
                      <p className="text-sm font-bold text-stone-600">直充项目无需上传兑换码</p>
                      <p className="text-xs text-stone-400 mt-1 font-bold">库存与限领人数一致</p>
                    </div>
                  ) : (
                    <div className="group relative border-2 border-dashed border-stone-200 hover:border-orange-400 rounded-2xl p-6 transition-all bg-stone-50 hover:bg-orange-50/30 text-center cursor-pointer hover:scale-[1.01]">
                      <input
                        type="file"
                        accept=".txt"
                        onChange={(e) => setCodesFile(e.target.files?.[0] || null)}
                        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                      />
                      <div className="w-14 h-14 bg-white rounded-2xl shadow-sm border border-stone-100 flex items-center justify-center mx-auto mb-3 group-hover:scale-110 transition-transform duration-300 group-hover:rotate-6">
                        <Upload className="w-6 h-6 text-orange-500" />
                      </div>
                      <p className="text-sm font-bold text-stone-600">
                        {codesFile ? (
                          <span className="text-orange-600">{codesFile.name}</span>
                        ) : (
                          <>点击选择 <span className="text-stone-900">.txt</span> 文件</>
                        )}
                      </p>
                      <p className="text-xs text-stone-400 mt-1 font-bold">每行一个兑换码</p>
                    </div>
                  )}
                </div>

                {/* 仅限新用户开关 */}
                <div className="flex items-center justify-between p-4 bg-emerald-50/50 border border-emerald-100/50 rounded-2xl transition-colors hover:bg-emerald-50">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-emerald-100 flex items-center justify-center shadow-sm">
                      <span className="text-lg">🆕</span>
                    </div>
                    <div>
                      <p className="font-bold text-stone-800 text-sm">仅限新用户</p>
                      <p className="text-[10px] text-stone-500 font-bold uppercase tracking-wider mt-0.5">New Users Only</p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setNewUserOnly(!newUserOnly)}
                    className={`relative w-14 h-8 rounded-full transition-all duration-300 shadow-inner ${newUserOnly ? 'bg-emerald-500' : 'bg-stone-200'
                      }`}
                  >
                    <span className={`absolute top-1 w-6 h-6 bg-white rounded-full shadow-sm transition-all duration-300 ${newUserOnly ? 'left-7' : 'left-1'
                      }`} />
                  </button>
                </div>
              </div>

              <div className="flex gap-3 mt-8">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="flex-1 py-3.5 bg-stone-100 hover:bg-stone-200 text-stone-600 rounded-2xl font-black transition-colors text-sm"
                >
                  取消
                </button>
                <button
                  type="submit"
                  disabled={creating}
                  className="flex-1 py-3.5 gradient-warm hover:opacity-90 text-white rounded-2xl font-black shadow-lg shadow-orange-500/30 disabled:opacity-70 disabled:cursor-not-allowed flex items-center justify-center gap-2 transition-all hover:scale-[1.02] active:scale-[0.98] text-sm"
                >
                  {creating && <Loader2 className="w-4 h-4 animate-spin" />}
                  {creating ? '创建中...' : '创建项目'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
