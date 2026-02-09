import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { GET as userListGET } from '@/app/api/feedback/route';
import { GET as userDetailGET } from '@/app/api/feedback/[id]/route';
import { GET as adminListGET } from '@/app/api/admin/feedback/route';
import { PATCH as adminDetailPATCH } from '@/app/api/admin/feedback/[id]/route';
import { POST as adminReplyPOST } from '@/app/api/admin/feedback/[id]/messages/route';
import { getAuthUser, isAdmin } from '@/lib/auth';
import {
  addFeedbackMessage,
  getFeedbackById,
  getFeedbackMessages,
  updateFeedbackStatus,
} from '@/lib/feedback';
import { checkRateLimit } from '@/lib/rate-limit';

vi.mock('@/lib/auth', () => ({
  getAuthUser: vi.fn(),
  isAdmin: vi.fn(),
}));

vi.mock('@/lib/feedback', () => ({
  createFeedback: vi.fn(),
  getFeedbackById: vi.fn(),
  getFeedbackMessages: vi.fn(),
  addFeedbackMessage: vi.fn(),
  updateFeedbackStatus: vi.fn(),
  listUserFeedback: vi.fn(),
  listAllFeedback: vi.fn(),
}));

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: vi.fn(),
  rateLimitResponse: vi.fn(() =>
    NextResponse.json(
      { success: false, message: '请求过于频繁，请稍后再试' },
      { status: 429 }
    )
  ),
}));

describe('Feedback API Permission & Flow', () => {
  const mockGetAuthUser = vi.mocked(getAuthUser);
  const mockIsAdmin = vi.mocked(isAdmin);
  const mockGetFeedbackById = vi.mocked(getFeedbackById);
  const mockGetFeedbackMessages = vi.mocked(getFeedbackMessages);
  const mockUpdateFeedbackStatus = vi.mocked(updateFeedbackStatus);
  const mockAddFeedbackMessage = vi.mocked(addFeedbackMessage);
  const mockCheckRateLimit = vi.mocked(checkRateLimit);

  beforeEach(() => {
    vi.clearAllMocks();
    mockCheckRateLimit.mockResolvedValue({
      success: true,
      remaining: 10,
      resetAt: 0,
    });
  });

  it('用户未登录时无法访问反馈列表', async () => {
    mockGetAuthUser.mockResolvedValue(null);

    const response = await userListGET(
      new NextRequest('http://localhost/api/feedback')
    );
    const data = await response.json();

    expect(response.status).toBe(401);
    expect(data.success).toBe(false);
  });

  it('用户不能查看其他人的反馈详情', async () => {
    mockGetAuthUser.mockResolvedValue({
      id: 1,
      username: 'user-a',
      displayName: 'User A',
      isAdmin: false,
    });
    mockGetFeedbackById.mockResolvedValue({
      id: 'fb-1',
      userId: 2,
      username: 'user-b',
      status: 'open',
      createdAt: 1,
      updatedAt: 1,
    });

    const response = await userDetailGET(
      new NextRequest('http://localhost/api/feedback/fb-1'),
      { params: Promise.resolve({ id: 'fb-1' }) }
    );
    const data = await response.json();

    expect(response.status).toBe(403);
    expect(data.success).toBe(false);
    expect(mockGetFeedbackMessages).not.toHaveBeenCalled();
  });

  it('非管理员无法访问管理员反馈列表接口', async () => {
    mockGetAuthUser.mockResolvedValue({
      id: 10,
      username: 'normal-user',
      displayName: 'Normal User',
      isAdmin: false,
    });
    mockIsAdmin.mockReturnValue(false);

    const response = await adminListGET(
      new NextRequest('http://localhost/api/admin/feedback')
    );
    const data = await response.json();

    expect(response.status).toBe(403);
    expect(data.success).toBe(false);
  });

  it('管理员可以更新反馈状态', async () => {
    mockGetAuthUser.mockResolvedValue({
      id: 99,
      username: 'admin',
      displayName: 'Admin',
      isAdmin: true,
    });
    mockIsAdmin.mockReturnValue(true);
    mockUpdateFeedbackStatus.mockResolvedValue({
      id: 'fb-2',
      userId: 10,
      username: 'normal-user',
      status: 'resolved',
      createdAt: 1,
      updatedAt: 2,
    });

    const response = await adminDetailPATCH(
      new NextRequest('http://localhost/api/admin/feedback/fb-2', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'resolved' }),
      }),
      { params: Promise.resolve({ id: 'fb-2' }) }
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.feedback.status).toBe('resolved');
  });

  it('管理员可以回复反馈', async () => {
    mockGetAuthUser.mockResolvedValue({
      id: 99,
      username: 'admin',
      displayName: 'Admin',
      isAdmin: true,
    });
    mockIsAdmin.mockReturnValue(true);
    mockGetFeedbackById.mockResolvedValue({
      id: 'fb-3',
      userId: 12,
      username: 'feedback-user',
      status: 'processing',
      createdAt: 1,
      updatedAt: 2,
    });
    mockAddFeedbackMessage.mockResolvedValue({
      feedback: {
        id: 'fb-3',
        userId: 12,
        username: 'feedback-user',
        status: 'processing',
        createdAt: 1,
        updatedAt: 3,
      },
      message: {
        id: 'msg-1',
        feedbackId: 'fb-3',
        role: 'admin',
        content: '我们已收到，会尽快处理',
        createdAt: 3,
        createdBy: 'admin',
      },
    });

    const response = await adminReplyPOST(
      new NextRequest('http://localhost/api/admin/feedback/fb-3/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: '我们已收到，会尽快处理' }),
      }),
      { params: Promise.resolve({ id: 'fb-3' }) }
    );
    const data = await response.json();

    expect(response.status).toBe(201);
    expect(data.success).toBe(true);
    expect(mockAddFeedbackMessage).toHaveBeenCalledWith(
      'fb-3',
      'admin',
      '我们已收到，会尽快处理',
      'admin'
    );
  });
});
