'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import {
  FEEDBACK_MEDIA_ACCEPT,
  FEEDBACK_MEDIA_MIME_TYPES,
  MAX_FEEDBACK_IMAGE_BYTES,
  MAX_FEEDBACK_IMAGES,
  MAX_FEEDBACK_VIDEO_BYTES,
  isFeedbackVideo,
  type FeedbackImage,
} from '@/lib/feedback-image';
import {
  ArrowLeft,
  ChevronRight,
  Loader2,
  MessageSquareText,
  Plus,
  ThumbsUp,
  User,
} from 'lucide-react';
import SiteSidebar from '@/components/SiteSidebar';
import type { PublicAchievement } from '@/lib/profile-achievements';

type FeedbackStatus = 'open' | 'processing' | 'resolved' | 'closed';
type FeedbackFilterStatus = 'all' | FeedbackStatus;
type FeedbackRole = 'user' | 'admin';

interface UserData {
  id: number;
  username: string;
  displayName: string;
  isAdmin: boolean;
}

interface FeedbackItem {
  id: string;
  userId: number;
  username: string;
  title?: string | null;
  displayName?: string | null;
  avatarUrl?: string | null;
  equippedAchievement?: PublicAchievement | null;
  contact?: string;
  anonymous?: boolean;
  status: FeedbackStatus;
  createdAt: number;
  updatedAt: number;
  latestMessageRole?: FeedbackRole | null;
  latestMessageAt?: number | null;
  firstMessage?: FeedbackMessage | null;
  latestAdminReply?: FeedbackMessage | null;
  replyCount?: number;
  likeCount?: number;
  likedByMe?: boolean;
}

interface FeedbackMessage {
  id: string;
  feedbackId: string;
  role: FeedbackRole;
  content: string;
  images?: FeedbackImage[];
  createdAt: number;
  createdBy: string;
}

interface DraftImage extends FeedbackImage {
  id: string;
}

function getMediaAlt(media: FeedbackImage, fallback: string): string {
  return media.name || (isFeedbackVideo(media) ? fallback.replace('图片', '视频') : fallback);
}

function FeedbackMediaPreview({
  media,
  alt,
  imageClassName,
}: {
  media: FeedbackImage;
  alt: string;
  imageClassName: string;
}) {
  if (isFeedbackVideo(media)) {
    return (
      <video
        src={media.dataUrl}
        controls
        preload="metadata"
        playsInline
        className={imageClassName}
        aria-label={alt}
      />
    );
  }

  return (
    <Image
      src={media.dataUrl}
      alt={alt}
      width={320}
      height={180}
      unoptimized
      className={imageClassName}
    />
  );
}

function FeedbackMediaLink({
  media,
  alt,
  imageClassName,
  onClick,
}: {
  media: FeedbackImage;
  alt: string;
  imageClassName: string;
  onClick?: (event: React.MouseEvent<HTMLElement>) => void;
}) {
  if (isFeedbackVideo(media)) {
    return (
      <video
        src={media.dataUrl}
        controls
        preload="metadata"
        playsInline
        className={imageClassName}
        aria-label={alt}
        onClick={onClick}
      />
    );
  }

  return (
    <a
      href={media.dataUrl}
      target="_blank"
      rel="noreferrer"
      onClick={onClick}
    >
      <FeedbackMediaPreview media={media} alt={alt} imageClassName={imageClassName} />
    </a>
  );
}

const STATUS_LABEL: Record<FeedbackStatus, string> = {
  open: '待处理',
  processing: '处理中',
  resolved: '已解决',
  closed: '已关闭',
};

const WALL_STATUS_CLASS: Record<FeedbackStatus, string> = {
  open: 'status-pending',
  processing: 'status-processing',
  resolved: 'status-resolved',
  closed: 'status-closed',
};

const TARGET_FEEDBACK_IMAGE_BYTES = 384 * 1024;
const MAX_FEEDBACK_IMAGE_DIMENSION = 1280;
const MAX_FEEDBACK_SOURCE_IMAGE_BYTES = 8 * 1024 * 1024;
const COMPRESSIBLE_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);
const MAX_FEEDBACK_TITLE_LENGTH = 80;
const FEEDBACK_PAGE_SIZE = 5;
const COMMENT_PAGE_SIZE = 5;
const FEEDBACK_FILTERS: Array<{ value: FeedbackFilterStatus; label: string }> = [
  { value: 'all', label: '全部反馈' },
  { value: 'open', label: '待处理' },
  { value: 'processing', label: '处理中' },
  { value: 'resolved', label: '已解决' },
  { value: 'closed', label: '已关闭' },
];
const INITIAL_FEEDBACK_PAGES: Record<FeedbackFilterStatus, number> = {
  all: 1,
  open: 1,
  processing: 1,
  resolved: 1,
  closed: 1,
};

function formatFeedbackTime(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;

  if (diff < hour) return `${Math.max(1, Math.floor(diff / minute))} 分钟前`;
  if (diff < day) return `${Math.floor(diff / hour)} 小时前`;
  if (diff < day * 7) return `${Math.floor(diff / day)} 天前`;

  return new Date(timestamp).toLocaleDateString('zh-CN');
}

function resolveFeedbackAuthorName(feedback: FeedbackItem): string {
  return feedback.displayName?.trim() || feedback.username || '用户';
}

function getFeedbackFallbackTitle(message?: FeedbackMessage | null): string {
  return message?.content
    ?.split('\n')
    .map((line) => line.trim())
    .find(Boolean) || '附件反馈';
}

function resolveFeedbackTitle(
  feedback: FeedbackItem,
  message?: FeedbackMessage | null
): string {
  return feedback.title?.trim() || getFeedbackFallbackTitle(message);
}

function FeedbackAuthorAvatar({ feedback }: { feedback: FeedbackItem }) {
  const name = resolveFeedbackAuthorName(feedback);
  const initial = (name[0] || '?').toUpperCase();

  if (feedback.avatarUrl) {
    return (
      <div className="fb-avatar">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={feedback.avatarUrl} alt={name} className="fb-avatar-img" />
      </div>
    );
  }

  return (
    <div className="fb-avatar" aria-label={name}>
      {initial || <User />}
    </div>
  );
}

function FeedbackAchievementBadge({ achievement }: { achievement?: PublicAchievement | null }) {
  if (!achievement) return null;

  return (
    <span className="fb-achievement-badge" title={achievement.desc}>
      <span aria-hidden>{achievement.emoji}</span>
      {achievement.name}
    </span>
  );
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(new Error('读取附件失败'));
    reader.readAsDataURL(file);
  });
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(new Error('读取附件失败'));
    reader.readAsDataURL(blob);
  });
}

function loadImageFromFile(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new window.Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('图片加载失败'));
    };
    image.src = url;
  });
}

function canvasToBlob(canvas: HTMLCanvasElement, mimeType: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), mimeType, quality);
  });
}

async function prepareFeedbackImage(file: File): Promise<{
  dataUrl: string;
  mimeType: string;
  size: number;
}> {
  const sourceMimeType = file.type.toLowerCase();
  if (file.size <= TARGET_FEEDBACK_IMAGE_BYTES || !COMPRESSIBLE_IMAGE_TYPES.has(sourceMimeType)) {
    return {
      dataUrl: await fileToDataUrl(file),
      mimeType: sourceMimeType,
      size: file.size,
    };
  }

  const image = await loadImageFromFile(file);
  const scale = Math.min(
    1,
    MAX_FEEDBACK_IMAGE_DIMENSION / Math.max(image.naturalWidth, image.naturalHeight)
  );
  const width = Math.max(1, Math.round(image.naturalWidth * scale));
  const height = Math.max(1, Math.round(image.naturalHeight * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('图片压缩失败');
  }

  // PNG 截图通常体积较大，统一转成白底 JPEG，降低 JSON 请求体大小。
  const outputMimeType = sourceMimeType === 'image/png' ? 'image/jpeg' : sourceMimeType;
  if (outputMimeType === 'image/jpeg') {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
  }
  ctx.drawImage(image, 0, 0, width, height);

  const qualities = [0.82, 0.72, 0.62, 0.52, 0.42, 0.34];
  let bestBlob: Blob | null = null;
  for (const quality of qualities) {
    const blob = await canvasToBlob(canvas, outputMimeType, quality);
    if (!blob) continue;
    bestBlob = blob;
    if (blob.size <= TARGET_FEEDBACK_IMAGE_BYTES) {
      break;
    }
  }

  if (!bestBlob) {
    throw new Error('图片压缩失败');
  }

  return {
    dataUrl: await blobToDataUrl(bestBlob),
    mimeType: bestBlob.type || outputMimeType,
    size: bestBlob.size,
  };
}

export default function FeedbackPage() {
  const [user, setUser] = useState<UserData | null>(null);
  const [loading, setLoading] = useState(true);
  const [listLoading, setListLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const [feedbackList, setFeedbackList] = useState<FeedbackItem[]>([]);
  const [listPage, setListPage] = useState(1);
  const [listHasMore, setListHasMore] = useState(false);
  const [listTotal, setListTotal] = useState(0);
  const [listTotalPages, setListTotalPages] = useState(1);
  const [filterStatus, setFilterStatus] = useState<FeedbackFilterStatus>('all');
  const [viewMode, setViewMode] = useState<'wall' | 'compose' | 'detail'>('wall');
  const [selectedFeedback, setSelectedFeedback] = useState<FeedbackItem | null>(null);
  const [selectedMessages, setSelectedMessages] = useState<FeedbackMessage[]>([]);
  const [commentPage, setCommentPage] = useState(1);
  const [detailLoading, setDetailLoading] = useState(false);
  const [replyContent, setReplyContent] = useState('');
  const [replyImages, setReplyImages] = useState<DraftImage[]>([]);
  const [replySubmitting, setReplySubmitting] = useState(false);
  const [likeSubmittingId, setLikeSubmittingId] = useState<string | null>(null);

  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [contact, setContact] = useState('');
  const [draftImages, setDraftImages] = useState<DraftImage[]>([]);
  const [isAnonymous, setIsAnonymous] = useState(false);

  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const router = useRouter();
  const listPageByStatusRef = useRef<Record<FeedbackFilterStatus, number>>({
    ...INITIAL_FEEDBACK_PAGES,
  });
  const listRequestIdRef = useRef(0);

  const appendImages = useCallback(
    async (
      files: File[],
      mode: 'draft' | 'reply'
    ) => {
      if (files.length === 0) {
        return;
      }

      const currentImages = mode === 'draft' ? draftImages : replyImages;
      const setImages = mode === 'draft' ? setDraftImages : setReplyImages;

      if (currentImages.length >= MAX_FEEDBACK_IMAGES) {
        setError(`最多上传 ${MAX_FEEDBACK_IMAGES} 个附件`);
        return;
      }

      const available = MAX_FEEDBACK_IMAGES - currentImages.length;
      const nextFiles = files.slice(0, available);

      const newImages: DraftImage[] = [];
      for (const file of nextFiles) {
        const mimeType = file.type.toLowerCase();
        if (!FEEDBACK_MEDIA_MIME_TYPES.includes(mimeType as (typeof FEEDBACK_MEDIA_MIME_TYPES)[number])) {
          setError('仅支持 PNG/JPG/WEBP/GIF 图片和 MP4/WEBM/MOV 视频');
          continue;
        }

        if (mimeType.startsWith('video/')) {
          if (file.size > MAX_FEEDBACK_VIDEO_BYTES) {
            setError(`单个视频不能超过 ${MAX_FEEDBACK_VIDEO_BYTES / 1024 / 1024}MB`);
            continue;
          }

          try {
            newImages.push({
              id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
              dataUrl: await fileToDataUrl(file),
              mimeType,
              size: file.size,
              name: file.name,
              kind: 'video',
            });
          } catch (error) {
            console.error('Read video failed:', error);
            setError('读取视频失败，请换一个视频重试');
          }
          continue;
        }

        if (file.size > MAX_FEEDBACK_SOURCE_IMAGE_BYTES) {
          setError(`单张原图不能超过 ${MAX_FEEDBACK_SOURCE_IMAGE_BYTES / 1024 / 1024}MB`);
          continue;
        }

        try {
          const prepared = await prepareFeedbackImage(file);
          if (prepared.size > MAX_FEEDBACK_IMAGE_BYTES) {
            setError(`压缩后图片仍超过 ${MAX_FEEDBACK_IMAGE_BYTES / 1024 / 1024}MB，请换一张更小的图片`);
            continue;
          }

          newImages.push({
            id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
            dataUrl: prepared.dataUrl,
            mimeType: prepared.mimeType,
            size: prepared.size,
            name: file.name,
            kind: 'image',
          });
        } catch (error) {
          console.error('Prepare image failed:', error);
          setError('处理图片失败，请换一张图片重试');
        }
      }

      if (newImages.length > 0) {
        setImages((prev) => [...prev, ...newImages]);
      }
    },
    [draftImages, replyImages]
  );

  const handleDraftFileChange = async (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    const files = Array.from(event.target.files ?? []);
    if (files.length > 0) {
      await appendImages(files, 'draft');
    }
    event.target.value = '';
  };

  const handleDraftPaste = (event: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const files = Array.from(event.clipboardData.items)
      .filter((item) => item.type.startsWith('image/'))
      .map((item) => item.getAsFile())
      .filter((file): file is File => file !== null);

    if (files.length > 0) {
      event.preventDefault();
      void appendImages(files, 'draft');
    }
  };

  const removeDraftImage = (id: string) => {
    setDraftImages((prev) => prev.filter((image) => image.id !== id));
  };

  const handleReplyFileChange = async (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    const files = Array.from(event.target.files ?? []);
    if (files.length > 0) {
      await appendImages(files, 'reply');
    }
    event.target.value = '';
  };

  const handleReplyPaste = (event: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const files = Array.from(event.clipboardData.items)
      .filter((item) => item.type.startsWith('image/'))
      .map((item) => item.getAsFile())
      .filter((file): file is File => file !== null);

    if (files.length > 0) {
      event.preventDefault();
      void appendImages(files, 'reply');
    }
  };

  const removeReplyImage = (id: string) => {
    setReplyImages((prev) => prev.filter((image) => image.id !== id));
  };

  const loadFeedbackList = useCallback(
    async (options: { page?: number; status?: FeedbackFilterStatus } = {}) => {
      const targetStatus = options.status ?? filterStatus;
      const page = options.page ?? listPageByStatusRef.current[targetStatus] ?? 1;
      const requestId = listRequestIdRef.current + 1;
      listRequestIdRef.current = requestId;

      setListLoading(true);
      setError(null);

      try {
        const statusQuery =
          targetStatus === 'all' ? '' : `&status=${encodeURIComponent(targetStatus)}`;
        const response = await fetch(
          `/api/feedback?scope=wall&page=${page}&limit=${FEEDBACK_PAGE_SIZE}${statusQuery}`,
          { cache: 'no-store' }
        );

        if (response.status === 401) {
          router.push('/login?redirect=/feedback');
          return;
        }

        const data = await response.json();
        if (!response.ok || !data.success) {
          setError(data.message || '获取反馈列表失败');
          return;
        }

        if (requestId !== listRequestIdRef.current) {
          return;
        }

        const items = (data.items as FeedbackItem[]) ?? [];
        const pagination = (data.pagination ?? {}) as {
          page?: number;
          total?: number;
          totalPages?: number;
          hasMore?: boolean;
        };
        const nextPage =
          typeof pagination.page === 'number' ? pagination.page : page;

        listPageByStatusRef.current = {
          ...listPageByStatusRef.current,
          [targetStatus]: nextPage,
        };

        setListPage(nextPage);
        setListHasMore(Boolean(pagination.hasMore));
        setListTotal(typeof pagination.total === 'number' ? pagination.total : items.length);
        setListTotalPages(Math.max(1, typeof pagination.totalPages === 'number' ? pagination.totalPages : 1));
        setFeedbackList(items);
      } catch (fetchError) {
        console.error('Load feedback list failed:', fetchError);
        setError('获取反馈列表失败，请稍后重试');
      } finally {
        if (requestId === listRequestIdRef.current) {
          setListLoading(false);
        }
      }
    },
    [filterStatus, router]
  );

  const goToFeedbackPage = useCallback(async (nextPage: number) => {
    if (listLoading) {
      return;
    }
    const safePage = Math.min(Math.max(1, nextPage), listTotalPages);
    await loadFeedbackList({ page: safePage, status: filterStatus });
  }, [filterStatus, listLoading, listTotalPages, loadFeedbackList]);

  const handleChangeFilterStatus = (nextStatus: FeedbackFilterStatus) => {
    if (nextStatus === filterStatus) {
      return;
    }
    setListPage(listPageByStatusRef.current[nextStatus] ?? 1);
    setListHasMore(false);
    setListTotal(0);
    setListTotalPages(1);
    setFeedbackList([]);
    setFilterStatus(nextStatus);
  };

  useEffect(() => {
    let cancelled = false;

    const bootstrap = async () => {
      try {
        const response = await fetch('/api/auth/me');
        if (!response.ok) {
          router.push('/login?redirect=/feedback');
          return;
        }

        const data = await response.json();
        if (!data.success || !data.user) {
          router.push('/login?redirect=/feedback');
          return;
        }

        if (!cancelled) {
          setUser(data.user as UserData);
        }
      } catch (fetchError) {
        console.error('Bootstrap feedback page failed:', fetchError);
        if (!cancelled) {
          setError('初始化页面失败，请刷新重试');
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void bootstrap();

    return () => {
      cancelled = true;
    };
  }, [router]);

  useEffect(() => {
    if (!user) {
      setFeedbackList([]);
      setListPage(1);
      setListHasMore(false);
      setListTotal(0);
      setListTotalPages(1);
      listPageByStatusRef.current = { ...INITIAL_FEEDBACK_PAGES };
      return;
    }
    void loadFeedbackList({
      page: listPageByStatusRef.current[filterStatus] ?? 1,
      status: filterStatus,
    });
  }, [user, filterStatus, loadFeedbackList]);

  const handleSubmitFeedback = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const trimmedContent = content.trim();
    const trimmedTitle = title.trim();
    if (!trimmedContent && draftImages.length === 0) {
      setError('请填写反馈内容或上传图片/视频');
      return;
    }

    if (trimmedTitle.length > MAX_FEEDBACK_TITLE_LENGTH) {
      setError(`反馈标题不能超过 ${MAX_FEEDBACK_TITLE_LENGTH} 字`);
      return;
    }

    setSubmitting(true);
    setError(null);
    setSuccess(null);

    try {
      const response = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: trimmedTitle || undefined,
          content: trimmedContent,
          contact: contact.trim() || undefined,
          anonymous: isAnonymous,
          images: draftImages.map((image) => ({
            dataUrl: image.dataUrl,
            mimeType: image.mimeType,
            size: image.size,
            name: image.name,
          })),
        }),
      });

      const data = await response.json();
      if (!response.ok || !data.success) {
        setError(data.message || '提交反馈失败');
        return;
      }

      setSuccess('反馈已提交，我们会尽快处理');
      setTitle('');
      setContent('');
      setContact('');
      setDraftImages([]);
      setIsAnonymous(false);
      setViewMode('wall');

      await loadFeedbackList({ page: 1, status: filterStatus });
    } catch (submitError) {
      console.error('Submit feedback failed:', submitError);
      setError('提交反馈失败，请稍后重试');
    } finally {
      setSubmitting(false);
    }
  };

  const handleOpenCompose = () => {
    setError(null);
    setSuccess(null);
    setSelectedFeedback(null);
    setSelectedMessages([]);
    setCommentPage(1);
    setViewMode('compose');
  };

  const handleBackToWall = () => {
    setError(null);
    setSelectedFeedback(null);
    setSelectedMessages([]);
    setCommentPage(1);
    setReplyContent('');
    setReplyImages([]);
    setViewMode('wall');
  };

  const updateFeedbackLikeState = (
    feedbackId: string,
    state: { likeCount: number; likedByMe: boolean }
  ) => {
    setFeedbackList((prev) =>
      prev.map((item) =>
        item.id === feedbackId ? { ...item, ...state } : item
      )
    );
    setSelectedFeedback((prev) =>
      prev?.id === feedbackId ? { ...prev, ...state } : prev
    );
  };

  const handleToggleLike = async (
    feedbackId: string,
    event?: React.MouseEvent<HTMLButtonElement>
  ) => {
    event?.stopPropagation();
    if (likeSubmittingId) {
      return;
    }

    setLikeSubmittingId(feedbackId);
    setError(null);

    try {
      const response = await fetch(`/api/feedback/${feedbackId}/like`, {
        method: 'POST',
      });
      const data = await response.json();
      if (!response.ok || !data.success) {
        setError(data.message || '点赞失败');
        return;
      }

      updateFeedbackLikeState(feedbackId, {
        likeCount: Number(data.likeCount ?? 0),
        likedByMe: Boolean(data.likedByMe),
      });
    } catch (likeError) {
      console.error('Toggle feedback like failed:', likeError);
      setError('点赞失败，请稍后重试');
    } finally {
      setLikeSubmittingId(null);
    }
  };

  const handleOpenDetail = async (feedbackId: string) => {
    setViewMode('detail');
    setDetailLoading(true);
    setError(null);
    setSuccess(null);
    setReplyContent('');
    setReplyImages([]);
    setCommentPage(1);

    try {
      const response = await fetch(`/api/feedback/${feedbackId}`, { cache: 'no-store' });
      const data = await response.json();
      if (!response.ok || !data.success) {
        setError(data.message || '获取反馈详情失败');
        setViewMode('wall');
        return;
      }

      const feedback = data.feedback as FeedbackItem;
      const messages = (data.messages as FeedbackMessage[]) ?? [];
      const nextReplyCount = Math.max(0, messages.length - 1);
      setSelectedFeedback({
        ...feedback,
        replyCount: nextReplyCount,
      });
      setSelectedMessages(messages);
      setCommentPage(1);
      setFeedbackList((prev) =>
        prev.map((item) =>
          item.id === feedback.id
            ? { ...item, ...feedback, replyCount: nextReplyCount }
            : item
        )
      );
    } catch (detailError) {
      console.error('Load feedback detail failed:', detailError);
      setError('获取反馈详情失败，请稍后重试');
      setViewMode('wall');
    } finally {
      setDetailLoading(false);
    }
  };

  const handleSubmitReply = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedFeedback) {
      return;
    }

    const trimmedContent = replyContent.trim();
    if (!trimmedContent && replyImages.length === 0) {
      setError('请填写评论内容或上传图片/视频');
      return;
    }

    setReplySubmitting(true);
    setError(null);
    setSuccess(null);

    try {
      const response = await fetch(`/api/feedback/${selectedFeedback.id}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: trimmedContent,
          images: replyImages.map((image) => ({
            dataUrl: image.dataUrl,
            mimeType: image.mimeType,
            size: image.size,
            name: image.name,
          })),
        }),
      });

      const data = await response.json();
      if (!response.ok || !data.success) {
        setError(data.message || '评论失败');
        return;
      }

      const nextMessages = [
        ...selectedMessages,
        data.feedbackMessage as FeedbackMessage,
      ];
      const nextReplyCount = Math.max(0, nextMessages.length - 1);
      const nextFeedback = {
        ...selectedFeedback,
        ...(data.feedback as Partial<FeedbackItem>),
        replyCount: nextReplyCount,
      };

      setSelectedFeedback(nextFeedback);
      setSelectedMessages(nextMessages);
      setFeedbackList((prev) =>
        prev.map((item) =>
          item.id === selectedFeedback.id
            ? { ...item, ...nextFeedback, replyCount: nextReplyCount }
            : item
        )
      );
      setReplyContent('');
      setReplyImages([]);
      setCommentPage(Math.max(1, Math.ceil(nextReplyCount / COMMENT_PAGE_SIZE)));
      setSuccess('评论已发布');
    } catch (replyError) {
      console.error('Submit feedback reply failed:', replyError);
      setError('评论失败，请稍后重试');
    } finally {
      setReplySubmitting(false);
    }
  };

  const commentMessages = selectedMessages.slice(1);
  const commentTotalPages = Math.max(1, Math.ceil(commentMessages.length / COMMENT_PAGE_SIZE));
  const safeCommentPage = Math.min(commentPage, commentTotalPages);
  const visibleComments = commentMessages.slice(
    (safeCommentPage - 1) * COMMENT_PAGE_SIZE,
    safeCommentPage * COMMENT_PAGE_SIZE
  );
  const firstSelectedMessage = selectedMessages[0] ?? null;
  const selectedFeedbackTitle = selectedFeedback?.title?.trim() ?? '';

  const renderFeedbackPagination = (className = '') => {
    if (listTotalPages <= 1) {
      return null;
    }

    return (
      <div className={`feedback-pagination ${className}`.trim()}>
        <button
          type="button"
          className="feedback-page-btn"
          onClick={() => void goToFeedbackPage(listPage - 1)}
          disabled={listLoading || listPage <= 1}
          aria-label="上一页反馈"
        >
          <ChevronRight />
          上一页
        </button>
        <span className="feedback-page-indicator">
          第
          <strong>{listPage}</strong>
          <span>/</span>
          {listTotalPages}
          页
          <em>（共 {listTotal} 条）</em>
        </span>
        <button
          type="button"
          className="feedback-page-btn"
          onClick={() => void goToFeedbackPage(listPage + 1)}
          disabled={listLoading || !listHasMore}
          aria-label="下一页反馈"
        >
          下一页
          <ChevronRight />
        </button>
      </div>
    );
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="fixed inset-0 -z-10 bg-[radial-gradient(circle_at_15%_50%,rgba(255,228,230,0.8),transparent_48%),radial-gradient(circle_at_85%_30%,rgba(224,231,255,0.8),transparent_48%),radial-gradient(circle_at_50%_90%,rgba(254,243,199,0.8),transparent_48%)] blur-3xl" />
        <Loader2 className="w-8 h-8 animate-spin text-orange-500" />
      </div>
    );
  }

  return (
    <div className="feedback-wall-page">
      <div className="feedback-mesh-bg" />

      <div className="feedback-layout">
        <SiteSidebar activeNav="feedback" />

        <main className={`feedback-panel-right ${viewMode === 'wall' ? 'is-wall-mode' : ''}`}>
          <div className="feedback-header">
            <div>
              <h2 className="feedback-section-title">
                <MessageSquareText />
                用户反馈墙
              </h2>
              <p className="feedback-header-subtitle">您的每一个声音，都在帮助我们变得更好。</p>
            </div>
            <button
              type="button"
              onClick={viewMode === 'compose' ? handleBackToWall : handleOpenCompose}
              className={`feedback-btn-primary ${viewMode === 'compose' ? 'feedback-btn-back' : ''}`}
            >
              {viewMode === 'compose' ? <ArrowLeft /> : <Plus />}
              {viewMode === 'compose' ? '返回' : '我要反馈'}
            </button>
          </div>

          {(error || success) && (
            <div className="feedback-alert-stack">
              {error && <div className="feedback-alert error">{error}</div>}
              {success && <div className="feedback-alert success">{success}</div>}
            </div>
          )}

          {viewMode === 'compose' && (
            <section id="feedback-form" className="feedback-card composer-card composer-only">
              <div className="composer-title-row">
                <div>
                  <h3>提交新反馈</h3>
                  <p>选择公开后会展示在反馈墙，匿名反馈仅管理员可见。</p>
                </div>
                <div className="composer-actions">
                  <label className={`anonymous-toggle ${isAnonymous ? 'is-active' : ''}`}>
                    <input
                      type="checkbox"
                      checked={isAnonymous}
                      onChange={(event) => setIsAnonymous(event.target.checked)}
                    />
                    匿名提交
                  </label>
                  <button type="button" onClick={handleBackToWall} className="feedback-btn-ghost">
                    返回
                  </button>
                </div>
              </div>

              <form className="composer-form" onSubmit={handleSubmitFeedback}>
                <input
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  maxLength={MAX_FEEDBACK_TITLE_LENGTH}
                  placeholder="反馈标题（可选）"
                  className="feedback-input"
                />
                <input
                  value={contact}
                  onChange={(event) => setContact(event.target.value)}
                  maxLength={100}
                  placeholder="联系方式（可选，例如 QQ / 邮箱 / 手机号）"
                  className="feedback-input"
                />
                <textarea
                  value={content}
                  onChange={(event) => setContent(event.target.value)}
                  onPaste={handleDraftPaste}
                  rows={8}
                  maxLength={1000}
                  placeholder="请描述你遇到的问题或建议"
                  className="feedback-textarea"
                />

                <div className="composer-meta-row">
                  <label htmlFor="feedback-create-images" className="feedback-upload-btn">
                    上传图片/视频
                  </label>
                  <input
                    id="feedback-create-images"
                    type="file"
                    accept={FEEDBACK_MEDIA_ACCEPT}
                    multiple
                    className="hidden"
                    onChange={handleDraftFileChange}
                  />
                  <div className="feedback-counter">
                    标题 {title.length}/{MAX_FEEDBACK_TITLE_LENGTH} · 正文 {content.length}/1000 · {draftImages.length}/{MAX_FEEDBACK_IMAGES} 个附件
                  </div>
                </div>

                <div className="feedback-help">
                  支持粘贴截图，也支持 MP4/WEBM/MOV 视频；图片原图单张 ≤ {MAX_FEEDBACK_SOURCE_IMAGE_BYTES / 1024 / 1024}MB，视频单个 ≤ {MAX_FEEDBACK_VIDEO_BYTES / 1024 / 1024}MB
                </div>

                {draftImages.length > 0 && (
                  <div className="feedback-image-grid">
                    {draftImages.map((image) => (
                      <div key={image.id} className="feedback-image-preview">
                        <FeedbackMediaPreview
                          media={image}
                          alt={getMediaAlt(image, '反馈图片')}
                          imageClassName="feedback-preview-image"
                        />
                        <button
                          type="button"
                          onClick={() => removeDraftImage(image.id)}
                          className="feedback-image-remove"
                          aria-label="移除附件"
                        >
                          ×
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                <button type="submit" disabled={submitting} className="feedback-submit-btn">
                  {submitting && <Loader2 />}
                  {submitting ? '提交中...' : isAnonymous ? '匿名提交' : '公开提交'}
                </button>
              </form>
            </section>
          )}

          {viewMode === 'detail' && (
            <section className="feedback-detail-view">
              <button type="button" onClick={handleBackToWall} className="detail-back">
                <ChevronRight />
                返回反馈墙
              </button>

              {detailLoading ? (
                <div className="feedback-empty">
                  <Loader2 className="spin-icon" />
                </div>
              ) : selectedFeedback ? (
                <>
                  <article className="feedback-card wall-card detail-card">
                    <div className="fb-header">
                      <div className="fb-user">
                        <FeedbackAuthorAvatar feedback={selectedFeedback} />
                        <div>
                          <div className="fb-name-line">
                            <h4 className="fb-name">{resolveFeedbackAuthorName(selectedFeedback)}</h4>
                            <FeedbackAchievementBadge achievement={selectedFeedback.equippedAchievement} />
                          </div>
                          <p className="fb-time">
                            {formatFeedbackTime(selectedFeedback.createdAt)} · #{selectedFeedback.id}
                          </p>
                        </div>
                      </div>
                      <div className={`fb-status ${WALL_STATUS_CLASS[selectedFeedback.status]}`}>
                        {STATUS_LABEL[selectedFeedback.status]}
                      </div>
                    </div>

                    <div className="fb-content">
                      {selectedFeedbackTitle && <h3>{selectedFeedbackTitle}</h3>}
                      {firstSelectedMessage?.content && <p>{firstSelectedMessage.content}</p>}
                      {firstSelectedMessage?.images && firstSelectedMessage.images.length > 0 && (
                        <div className="wall-image-grid">
                          {firstSelectedMessage.images.map((image, index) => (
                            <FeedbackMediaLink
                              key={`${firstSelectedMessage.id}-${index}`}
                              media={image}
                              alt={getMediaAlt(image, `反馈图片${index + 1}`)}
                              imageClassName="wall-feedback-image"
                            />
                          ))}
                        </div>
                      )}
                    </div>

                    <div className="fb-footer">
                      <button
                        type="button"
                        onClick={(event) => void handleToggleLike(selectedFeedback.id, event)}
                        disabled={likeSubmittingId === selectedFeedback.id}
                        className={`fb-action-btn like-btn ${selectedFeedback.likedByMe ? 'active' : ''}`}
                      >
                        <ThumbsUp />
                        {selectedFeedback.likeCount ?? 0} 点赞
                      </button>
                      <div className="fb-action-btn">
                        <MessageSquareText />
                        {selectedFeedback.replyCount ?? 0} 条评论
                      </div>
                    </div>
                  </article>

                  <div className="feedback-card comments-card">
                  <div className="comments-title-row">
                    <h3>评论</h3>
                      <span>{commentMessages.length} 条</span>
                  </div>

                  <div className="comment-list">
                      {commentMessages.length === 0 ? (
                        <div className="feedback-empty small">暂无评论</div>
                      ) : (
                        visibleComments.map((message) => (
                          <div key={message.id} className={`comment-bubble ${message.role}`}>
                            <div className="comment-meta">
                              <span>{message.role === 'admin' ? '管理员回复' : message.createdBy}</span>
                              <span>{formatFeedbackTime(message.createdAt)}</span>
                            </div>
                            {message.content && <p>{message.content}</p>}
                            {message.images && message.images.length > 0 && (
                              <div className="wall-image-grid compact">
                                {message.images.map((image, index) => (
                                  <FeedbackMediaLink
                                    key={`${message.id}-${index}`}
                                    media={image}
                                    alt={getMediaAlt(image, `评论图片${index + 1}`)}
                                    imageClassName="wall-feedback-image"
                                  />
                                ))}
                              </div>
                            )}
                          </div>
                        ))
                      )}
                    </div>

                    {commentMessages.length > COMMENT_PAGE_SIZE && (
                      <div className="feedback-pagination compact">
                        <button
                          type="button"
                          className="feedback-page-btn"
                          onClick={() => setCommentPage((prev) => Math.max(1, prev - 1))}
                          disabled={safeCommentPage <= 1}
                          aria-label="上一页评论"
                        >
                          <ChevronRight />
                          上一页
                        </button>
                        <span className="feedback-page-indicator">
                          <strong>{safeCommentPage}</strong>
                          <span>/</span>
                          {commentTotalPages}
                        </span>
                        <button
                          type="button"
                          className="feedback-page-btn"
                          onClick={() => setCommentPage((prev) => Math.min(commentTotalPages, prev + 1))}
                          disabled={safeCommentPage >= commentTotalPages}
                          aria-label="下一页评论"
                        >
                          下一页
                          <ChevronRight />
                        </button>
                      </div>
                    )}

                    <form className="comment-form" onSubmit={handleSubmitReply}>
                      <textarea
                        value={replyContent}
                        onChange={(event) => setReplyContent(event.target.value)}
                        onPaste={handleReplyPaste}
                        rows={4}
                        maxLength={1000}
                        placeholder="写下你的评论"
                        className="feedback-textarea"
                      />
                      {replyImages.length > 0 && (
                        <div className="feedback-image-grid">
                          {replyImages.map((image) => (
                            <div key={image.id} className="feedback-image-preview">
                              <FeedbackMediaPreview
                                media={image}
                                alt={getMediaAlt(image, '评论图片')}
                                imageClassName="feedback-preview-image"
                              />
                              <button
                                type="button"
                                onClick={() => removeReplyImage(image.id)}
                                className="feedback-image-remove"
                                aria-label="移除附件"
                              >
                                ×
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                      <div className="composer-meta-row">
                        <label htmlFor="feedback-reply-images" className="feedback-upload-btn">
                          上传图片/视频
                        </label>
                        <input
                          id="feedback-reply-images"
                          type="file"
                          accept={FEEDBACK_MEDIA_ACCEPT}
                          multiple
                          className="hidden"
                          onChange={handleReplyFileChange}
                        />
                        <div className="feedback-counter">
                          {replyContent.length}/1000 · {replyImages.length}/{MAX_FEEDBACK_IMAGES} 个附件
                        </div>
                      </div>
                      <button type="submit" disabled={replySubmitting} className="feedback-submit-btn">
                        {replySubmitting && <Loader2 />}
                        {replySubmitting ? '发布中...' : '发布评论'}
                      </button>
                    </form>
                  </div>
                </>
              ) : (
                <div className="feedback-empty">反馈不存在</div>
              )}
            </section>
          )}

          {viewMode === 'wall' && (
            <>
              <div className="feedback-wall-toolbar">
                <div className="feedback-filters">
                  {FEEDBACK_FILTERS.map(({ value, label }) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => handleChangeFilterStatus(value)}
                      className={`filter-tab ${filterStatus === value ? 'active' : ''}`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              <section className="feedback-wall-view">
                <div className="feedback-list">
                  {listLoading ? (
                    <div className="feedback-empty">
                      <Loader2 className="spin-icon" />
                    </div>
                  ) : feedbackList.length === 0 ? (
                    <div className="feedback-empty">暂无公开反馈</div>
                  ) : (
                    feedbackList.map((item) => {
                      const message = item.firstMessage;
                      const reply = item.latestAdminReply;
                      const displayTitle = resolveFeedbackTitle(item, message);

                      return (
                        <article
                          key={item.id}
                          className="feedback-card wall-card"
                          onClick={() => void handleOpenDetail(item.id)}
                        >
                          <div className="fb-header">
                            <div className="fb-user">
                              <FeedbackAuthorAvatar feedback={item} />
                              <div>
                                <div className="fb-name-line">
                                  <h4 className="fb-name">{resolveFeedbackAuthorName(item)}</h4>
                                  <FeedbackAchievementBadge achievement={item.equippedAchievement} />
                                </div>
                                <p className="fb-time">
                                  {formatFeedbackTime(item.createdAt)} · #{item.id}
                                </p>
                              </div>
                            </div>
                            <div className={`fb-status ${WALL_STATUS_CLASS[item.status]}`}>
                              {STATUS_LABEL[item.status]}
                            </div>
                          </div>

                          <div className="fb-content">
                            <h3>{displayTitle}</h3>
                            {message?.content && <p>{message.content}</p>}
                            {message?.images && message.images.length > 0 && (
                              <div className="wall-image-grid">
                                {message.images.map((image, index) => (
                                  <FeedbackMediaLink
                                    key={`${message.id}-${index}`}
                                    media={image}
                                    alt={getMediaAlt(image, `反馈图片${index + 1}`)}
                                    imageClassName="wall-feedback-image"
                                    onClick={(event) => event.stopPropagation()}
                                  />
                                ))}
                              </div>
                            )}

                            {reply && (
                              <div className="official-reply">
                                <div className="reply-header">
                                  <span className="admin-badge">管理员回复</span>
                                  <span className="reply-time">{formatFeedbackTime(reply.createdAt)}</span>
                                </div>
                                {reply.content && <p>{reply.content}</p>}
                              </div>
                            )}
                          </div>

                          <div className="fb-footer">
                            <button
                              type="button"
                              onClick={(event) => void handleToggleLike(item.id, event)}
                              disabled={likeSubmittingId === item.id}
                              className={`fb-action-btn like-btn ${item.likedByMe ? 'active' : ''}`}
                            >
                              <ThumbsUp />
                              {item.likeCount ?? 0} 点赞
                            </button>
                            <button
                              type="button"
                              className="fb-action-btn"
                              onClick={(event) => {
                                event.stopPropagation();
                                void handleOpenDetail(item.id);
                              }}
                            >
                              <MessageSquareText />
                              {item.replyCount ?? 0} 条评论
                            </button>
                          </div>
                        </article>
                      );
                    })
                  )}
                </div>
                {renderFeedbackPagination('feedback-pagination-bottom')}
              </section>
            </>
          )}
        </main>
      </div>

      <style jsx global>{`
        .feedback-wall-page {
          --text-main: #0f172a;
          --text-light: #64748b;
          --card-bg: rgba(255, 255, 255, 0.65);
          --card-border: rgba(255, 255, 255, 1);
          --card-shadow: 0 24px 48px rgba(15, 23, 42, 0.05);
          --radius-xl: 32px;
          --c-orange: #f97316;
          --c-red: #f43f5e;
          --c-blue: #3b82f6;
          --c-green: #10b981;
          background-color: #f8fafc;
          color: var(--text-main);
          font-family: 'Outfit', 'Noto Sans SC', sans-serif;
          height: 100vh;
          position: relative;
          isolation: isolate;
          overflow: hidden;
          -webkit-font-smoothing: antialiased;
        }

        .feedback-wall-page a {
          color: inherit;
          text-decoration: none;
        }

        .feedback-mesh-bg {
          position: fixed;
          inset: 0;
          z-index: -1;
          background-image:
            radial-gradient(circle at 15% 50%, rgba(255, 228, 230, 0.8) 0%, transparent 50%),
            radial-gradient(circle at 85% 30%, rgba(224, 231, 255, 0.8) 0%, transparent 50%),
            radial-gradient(circle at 50% 90%, rgba(254, 243, 199, 0.8) 0%, transparent 50%),
            radial-gradient(circle at 50% 10%, rgba(243, 232, 255, 0.8) 0%, transparent 50%);
          filter: blur(60px);
          animation: feedback-fluid 15s infinite alternate ease-in-out;
        }

        @keyframes feedback-fluid {
          0% { transform: scale(1) rotate(0deg); }
          50% { transform: scale(1.05) rotate(2deg); }
          100% { transform: scale(1.1) rotate(-2deg); }
        }

        .feedback-layout {
          display: flex;
          height: 100vh;
          max-width: 1600px;
          margin: 0 auto;
          overflow: hidden;
        }

        .feedback-panel-left {
          width: 40%;
          padding: 4rem 5rem;
          position: sticky;
          top: 0;
          height: 100vh;
          display: flex;
          flex-direction: column;
          justify-content: space-between;
        }

        .feedback-brand,
        .feedback-nav-item,
        .feedback-user-profile,
        .fb-user,
        .fb-footer,
        .feedback-header,
        .composer-title-row,
        .composer-meta-row,
        .reply-header,
        .fb-footer {
          display: flex;
          align-items: center;
        }

        .feedback-brand {
          gap: 12px;
          font-size: 24px;
          font-weight: 800;
          letter-spacing: -0.5px;
        }

        .feedback-brand-icon {
          width: 40px;
          height: 40px;
          background: linear-gradient(135deg, #ff7a00, #ff004c);
          border-radius: 12px;
          display: flex;
          align-items: center;
          justify-content: center;
          box-shadow: 0 10px 20px rgba(255, 122, 0, 0.3);
        }

        .feedback-brand-icon svg,
        .feedback-nav-item svg,
        .feedback-section-title svg,
        .feedback-btn-primary svg,
        .feedback-btn-ghost svg,
        .detail-back svg,
        .fb-action-btn svg,
        .feedback-submit-btn svg {
          width: 20px;
          height: 20px;
        }

        .feedback-brand-icon svg {
          color: #ffffff;
          width: 24px;
          height: 24px;
        }

        .feedback-hero-content {
          margin-top: -5vh;
        }

        .feedback-hero-title {
          font-size: 64px;
          font-weight: 800;
          line-height: 1.1;
          letter-spacing: -2px;
          margin: 0 0 24px;
        }

        .feedback-hero-title span {
          background: linear-gradient(135deg, #ff5a00, #ff0080);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          background-clip: text;
        }

        .feedback-nav-list {
          display: flex;
          flex-direction: column;
          gap: 12px;
        }

        .feedback-nav-item {
          gap: 16px;
          padding: 16px 24px;
          background: rgba(255, 255, 255, 0.4);
          border: 1px solid rgba(255, 255, 255, 0.6);
          border-radius: 20px;
          font-size: 16px;
          font-weight: 600;
          color: var(--text-main);
          cursor: pointer;
          transition: all 0.3s ease;
          backdrop-filter: blur(10px);
          width: fit-content;
          min-width: 200px;
        }

        .feedback-nav-item:hover,
        .feedback-nav-item.active {
          background: rgba(255, 255, 255, 0.9);
          transform: translateX(8px);
          box-shadow: 0 10px 20px rgba(0, 0, 0, 0.03);
          color: var(--c-orange);
        }

        .feedback-user-profile {
          gap: 16px;
          padding: 16px;
          background: #ffffff;
          border-radius: 999px;
          box-shadow: 0 10px 30px rgba(0, 0, 0, 0.05);
          width: fit-content;
          cursor: pointer;
          transition: transform 0.2s;
        }

        .feedback-user-profile:hover {
          transform: scale(1.02);
        }

        .feedback-avatar {
          width: 48px;
          height: 48px;
          border-radius: 50%;
          background: linear-gradient(135deg, #a8edea 0%, #fed6e3 100%);
          flex-shrink: 0;
        }

        .feedback-user-info h4 {
          font-size: 16px;
          font-weight: 700;
          margin: 0 0 2px;
        }

        .feedback-user-info p {
          font-size: 13px;
          color: var(--text-light);
          margin: 0;
        }

        .feedback-profile-arrow {
          color: #64748b;
          margin-left: auto;
        }

        .feedback-panel-right {
          width: 60%;
          padding: 4rem 5rem 4rem 0;
          display: flex;
          flex-direction: column;
          gap: 24px;
          max-width: 900px;
          min-width: 0;
          height: 100vh;
          overflow-y: auto;
          overflow-x: hidden;
          -webkit-overflow-scrolling: touch;
          scrollbar-gutter: stable;
          position: relative;
        }

        .feedback-panel-right.is-wall-mode {
          overflow: hidden;
        }

        .feedback-header {
          justify-content: space-between;
          gap: 24px;
          margin-bottom: 8px;
        }

        .feedback-section-title {
          font-size: 24px;
          font-weight: 800;
          display: flex;
          align-items: center;
          gap: 10px;
          margin: 0 0 4px;
        }

        .feedback-section-title svg {
          color: var(--c-orange);
        }

        .feedback-header-subtitle,
        .composer-title-row p,
        .feedback-help,
        .feedback-counter,
        .fb-time,
        .reply-time {
          color: var(--text-light);
        }

        .feedback-header-subtitle {
          font-size: 14px;
          margin: 0;
        }

        .feedback-btn-primary,
        .feedback-submit-btn {
          border: 0;
          background: linear-gradient(135deg, #ff7a00, #ff004c);
          color: #ffffff;
          font-weight: 700;
          cursor: pointer;
          box-shadow: 0 10px 20px rgba(255, 122, 0, 0.3);
          transition: transform 0.3s, box-shadow 0.3s;
        }

        .feedback-btn-primary {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 12px 24px;
          font-size: 15px;
          border-radius: 999px;
          white-space: nowrap;
        }

        .feedback-btn-back {
          background: var(--text-main);
          box-shadow: 0 10px 20px rgba(15, 23, 42, 0.12);
        }

        .feedback-btn-ghost,
        .detail-back {
          border: 1px solid rgba(255, 255, 255, 0.85);
          background: rgba(255, 255, 255, 0.62);
          color: var(--text-main);
          font-weight: 800;
          cursor: pointer;
          transition: all 0.25s ease;
        }

        .feedback-btn-ghost {
          padding: 10px 14px;
          border-radius: 999px;
          font-size: 13px;
          white-space: nowrap;
        }

        .feedback-btn-ghost:hover,
        .detail-back:hover {
          background: #ffffff;
          transform: translateY(-1px);
        }

        .feedback-btn-primary:hover,
        .feedback-submit-btn:hover {
          transform: translateY(-2px);
          box-shadow: 0 15px 30px rgba(255, 122, 0, 0.4);
        }

        .feedback-alert-stack {
          display: flex;
          flex-direction: column;
          gap: 12px;
        }

        .feedback-alert {
          border-radius: 20px;
          padding: 14px 18px;
          border: 1px solid #ffffff;
          font-size: 14px;
          font-weight: 700;
          background: rgba(255, 255, 255, 0.72);
          backdrop-filter: blur(20px);
        }

        .feedback-alert.error { color: #dc2626; }
        .feedback-alert.success { color: #059669; }

        .feedback-card {
          background: var(--card-bg);
          backdrop-filter: blur(30px);
          -webkit-backdrop-filter: blur(30px);
          border: 1px solid var(--card-border);
          border-radius: var(--radius-xl);
          padding: 28px;
          box-shadow: var(--card-shadow);
          transition: all 0.4s cubic-bezier(0.16, 1, 0.3, 1);
          position: relative;
          overflow: hidden;
        }

        .wall-card {
          display: flex;
          flex-direction: column;
          gap: 20px;
          cursor: pointer;
        }

        .wall-card:hover {
          transform: translateY(-4px);
          box-shadow: 0 30px 50px rgba(15, 23, 42, 0.08);
        }

        .composer-card {
          scroll-margin-top: 24px;
        }

        .composer-only {
          max-height: calc(100dvh - 12rem);
          overflow-x: hidden;
          overflow-y: auto;
          overscroll-behavior: contain;
          scrollbar-gutter: stable;
          scrollbar-width: thin;
          scrollbar-color: rgba(249, 115, 22, 0.42) rgba(255, 255, 255, 0.5);
        }

        .composer-only::-webkit-scrollbar {
          width: 8px;
        }

        .composer-only::-webkit-scrollbar-track {
          background: rgba(255, 255, 255, 0.48);
          border-radius: 999px;
        }

        .composer-only::-webkit-scrollbar-thumb {
          background: linear-gradient(180deg, rgba(255, 122, 0, 0.58), rgba(255, 0, 76, 0.48));
          border-radius: 999px;
        }

        .composer-actions {
          display: flex;
          align-items: center;
          gap: 10px;
          flex-wrap: wrap;
          justify-content: flex-end;
        }

        .composer-title-row {
          justify-content: space-between;
          gap: 16px;
          margin-bottom: 20px;
        }

        .composer-title-row h3 {
          font-size: 20px;
          font-weight: 800;
          margin: 0 0 6px;
        }

        .composer-title-row p {
          font-size: 13px;
          line-height: 1.5;
          margin: 0;
        }

        .anonymous-toggle {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          padding: 10px 14px;
          border-radius: 999px;
          background: rgba(255, 255, 255, 0.7);
          border: 1px solid rgba(255, 255, 255, 0.9);
          color: var(--text-light);
          font-size: 13px;
          font-weight: 700;
          cursor: pointer;
          white-space: nowrap;
        }

        .anonymous-toggle.is-active {
          color: #ffffff;
          background: var(--text-main);
          border-color: var(--text-main);
        }

        .anonymous-toggle input {
          width: 16px;
          height: 16px;
          accent-color: #f97316;
        }

        .composer-form {
          display: flex;
          flex-direction: column;
          gap: 12px;
        }

        .feedback-input,
        .feedback-textarea {
          width: 100%;
          border: 1px solid rgba(255, 255, 255, 0.9);
          background: rgba(255, 255, 255, 0.72);
          border-radius: 18px;
          padding: 14px 16px;
          outline: none;
          color: var(--text-main);
          font-size: 14px;
          box-shadow: inset 0 2px 8px rgba(15, 23, 42, 0.03);
        }

        .feedback-textarea {
          resize: vertical;
          min-height: 120px;
        }

        .feedback-input:focus,
        .feedback-textarea:focus {
          background: #ffffff;
          border-color: rgba(249, 115, 22, 0.35);
          box-shadow: 0 0 0 4px rgba(249, 115, 22, 0.12);
        }

        .composer-meta-row {
          justify-content: space-between;
          gap: 12px;
        }

        .feedback-upload-btn,
        .filter-tab,
        .fb-action-btn,
        .feedback-load-more {
          background: rgba(255, 255, 255, 0.6);
          border: 1px solid rgba(255, 255, 255, 0.8);
          color: var(--text-light);
          cursor: pointer;
          transition: all 0.25s ease;
          font-weight: 700;
        }

        .feedback-upload-btn {
          padding: 8px 16px;
          border-radius: 999px;
          font-size: 13px;
        }

        .feedback-upload-btn:hover,
        .filter-tab:hover,
        .fb-action-btn:hover,
        .feedback-load-more:hover {
          background: #ffffff;
          color: var(--text-main);
        }

        .fb-action-btn:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }

        .feedback-counter,
        .feedback-help {
          font-size: 12px;
        }

        .feedback-image-grid,
        .wall-image-grid {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 10px;
        }

        .feedback-image-preview {
          position: relative;
          border-radius: 14px;
          overflow: hidden;
          border: 1px solid #ffffff;
          background: #ffffff;
        }

        .feedback-preview-image,
        .wall-feedback-image {
          width: 100%;
          object-fit: cover;
          display: block;
        }

        .feedback-preview-image {
          height: 90px;
        }

        .wall-feedback-image {
          height: 120px;
          border-radius: 14px;
          border: 1px solid #ffffff;
        }

        .feedback-image-remove {
          position: absolute;
          top: 6px;
          right: 6px;
          width: 22px;
          height: 22px;
          border-radius: 999px;
          border: 0;
          background: rgba(15, 23, 42, 0.72);
          color: #ffffff;
          cursor: pointer;
        }

        .feedback-submit-btn {
          width: 100%;
          min-height: 46px;
          border-radius: 999px;
          font-size: 15px;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
        }

        .feedback-submit-btn:disabled,
        .feedback-load-more:disabled {
          opacity: 0.6;
          cursor: not-allowed;
          transform: none;
        }

        .feedback-wall-view {
          display: flex;
          flex-direction: column;
          gap: 16px;
          min-height: 0;
          overflow: visible;
        }

        .feedback-panel-right.is-wall-mode .feedback-wall-view {
          flex: 1;
          overflow: hidden;
        }

        .feedback-wall-toolbar {
          position: sticky;
          top: 0;
          z-index: 30;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          margin: -10px 0 0;
          padding: 12px;
          border: 1px solid transparent;
          border-radius: 24px;
          background: transparent;
          box-shadow: none;
          backdrop-filter: none;
          -webkit-backdrop-filter: none;
          transform: translateZ(0);
        }

        .feedback-panel-right.is-wall-mode .feedback-wall-toolbar {
          position: relative;
          top: auto;
          flex-shrink: 0;
        }

        .feedback-filters {
          min-width: 0;
          flex: 1;
          display: flex;
          gap: 12px;
          overflow-x: auto;
          scrollbar-width: none;
          -webkit-overflow-scrolling: touch;
        }

        .feedback-filters::-webkit-scrollbar {
          display: none;
        }

        .filter-tab {
          padding: 8px 20px;
          border-radius: 999px;
          font-size: 14px;
          white-space: nowrap;
        }

        .filter-tab.active {
          background: var(--text-main);
          color: #ffffff;
          border-color: var(--text-main);
        }

        .feedback-list {
          display: flex;
          flex-direction: column;
          gap: 20px;
          width: 100%;
          min-height: 0;
        }

        .feedback-panel-right.is-wall-mode .feedback-list {
          flex: 1;
          min-height: 0;
          overflow-x: hidden;
          overflow-y: auto;
          padding-right: 6px;
          -webkit-overflow-scrolling: touch;
          scrollbar-gutter: stable;
        }

        .feedback-list > .feedback-card,
        .feedback-list > .feedback-empty {
          flex: 0 0 auto;
        }

        .feedback-empty {
          background: var(--card-bg);
          border: 1px solid var(--card-border);
          border-radius: 24px;
          padding: 40px 24px;
          text-align: center;
          color: var(--text-light);
          font-weight: 700;
        }

        .feedback-empty.small {
          padding: 24px 18px;
        }

        .fb-header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          gap: 16px;
        }

        .fb-user {
          gap: 12px;
          min-width: 0;
        }

        .fb-avatar {
          width: 44px;
          height: 44px;
          border-radius: 50%;
          background: linear-gradient(135deg, #a8edea 0%, #fed6e3 100%);
          display: flex;
          align-items: center;
          justify-content: center;
          color: #64748b;
          font-weight: 800;
          flex-shrink: 0;
          overflow: hidden;
        }

        .fb-avatar-img {
          width: 100%;
          height: 100%;
          object-fit: cover;
          display: block;
        }

        .fb-name {
          font-size: 16px;
          font-weight: 700;
          margin: 0;
          min-width: 0;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .fb-name-line {
          display: flex;
          align-items: center;
          gap: 8px;
          min-width: 0;
          margin-bottom: 2px;
          flex-wrap: wrap;
        }

        .fb-achievement-badge {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          max-width: 136px;
          padding: 3px 8px;
          border-radius: 999px;
          background: rgba(251, 191, 36, 0.16);
          border: 1px solid rgba(251, 191, 36, 0.3);
          color: #92400e;
          font-size: 11px;
          font-weight: 800;
          line-height: 1.1;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .fb-time {
          font-size: 13px;
          margin: 0;
        }

        .fb-status {
          padding: 5px 12px;
          border-radius: 999px;
          font-size: 12px;
          font-weight: 800;
          white-space: nowrap;
        }

        .status-processing { background: rgba(59, 130, 246, 0.1); color: #3b82f6; }
        .status-resolved { background: rgba(16, 185, 129, 0.1); color: #10b981; }
        .status-pending { background: rgba(249, 115, 22, 0.1); color: #f97316; }
        .status-closed { background: rgba(100, 116, 139, 0.12); color: #64748b; }

        .fb-content h3 {
          font-size: 18px;
          font-weight: 800;
          margin: 0 0 12px;
          line-height: 1.4;
          white-space: pre-wrap;
          word-break: break-word;
        }

        .fb-content p {
          font-size: 14.5px;
          color: #475569;
          line-height: 1.6;
          margin: 0;
          white-space: pre-wrap;
          word-break: break-word;
        }

        .official-reply {
          margin-top: 16px;
          padding: 16px 20px;
          background: rgba(255, 122, 0, 0.05);
          border-left: 3px solid #ff7a00;
          border-radius: 0 12px 12px 0;
        }

        .reply-header {
          gap: 12px;
          margin-bottom: 8px;
        }

        .admin-badge {
          background: #ff7a00;
          color: #ffffff;
          padding: 2px 8px;
          border-radius: 6px;
          font-size: 11px;
          font-weight: 800;
        }

        .official-reply p {
          color: var(--text-main);
          font-size: 14px;
        }

        .fb-footer {
          gap: 16px;
        }

        .fb-action-btn {
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 8px 16px;
          border-radius: 999px;
          font-size: 13px;
        }

        .like-btn {
          color: #f43f5e;
          background: rgba(244, 63, 94, 0.08);
          border-color: rgba(244, 63, 94, 0.16);
        }

        .like-btn.active {
          color: #ffffff;
          background: linear-gradient(135deg, #f43f5e, #ff7a00);
          border-color: transparent;
        }

        .feedback-detail-view {
          display: flex;
          flex-direction: column;
          gap: 20px;
        }

        .detail-back {
          width: fit-content;
          display: inline-flex;
          align-items: center;
          gap: 8px;
          padding: 10px 16px;
          border-radius: 999px;
        }

        .detail-back svg {
          transform: rotate(180deg);
        }

        .detail-card {
          cursor: default;
        }

        .detail-card:hover {
          transform: none;
        }

        .comments-card {
          display: flex;
          flex-direction: column;
          gap: 18px;
        }

        .comments-title-row,
        .comment-meta {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
        }

        .comments-title-row h3 {
          margin: 0;
          font-size: 20px;
          font-weight: 800;
        }

        .comments-title-row span,
        .comment-meta {
          color: var(--text-light);
          font-size: 13px;
          font-weight: 700;
        }

        .comment-list,
        .comment-form {
          display: flex;
          flex-direction: column;
          gap: 12px;
        }

        .comment-bubble {
          padding: 16px;
          border-radius: 18px;
          background: rgba(255, 255, 255, 0.58);
          border: 1px solid rgba(255, 255, 255, 0.82);
        }

        .comment-bubble.admin {
          background: rgba(255, 122, 0, 0.07);
          border-color: rgba(255, 122, 0, 0.14);
        }

        .comment-bubble p {
          margin: 8px 0 0;
          color: #334155;
          line-height: 1.6;
          white-space: pre-wrap;
          word-break: break-word;
        }

        .wall-image-grid.compact {
          grid-template-columns: repeat(4, 1fr);
          margin-top: 10px;
        }

        .feedback-load-more {
          width: 100%;
          padding: 12px 18px;
          border-radius: 999px;
          font-size: 14px;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
        }

        .feedback-pagination {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 12px;
          margin-top: 12px;
          padding: 12px 14px;
          border-radius: 20px;
          background: rgba(255, 255, 255, 0.58);
          border: 1px solid rgba(255, 255, 255, 0.85);
          backdrop-filter: blur(14px);
          -webkit-backdrop-filter: blur(14px);
          box-shadow: 0 14px 28px rgba(15, 23, 42, 0.04);
          flex-wrap: wrap;
        }

        .feedback-pagination-bottom {
          flex-shrink: 0;
          margin-top: 0;
        }

        .feedback-pagination.compact {
          margin-top: 0;
          padding: 10px 12px;
          border-radius: 16px;
          box-shadow: none;
        }

        .feedback-pagination-toolbar {
          flex-shrink: 0;
          padding: 8px;
          gap: 8px;
          border-radius: 999px;
          background: rgba(255, 255, 255, 0.7);
        }

        .feedback-pagination-toolbar .feedback-page-btn {
          min-height: 34px;
          padding: 7px 12px;
        }

        .feedback-pagination-toolbar .feedback-page-indicator {
          min-width: 82px;
        }

        .feedback-pagination-toolbar .feedback-page-indicator em {
          display: none;
        }

        .feedback-page-btn {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 6px;
          min-height: 38px;
          padding: 8px 16px;
          border-radius: 999px;
          border: 1px solid rgba(15, 23, 42, 0.08);
          background: rgba(255, 255, 255, 0.82);
          color: var(--text-main);
          font-size: 13px;
          font-weight: 800;
          cursor: pointer;
          transition: all 0.2s ease;
        }

        .feedback-page-btn:hover:not(:disabled) {
          background: var(--text-main);
          color: #fff;
          border-color: var(--text-main);
          transform: translateY(-1px);
        }

        .feedback-page-btn:disabled {
          opacity: 0.45;
          cursor: not-allowed;
        }

        .feedback-page-btn svg {
          width: 14px;
          height: 14px;
        }

        .feedback-page-btn:first-child svg {
          transform: rotate(180deg);
        }

        .feedback-page-indicator {
          min-width: 120px;
          min-height: 46px;
          padding: 6px 14px;
          border-radius: 999px;
          background: linear-gradient(135deg, rgba(255, 122, 0, 0.12), rgba(255, 0, 76, 0.08));
          border: 1px solid rgba(249, 115, 22, 0.16);
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 4px;
          color: var(--text-light);
          font-size: 13px;
          font-weight: 800;
          white-space: nowrap;
        }

        .feedback-page-indicator strong {
          color: var(--c-orange);
          font-size: 18px;
        }

        .feedback-page-indicator em {
          color: var(--text-light);
          font-size: 12px;
          font-style: normal;
          font-weight: 500;
          margin-left: 4px;
        }

        .spin-icon,
        .feedback-submit-btn svg,
        .feedback-load-more svg {
          animation: spin 1s linear infinite;
        }

        @media (max-width: 1200px) {
          .feedback-hero-title { font-size: 42px; }
          .feedback-panel-left { padding: 3rem; }
          .feedback-panel-right { padding: 3rem 3rem 3rem 0; }
          .feedback-card { padding: 24px; }
        }

        @media (max-width: 992px) {
          .feedback-wall-page {
            height: 100dvh;
            overflow: hidden;
          }

          .feedback-layout {
            height: 100dvh;
            flex-direction: column;
            overflow: hidden;
          }

          .feedback-panel-left {
            width: 100%;
            height: auto;
            position: relative;
            padding: 1.5rem 2rem 0;
            flex-shrink: 0;
            display: flex;
            flex-direction: column;
            align-items: flex-start;
            text-align: left;
            z-index: 10;
          }

          .feedback-brand { font-size: 20px; }
          .feedback-brand-icon { width: 32px; height: 32px; border-radius: 10px; }
          .feedback-hero-content { margin-top: 1rem; width: 100%; align-items: flex-start; }
          .feedback-hero-title { font-size: 36px; margin-bottom: 16px; }

          .feedback-user-profile {
            position: absolute;
            top: 1.5rem;
            right: 2rem;
            margin: 0;
            padding: 0;
            width: auto;
            background: transparent;
            border: none;
            box-shadow: none;
          }

          .feedback-user-profile .feedback-user-info,
          .feedback-user-profile svg {
            display: none;
          }

          .feedback-user-profile .feedback-avatar {
            width: 40px;
            height: 40px;
            margin: 0;
          }

          .feedback-nav-list {
            flex-direction: row;
            overflow-x: auto;
            width: 100%;
            gap: 12px;
            padding-bottom: 16px;
            margin-bottom: 0;
            -webkit-overflow-scrolling: touch;
            scrollbar-width: none;
          }

          .feedback-nav-list::-webkit-scrollbar { display: none; }

          .feedback-nav-item {
            flex: 0 0 auto;
            min-width: 0;
            padding: 10px 16px;
            font-size: 14px;
          }

          .feedback-nav-item:hover,
          .feedback-nav-item.active {
            transform: none;
          }

          .feedback-panel-right {
            flex: 1;
            width: 100%;
            padding: 1rem 2rem 4rem;
            overflow-y: auto;
            -webkit-overflow-scrolling: touch;
          }

          .composer-only {
            max-height: calc(100dvh - 10rem);
          }

          .feedback-header,
          .composer-title-row {
            flex-direction: column;
            align-items: flex-start;
          }

          .feedback-btn-primary {
            width: 100%;
            justify-content: center;
          }

          .feedback-wall-toolbar {
            top: 0;
            flex-direction: column;
            align-items: stretch;
            gap: 10px;
            padding-top: 8px;
          }

          .feedback-pagination-toolbar {
            width: 100%;
            justify-content: space-between;
            border-radius: 18px;
          }
        }

        @media (max-width: 640px) {
          .feedback-wall-page {
            height: 100dvh;
            min-height: 100dvh;
            overflow: hidden;
          }

          .feedback-layout {
            height: 100dvh;
            min-height: 0;
            overflow: hidden;
          }

          .feedback-panel-left { padding: 1.5rem 1.5rem 0; }
          .feedback-user-profile { right: 1.5rem; }
          .feedback-panel-right {
            padding: 0.875rem 1rem max(3rem, calc(2rem + env(safe-area-inset-bottom)));
            gap: 14px;
            min-height: 0;
            overflow-x: hidden;
            overflow-y: auto;
            -webkit-overflow-scrolling: touch;
          }
          .feedback-wall-toolbar {
            margin-top: -4px;
            border-radius: 20px;
          }
          .feedback-hero-title { font-size: 32px; line-height: 1.2; }
          .feedback-header {
            gap: 14px;
            margin-bottom: 0;
          }
          .feedback-section-title { font-size: 21px; }
          .feedback-header-subtitle { font-size: 13px; }
          .feedback-btn-primary {
            min-height: 44px;
            border-radius: 16px;
          }
          .feedback-card {
            padding: 16px;
            border-radius: 20px;
          }
          .composer-only {
            max-height: calc(100dvh - 8.5rem);
          }
          .wall-card { gap: 14px; }
          .fb-header {
            flex-direction: row;
            align-items: flex-start;
            gap: 12px;
          }
          .fb-user { min-width: 0; }
          .fb-avatar { width: 40px; height: 40px; }
          .fb-name-line {
            flex-wrap: wrap;
            gap: 6px;
          }
          .fb-status {
            position: static;
            margin-left: auto;
            flex-shrink: 0;
          }
          .fb-content p { font-size: 13.5px; }
          .composer-title-row,
          .composer-meta-row,
          .comments-title-row {
            gap: 12px;
          }
          .composer-actions,
          .composer-meta-row {
            width: 100%;
            justify-content: stretch;
          }
          .anonymous-toggle,
          .feedback-btn-ghost,
          .feedback-upload-btn {
            justify-content: center;
            flex: 1;
          }
          .feedback-input,
          .feedback-textarea {
            border-radius: 15px;
            padding: 12px 14px;
            font-size: 13.5px;
          }
          .feedback-image-grid,
          .wall-image-grid { grid-template-columns: repeat(2, 1fr); }
          .fb-footer { gap: 10px; }
          .fb-action-btn { flex: 1; justify-content: center; }
          .feedback-pagination {
            gap: 8px;
            justify-content: space-between;
            padding: 10px;
            border-radius: 16px;
          }
          .feedback-page-btn {
            flex: 1;
            min-height: 38px;
            padding: 8px 10px;
            font-size: 12px;
          }
          .feedback-page-indicator {
            min-width: 74px;
            flex-direction: column;
            gap: 0;
            line-height: 1.05;
            font-size: 11px;
          }
          .feedback-page-indicator strong { font-size: 17px; }
          .feedback-page-indicator em {
            margin-left: 0;
            margin-top: 3px;
            font-size: 10.5px;
          }

          .feedback-pagination-toolbar {
            padding: 8px;
          }

          .feedback-pagination-toolbar .feedback-page-indicator {
            min-width: 64px;
          }
        }

        @media (max-width: 480px) {
          .feedback-panel-right { padding: 0.75rem 0.875rem 2.5rem; }
          .feedback-card { padding: 14px; border-radius: 18px; }
          .composer-only {
            max-height: calc(100dvh - 7.5rem);
          }
          .feedback-btn-primary { width: 100%; }
          .fb-status { font-size: 10.5px; padding: 5px 9px; }
          .comment-bubble { padding: 12px; border-radius: 16px; }
        }
      `}</style>
    </div>
  );
}
