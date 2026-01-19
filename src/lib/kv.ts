import { kv } from "@vercel/kv";

// 项目接口
export interface Project {
  id: string;
  name: string;
  description: string;
  maxClaims: number;
  claimedCount: number;
  codesCount: number;
  status: "active" | "paused" | "exhausted";
  createdAt: number;
  createdBy: string;
}

// 领取记录
export interface ClaimRecord {
  id: string;
  projectId: string;
  userId: number;
  username: string;
  code: string;
  claimedAt: number;
}

// 项目操作
export async function createProject(project: Project): Promise<void> {
  await kv.set(`projects:${project.id}`, project);
  await kv.lpush("project:list", project.id);
}

export async function getProject(projectId: string): Promise<Project | null> {
  return await kv.get<Project>(`projects:${projectId}`);
}

export async function updateProject(projectId: string, updates: Partial<Project>): Promise<void> {
  const project = await getProject(projectId);
  if (project) {
    await kv.set(`projects:${projectId}`, { ...project, ...updates });
  }
}

export async function getAllProjects(): Promise<Project[]> {
  const projectIds = await kv.lrange<string>("project:list", 0, -1);
  const projects: Project[] = [];
  
  for (const id of projectIds) {
    const project = await getProject(id);
    if (project) {
      projects.push(project);
    }
  }
  
  return projects;
}

export async function deleteProject(projectId: string): Promise<void> {
  await kv.del(`projects:${projectId}`);
  await kv.del(`codes:available:${projectId}`);
  await kv.lrem("project:list", 0, projectId);
}

// 兑换码操作
export async function addCodesToProject(projectId: string, codes: string[]): Promise<number> {
  if (codes.length === 0) return 0;
  
  const added = await kv.lpush(`codes:available:${projectId}`, ...codes);
  const project = await getProject(projectId);
  
  if (project) {
    await updateProject(projectId, {
      codesCount: project.codesCount + codes.length,
    });
  }
  
  return added;
}

export async function getAvailableCodesCount(projectId: string): Promise<number> {
  return await kv.llen(`codes:available:${projectId}`);
}

export async function claimCode(projectId: string, userId: number, username: string): Promise<{ success: boolean; code?: string; message: string }> {
  // 检查是否已领取
  const existingClaim = await kv.get<ClaimRecord>(`claimed:${projectId}:${userId}`);
  if (existingClaim) {
    return {
      success: true,
      code: existingClaim.code,
      message: "你已经领取过了",
    };
  }

  // 获取项目
  const project = await getProject(projectId);
  if (!project) {
    return { success: false, message: "项目不存在" };
  }

  if (project.status === "paused") {
    return { success: false, message: "该项目已暂停领取" };
  }

  if (project.status === "exhausted" || project.claimedCount >= project.maxClaims) {
    return { success: false, message: "已达到领取上限" };
  }

  // 取出一个兑换码
  const code = await kv.rpop<string>(`codes:available:${projectId}`);
  if (!code) {
    await updateProject(projectId, { status: "exhausted" });
    return { success: false, message: "兑换码已领完" };
  }

  // 记录领取
  const record: ClaimRecord = {
    id: `claim_${Date.now()}`,
    projectId,
    userId,
    username,
    code,
    claimedAt: Date.now(),
  };

  await kv.set(`claimed:${projectId}:${userId}`, record);
  await kv.lpush(`records:${projectId}`, record);

  // 更新项目统计
  const newClaimedCount = project.claimedCount + 1;
  await updateProject(projectId, {
    claimedCount: newClaimedCount,
    status: newClaimedCount >= project.maxClaims ? "exhausted" : project.status,
  });

  return {
    success: true,
    code,
    message: "领取成功",
  };
}

export async function getClaimRecord(projectId: string, userId: number): Promise<ClaimRecord | null> {
  return await kv.get<ClaimRecord>(`claimed:${projectId}:${userId}`);
}

export async function getProjectRecords(projectId: string, start = 0, end = 49): Promise<ClaimRecord[]> {
  return await kv.lrange<ClaimRecord>(`records:${projectId}`, start, end);
}
