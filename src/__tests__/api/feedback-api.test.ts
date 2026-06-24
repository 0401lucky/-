import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { GET as userListGET, POST as userCreatePOST } from '@/app/api/feedback/route';
import { GET as userDetailGET } from '@/app/api/feedback/[id]/route';
import { POST as userMessagePOST } from '@/app/api/feedback/[id]/messages/route';
import { GET as adminListGET } from '@/app/api/admin/feedback/route';
import {
  DELETE as adminDetailDELETE,
  PATCH as adminDetailPATCH,
} from '@/app/api/admin/feedback/[id]/route';
import { POST as adminReplyPOST } from '@/app/api/admin/feedback/[id]/messages/route';
import { getAuthUser, isAdmin } from '@/lib/auth';
import {
  addFeedbackMessage,
  createFeedback,
  deleteFeedback,
  getAllFeedbackMessages,
  getFeedbackById,
  getFeedbackFirstMessage,
  getFeedbackLikeState,
  getFeedbackLatestAdminReply,
  getFeedbackMessageCount,
  listAllFeedback,
  updateFeedbackStatus,
} from '@/lib/feedback';
import { checkRateLimit } from '@/lib/rate-limit';

vi.mock('@/lib/auth', () => ({
  getAuthUser: vi.fn(),
  isAdmin: vi.fn(),
}));

vi.mock('@/lib/feedback', () => ({
  createFeedback: vi.fn(),
  getAllFeedbackMessages: vi.fn(),
  getFeedbackById: vi.fn(),
  getFeedbackFirstMessage: vi.fn(),
  getFeedbackMessages: vi.fn(),
  getFeedbackLikeState: vi.fn(),
  getFeedbackLatestAdminReply: vi.fn(),
  getFeedbackMessageCount: vi.fn(),
  toggleFeedbackLike: vi.fn(),
  addFeedbackMessage: vi.fn(),
  updateFeedbackStatus: vi.fn(),
  deleteFeedback: vi.fn(),
  listUserFeedback: vi.fn(),
  listAllFeedback: vi.fn(),
}));

vi.mock('@/lib/feedback-author', () => ({
  attachFeedbackAuthorProfile: vi.fn(async (item: { username: string }) => ({
    ...item,
    displayName: item.username,
    avatarUrl: null,
  })),
  attachFeedbackAuthorProfiles: vi.fn(async (items) =>
    items.map((item: { username: string }) => ({
      ...item,
      displayName: item.username,
      avatarUrl: null,
    }))
  ),
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
  const mockListAllFeedback = vi.mocked(listAllFeedback);
  const mockGetAllFeedbackMessages = vi.mocked(getAllFeedbackMessages);
  const mockGetFeedbackById = vi.mocked(getFeedbackById);
  const mockGetFeedbackFirstMessage = vi.mocked(getFeedbackFirstMessage);
  const mockGetFeedbackLikeState = vi.mocked(getFeedbackLikeState);
  const mockGetFeedbackLatestAdminReply = vi.mocked(getFeedbackLatestAdminReply);
  const mockGetFeedbackMessageCount = vi.mocked(getFeedbackMessageCount);
  const mockUpdateFeedbackStatus = vi.mocked(updateFeedbackStatus);
  const mockDeleteFeedback = vi.mocked(deleteFeedback);
  const mockAddFeedbackMessage = vi.mocked(addFeedbackMessage);
  const mockCreateFeedback = vi.mocked(createFeedback);
  const mockCheckRateLimit = vi.mocked(checkRateLimit);

  beforeEach(() => {
    vi.clearAllMocks();
    mockCheckRateLimit.mockResolvedValue({
      success: true,
      remaining: 10,
      resetAt: 0,
    });
    mockGetFeedbackLikeState.mockResolvedValue({
      likeCount: 0,
      likedByMe: false,
    });
    mockListAllFeedback.mockResolvedValue({
      items: [],
      pagination: {
        page: 1,
        limit: 5,
        total: 0,
        totalPages: 1,
        hasMore: false,
      },
    });
    mockGetAllFeedbackMessages.mockResolvedValue([]);
    mockGetFeedbackFirstMessage.mockResolvedValue(null);
    mockGetFeedbackLatestAdminReply.mockResolvedValue(null);
    mockGetFeedbackMessageCount.mockResolvedValue(0);
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

  it('用户不能查看其他人的匿名反馈详情', async () => {
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
      anonymous: true,
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
    expect(mockGetAllFeedbackMessages).not.toHaveBeenCalled();
  });

  it('反馈墙列表返回完整首条反馈和真实评论数', async () => {
    mockGetAuthUser.mockResolvedValue({
      id: 1,
      username: 'viewer',
      displayName: 'Viewer',
      isAdmin: false,
    });
    mockListAllFeedback.mockResolvedValue({
      items: [
        {
          id: 'fb-wall-1',
          userId: 2,
          username: 'feedback-user',
          status: 'open',
          createdAt: 1,
          updatedAt: 2,
        },
      ],
      pagination: {
        page: 1,
        limit: 5,
        total: 1,
        totalPages: 1,
        hasMore: false,
      },
    });
    mockGetFeedbackFirstMessage.mockResolvedValue({
      id: 'msg-first',
      feedbackId: 'fb-wall-1',
      role: 'user',
      content: '第一行完整反馈\n第二行也要显示',
      createdAt: 1,
      createdBy: 'feedback-user',
    });
    mockGetFeedbackLatestAdminReply.mockResolvedValue({
      id: 'msg-admin',
      feedbackId: 'fb-wall-1',
      role: 'admin',
      content: '管理员完整回复',
      createdAt: 3,
      createdBy: 'admin',
    });
    mockGetFeedbackMessageCount.mockResolvedValue(26);
    mockGetFeedbackLikeState.mockResolvedValue({
      likeCount: 3,
      likedByMe: true,
    });

    const response = await userListGET(
      new NextRequest('http://localhost/api/feedback?scope=wall&page=1&limit=5&status=open')
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(mockListAllFeedback).toHaveBeenCalledWith({
      page: 1,
      limit: 5,
      status: 'open',
      publicOnly: true,
    });
    expect(data.items[0]).toMatchObject({
      id: 'fb-wall-1',
      firstMessage: {
        content: '第一行完整反馈\n第二行也要显示',
      },
      latestAdminReply: {
        content: '管理员完整回复',
      },
      replyCount: 25,
      likeCount: 3,
      likedByMe: true,
    });
    expect(data.items[0]).not.toHaveProperty('contact');
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
        headers: {
          'Content-Type': 'application/json',
          'sec-fetch-site': 'same-origin',
        },
        body: JSON.stringify({ status: 'resolved' }),
      }),
      { params: Promise.resolve({ id: 'fb-2' }) }
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.feedback.status).toBe('resolved');
  });

  it('管理员可以把已关闭反馈重新改为待处理', async () => {
    mockGetAuthUser.mockResolvedValue({
      id: 99,
      username: 'admin',
      displayName: 'Admin',
      isAdmin: true,
    });
    mockIsAdmin.mockReturnValue(true);
    mockUpdateFeedbackStatus.mockResolvedValue({
      id: 'fb-closed',
      userId: 10,
      username: 'normal-user',
      status: 'open',
      createdAt: 1,
      updatedAt: 3,
    });

    const response = await adminDetailPATCH(
      new NextRequest('http://localhost/api/admin/feedback/fb-closed', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'sec-fetch-site': 'same-origin',
        },
        body: JSON.stringify({ status: 'open' }),
      }),
      { params: Promise.resolve({ id: 'fb-closed' }) }
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(mockUpdateFeedbackStatus).toHaveBeenCalledWith('fb-closed', 'open');
    expect(data.feedback.status).toBe('open');
  });

  it('管理员可以删除反馈', async () => {
    mockGetAuthUser.mockResolvedValue({
      id: 99,
      username: 'admin',
      displayName: 'Admin',
      isAdmin: true,
    });
    mockIsAdmin.mockReturnValue(true);
    mockDeleteFeedback.mockResolvedValue(true);

    const response = await adminDetailDELETE(
      new NextRequest('http://localhost/api/admin/feedback/fb-delete', {
        method: 'DELETE',
        headers: {
          'sec-fetch-site': 'same-origin',
        },
      }),
      { params: Promise.resolve({ id: 'fb-delete' }) }
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.message).toBe('反馈已删除');
    expect(mockDeleteFeedback).toHaveBeenCalledWith('fb-delete');
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
        headers: {
          'Content-Type': 'application/json',
          'sec-fetch-site': 'same-origin',
        },
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
      'admin',
      []
    );
  });

  it('管理员可以回复带视频的反馈评论', async () => {
    mockGetAuthUser.mockResolvedValue({
      id: 1,
      username: 'admin',
      displayName: 'Admin',
      isAdmin: true,
    });
    mockIsAdmin.mockReturnValue(true);
    mockGetFeedbackById.mockResolvedValue({
      id: 'fb-admin-video',
      userId: 10,
      username: 'feedback-user',
      status: 'open',
      createdAt: 1,
      updatedAt: 1,
    });
    mockAddFeedbackMessage.mockResolvedValue({
      feedback: {
        id: 'fb-admin-video',
        userId: 10,
        username: 'feedback-user',
        status: 'processing',
        createdAt: 1,
        updatedAt: 2,
      },
      message: {
        id: 'msg-admin-video',
        feedbackId: 'fb-admin-video',
        role: 'admin',
        content: '看一下这个录屏',
        images: [
          {
            dataUrl: '/api/feedback/images/feedback/20260520/admin/admin.mp4',
            mimeType: 'video/mp4',
            size: 5,
            name: 'admin.mp4',
            kind: 'video',
          },
        ],
        createdAt: 2,
        createdBy: 'admin',
      },
    });

    const response = await adminReplyPOST(
      new NextRequest('http://localhost/api/admin/feedback/fb-admin-video/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'sec-fetch-site': 'same-origin',
        },
        body: JSON.stringify({
          content: '看一下这个录屏',
          images: [
            {
              dataUrl: 'data:video/mp4;base64,aGVsbG8=',
              name: 'admin.mp4',
            },
          ],
        }),
      }),
      { params: Promise.resolve({ id: 'fb-admin-video' }) }
    );
    const data = await response.json();

    expect(response.status).toBe(201);
    expect(data.success).toBe(true);
    expect(mockAddFeedbackMessage).toHaveBeenCalledWith(
      'fb-admin-video',
      'admin',
      '看一下这个录屏',
      'admin',
      [
        {
          dataUrl: 'data:video/mp4;base64,aGVsbG8=',
          mimeType: 'video/mp4',
          size: 5,
          name: 'admin.mp4',
          kind: 'video',
        },
      ]
    );
  });

  it('用户可以提交带图片的新反馈', async () => {
    mockGetAuthUser.mockResolvedValue({
      id: 10,
      username: 'normal-user',
      displayName: 'Normal User',
      isAdmin: false,
    });
    mockCreateFeedback.mockResolvedValue({
      feedback: {
        id: 'fb-image',
        userId: 10,
        username: 'normal-user',
        status: 'open',
        createdAt: 1,
        updatedAt: 1,
      },
      message: {
        id: 'msg-image',
        feedbackId: 'fb-image',
        role: 'user',
        content: '截图反馈',
        images: [
          {
            dataUrl: '/api/feedback/images/feedback/20260520/user/img.png',
            mimeType: 'image/png',
            size: 5,
            name: 'bug.png',
          },
        ],
        createdAt: 1,
        createdBy: 'normal-user',
      },
    });

    const response = await userCreatePOST(
      new NextRequest('http://localhost/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: 'http://localhost' },
        body: JSON.stringify({
          content: '截图反馈',
          images: [
            {
              dataUrl: 'data:image/png;base64,aGVsbG8=',
              name: 'bug.png',
            },
          ],
        }),
      })
    );
    const data = await response.json();

    expect(response.status).toBe(201);
    expect(data.success).toBe(true);
    expect(mockCreateFeedback).toHaveBeenCalledWith(
      10,
      'normal-user',
      '截图反馈',
      undefined,
      undefined,
      [
        {
          dataUrl: 'data:image/png;base64,aGVsbG8=',
          mimeType: 'image/png',
          size: 5,
          name: 'bug.png',
          kind: 'image',
        },
      ],
      false
    );
  });

  it('用户可以提交带标题的新反馈', async () => {
    mockGetAuthUser.mockResolvedValue({
      id: 10,
      username: 'normal-user',
      displayName: 'Normal User',
      isAdmin: false,
    });
    mockCreateFeedback.mockResolvedValue({
      feedback: {
        id: 'fb-title',
        userId: 10,
        username: 'normal-user',
        title: '登录页按钮错位',
        status: 'open',
        createdAt: 1,
        updatedAt: 1,
      },
      message: {
        id: 'msg-title',
        feedbackId: 'fb-title',
        role: 'user',
        content: '按钮在移动端会超出屏幕',
        createdAt: 1,
        createdBy: 'normal-user',
      },
    });

    const response = await userCreatePOST(
      new NextRequest('http://localhost/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: 'http://localhost' },
        body: JSON.stringify({
          title: '  登录页按钮错位  ',
          content: '按钮在移动端会超出屏幕',
        }),
      })
    );
    const data = await response.json();

    expect(response.status).toBe(201);
    expect(data.success).toBe(true);
    expect(data.feedback.title).toBe('登录页按钮错位');
    expect(mockCreateFeedback).toHaveBeenCalledWith(
      10,
      'normal-user',
      '按钮在移动端会超出屏幕',
      '登录页按钮错位',
      undefined,
      [],
      false
    );
  });

  it('用户提交过长标题时返回 400', async () => {
    mockGetAuthUser.mockResolvedValue({
      id: 10,
      username: 'normal-user',
      displayName: 'Normal User',
      isAdmin: false,
    });

    const response = await userCreatePOST(
      new NextRequest('http://localhost/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: 'http://localhost' },
        body: JSON.stringify({
          title: '一'.repeat(81),
          content: '正文正常',
        }),
      })
    );
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.success).toBe(false);
    expect(data.message).toBe('反馈标题不能超过 80 字');
    expect(mockCreateFeedback).not.toHaveBeenCalled();
  });

  it('用户可以发布带图片的反馈评论', async () => {
    mockGetAuthUser.mockResolvedValue({
      id: 10,
      username: 'normal-user',
      displayName: 'Normal User',
      isAdmin: false,
    });
    mockGetFeedbackById.mockResolvedValue({
      id: 'fb-4',
      userId: 10,
      username: 'normal-user',
      status: 'open',
      createdAt: 1,
      updatedAt: 1,
    });
    mockAddFeedbackMessage.mockResolvedValue({
      feedback: {
        id: 'fb-4',
        userId: 10,
        username: 'normal-user',
        status: 'open',
        createdAt: 1,
        updatedAt: 2,
      },
      message: {
        id: 'msg-2',
        feedbackId: 'fb-4',
        role: 'user',
        content: '补充截图',
        images: [
          {
            dataUrl: '/api/feedback/images/feedback/20260520/user/img.png',
            mimeType: 'image/png',
            size: 5,
            name: 'reply.png',
          },
        ],
        createdAt: 2,
        createdBy: 'normal-user',
      },
    });

    const response = await userMessagePOST(
      new NextRequest('http://localhost/api/feedback/fb-4/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: 'http://localhost' },
        body: JSON.stringify({
          content: '补充截图',
          images: [
            {
              dataUrl: 'data:image/png;base64,aGVsbG8=',
              name: 'reply.png',
            },
          ],
        }),
      }),
      { params: Promise.resolve({ id: 'fb-4' }) }
    );
    const data = await response.json();

    expect(response.status).toBe(201);
    expect(data.success).toBe(true);
    expect(mockAddFeedbackMessage).toHaveBeenCalledWith(
      'fb-4',
      'user',
      '补充截图',
      'normal-user',
      [
        {
          dataUrl: 'data:image/png;base64,aGVsbG8=',
          mimeType: 'image/png',
          size: 5,
          name: 'reply.png',
          kind: 'image',
        },
      ]
    );
  });

  it('用户可以提交带视频的新反馈', async () => {
    mockGetAuthUser.mockResolvedValue({
      id: 10,
      username: 'normal-user',
      displayName: 'Normal User',
      isAdmin: false,
    });
    mockCreateFeedback.mockResolvedValue({
      feedback: {
        id: 'fb-video',
        userId: 10,
        username: 'normal-user',
        status: 'open',
        createdAt: 1,
        updatedAt: 1,
      },
      message: {
        id: 'msg-video',
        feedbackId: 'fb-video',
        role: 'user',
        content: '视频反馈',
        images: [
          {
            dataUrl: '/api/feedback/images/feedback/20260520/user/clip.mp4',
            mimeType: 'video/mp4',
            size: 5,
            name: 'clip.mp4',
            kind: 'video',
          },
        ],
        createdAt: 1,
        createdBy: 'normal-user',
      },
    });

    const response = await userCreatePOST(
      new NextRequest('http://localhost/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: 'http://localhost' },
        body: JSON.stringify({
          content: '视频反馈',
          images: [
            {
              dataUrl: 'data:video/mp4;base64,aGVsbG8=',
              name: 'clip.mp4',
            },
          ],
        }),
      })
    );
    const data = await response.json();

    expect(response.status).toBe(201);
    expect(data.success).toBe(true);
    expect(mockCreateFeedback).toHaveBeenCalledWith(
      10,
      'normal-user',
      '视频反馈',
      undefined,
      undefined,
      [
        {
          dataUrl: 'data:video/mp4;base64,aGVsbG8=',
          mimeType: 'video/mp4',
          size: 5,
          name: 'clip.mp4',
          kind: 'video',
        },
      ],
      false
    );
  });

  it('用户可以发布带视频的反馈评论', async () => {
    mockGetAuthUser.mockResolvedValue({
      id: 10,
      username: 'normal-user',
      displayName: 'Normal User',
      isAdmin: false,
    });
    mockGetFeedbackById.mockResolvedValue({
      id: 'fb-video-reply',
      userId: 10,
      username: 'normal-user',
      status: 'open',
      createdAt: 1,
      updatedAt: 1,
    });
    mockAddFeedbackMessage.mockResolvedValue({
      feedback: {
        id: 'fb-video-reply',
        userId: 10,
        username: 'normal-user',
        status: 'open',
        createdAt: 1,
        updatedAt: 2,
      },
      message: {
        id: 'msg-video-reply',
        feedbackId: 'fb-video-reply',
        role: 'user',
        content: '补充视频',
        images: [
          {
            dataUrl: '/api/feedback/images/feedback/20260520/user/reply.webm',
            mimeType: 'video/webm',
            size: 5,
            name: 'reply.webm',
            kind: 'video',
          },
        ],
        createdAt: 2,
        createdBy: 'normal-user',
      },
    });

    const response = await userMessagePOST(
      new NextRequest('http://localhost/api/feedback/fb-video-reply/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: 'http://localhost' },
        body: JSON.stringify({
          content: '补充视频',
          images: [
            {
              dataUrl: 'data:video/webm;base64,aGVsbG8=',
              name: 'reply.webm',
            },
          ],
        }),
      }),
      { params: Promise.resolve({ id: 'fb-video-reply' }) }
    );
    const data = await response.json();

    expect(response.status).toBe(201);
    expect(data.success).toBe(true);
    expect(mockAddFeedbackMessage).toHaveBeenCalledWith(
      'fb-video-reply',
      'user',
      '补充视频',
      'normal-user',
      [
        {
          dataUrl: 'data:video/webm;base64,aGVsbG8=',
          mimeType: 'video/webm',
          size: 5,
          name: 'reply.webm',
          kind: 'video',
        },
      ]
    );
  });
});
