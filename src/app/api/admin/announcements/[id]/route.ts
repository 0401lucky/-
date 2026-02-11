import { NextRequest, NextResponse } from 'next/server';
import { archiveAnnouncement, getAnnouncementById, updateAnnouncement } from '@/lib/announcements';
import { withAdmin } from '@/lib/api-guards';
import { withRateLimit } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

export const PATCH = withAdmin(
  async (
    request: NextRequest,
    user,
    context: { params: Promise<{ id: string }> }
  ) => {
    try {
      const limited = await withRateLimit('announcements:admin', user.id);
      if (limited) return limited;

      const { id } = await context.params;
      const body = (await request.json().catch(() => null)) as {
        title?: unknown;
        content?: unknown;
        status?: unknown;
      } | null;

      const updates: {
        title?: string;
        content?: string;
        status?: 'draft' | 'published' | 'archived';
      } = {};

      if (typeof body?.title === 'string') updates.title = body.title;
      if (typeof body?.content === 'string') updates.content = body.content;
      if (body?.status === 'draft' || body?.status === 'published' || body?.status === 'archived') {
        updates.status = body.status;
      }

      const result = await updateAnnouncement(
        id,
        updates,
        { id: user.id, username: user.username }
      );

      if (!result) {
        return NextResponse.json({ success: false, message: '公告不存在' }, { status: 404 });
      }

      return NextResponse.json({
        success: true,
        message: '公告更新成功',
        data: result,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : '更新公告失败';
      return NextResponse.json({ success: false, message }, { status: 400 });
    }
  },
  { forbiddenMessage: '无权限' }
);

export const DELETE = withAdmin(
  async (
    _request: NextRequest,
    user,
    context: { params: Promise<{ id: string }> }
  ) => {
    try {
      const limited = await withRateLimit('announcements:admin', user.id);
      if (limited) return limited;

      const { id } = await context.params;
      const exists = await getAnnouncementById(id);
      if (!exists) {
        return NextResponse.json({ success: false, message: '公告不存在' }, { status: 404 });
      }

      const archived = await archiveAnnouncement(
        id,
        { id: user.id, username: user.username }
      );

      return NextResponse.json({
        success: true,
        message: '公告已归档',
        data: { announcement: archived },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : '删除公告失败';
      return NextResponse.json({ success: false, message }, { status: 400 });
    }
  },
  { forbiddenMessage: '无权限' }
);
