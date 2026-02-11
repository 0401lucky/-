import { NextRequest, NextResponse } from 'next/server';
import { createAnnouncement, listAnnouncementsForAdmin } from '@/lib/announcements';
import { withAdmin } from '@/lib/api-guards';
import { withRateLimit } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

export const GET = withAdmin(
  async (request: NextRequest, user) => {
    try {
      const limited = await withRateLimit('announcements:admin', user.id);
      if (limited) return limited;

      const { searchParams } = new URL(request.url);
      const pageRaw = Number(searchParams.get('page') ?? 1);
      const limitRaw = Number(searchParams.get('limit') ?? 20);
      const statusRaw = searchParams.get('status');

      const page = Number.isFinite(pageRaw) ? pageRaw : 1;
      const limit = Number.isFinite(limitRaw) ? limitRaw : 20;
      const status =
        statusRaw === 'draft' || statusRaw === 'published' || statusRaw === 'archived'
          ? statusRaw
          : 'all';

      const result = await listAnnouncementsForAdmin({ page, limit, status });

      return NextResponse.json({
        success: true,
        data: result,
      });
    } catch (error) {
      console.error('Admin list announcements error:', error);
      return NextResponse.json({ success: false, message: '获取公告失败' }, { status: 500 });
    }
  },
  { forbiddenMessage: '无权限' }
);

export const POST = withAdmin(
  async (request: NextRequest, user) => {
    try {
      const limited = await withRateLimit('announcements:admin', user.id);
      if (limited) return limited;

      const body = (await request.json().catch(() => null)) as {
        title?: unknown;
        content?: unknown;
        status?: unknown;
      } | null;

      const title = typeof body?.title === 'string' ? body.title : '';
      const content = typeof body?.content === 'string' ? body.content : '';
      const status =
        body?.status === 'draft' || body?.status === 'published' || body?.status === 'archived'
          ? body.status
          : 'published';

      const result = await createAnnouncement(
        { title, content, status },
        { id: user.id, username: user.username }
      );

      return NextResponse.json(
        {
          success: true,
          message: '公告创建成功',
          data: result,
        },
        { status: 201 }
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : '创建公告失败';
      return NextResponse.json({ success: false, message }, { status: 400 });
    }
  },
  { forbiddenMessage: '无权限' }
);
