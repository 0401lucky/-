'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type MouseEvent,
  type ReactNode,
} from 'react';
import { useRouter } from 'next/navigation';
import { AlertCircle, CheckCircle2, Info, X } from 'lucide-react';
import { AdminDialog } from './AdminUI';

type ToastTone = 'success' | 'error' | 'info';
interface ConfirmOptions {
  title: string;
  description: string;
  confirmLabel?: string;
  danger?: boolean;
}
interface FeedbackContext {
  notify: (message: string, tone?: ToastTone) => void;
  confirm: (options: ConfirmOptions) => Promise<boolean>;
  setLeaveGuard: (message: string | null) => void;
  confirmLeave: () => Promise<boolean>;
}

interface AdminNavigateEvent extends Event {
  navigationType: string;
  destination: { sameDocument: boolean; key: string };
}

interface AdminNavigation {
  addEventListener: (
    type: 'navigate',
    listener: (event: AdminNavigateEvent) => void,
  ) => void;
  removeEventListener: (
    type: 'navigate',
    listener: (event: AdminNavigateEvent) => void,
  ) => void;
  traverseTo: (key: string) => { finished: Promise<unknown> };
}

const Context = createContext<FeedbackContext | null>(null);

export function useAdminFeedback() {
  const value = useContext(Context);
  if (!value)
    throw new Error(
      'useAdminFeedback must be used within AdminFeedbackProvider',
    );
  return value;
}

export function useAdminUnsavedChanges(dirty: boolean) {
  const { setLeaveGuard } = useAdminFeedback();
  useEffect(() => {
    setLeaveGuard(
      dirty ? '系统设置还有未保存的修改，离开后这些修改将丢失。' : null,
    );
    return () => setLeaveGuard(null);
  }, [dirty, setLeaveGuard]);
}

export function AdminFeedbackProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [toasts, setToasts] = useState<
    Array<{ id: number; message: string; tone: ToastTone }>
  >([]);
  const [confirmation, setConfirmation] = useState<ConfirmOptions | null>(null);
  const resolver = useRef<((accepted: boolean) => void) | null>(null);
  const leaveGuard = useRef<string | null>(null);
  const nextId = useRef(0);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: number) => {
    clearTimeout(timers.current.get(id));
    timers.current.delete(id);
    setToasts((current) => current.filter((item) => item.id !== id));
  }, []);

  const notify = useCallback(
    (message: string, tone: ToastTone = 'success') => {
      const id = ++nextId.current;
      timers.current.forEach(clearTimeout);
      timers.current.clear();
      setToasts([{ id, message, tone }]);
      timers.current.set(
        id,
        setTimeout(() => dismiss(id), tone === 'error' ? 8000 : 5000),
      );
    },
    [dismiss],
  );

  const confirm = useCallback((options: ConfirmOptions) => {
    resolver.current?.(false);
    setConfirmation(options);
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve;
    });
  }, []);

  const finishConfirmation = useCallback((accepted: boolean) => {
    resolver.current?.(accepted);
    resolver.current = null;
    setConfirmation(null);
  }, []);

  const setLeaveGuard = useCallback((message: string | null) => {
    leaveGuard.current = message;
  }, []);
  const confirmLeave = useCallback(async () => {
    if (!leaveGuard.current) return true;
    return confirm({
      title: '离开当前页面？',
      description: leaveGuard.current,
      confirmLabel: '放弃修改并离开',
      danger: true,
    });
  }, [confirm]);

  // 支持 Navigation API 的浏览器可在后退/前进发生前确认，避免改写历史记录。
  useEffect(() => {
    const navigation = (window as Window & { navigation?: AdminNavigation })
      .navigation;
    if (!navigation) return;
    const handleTraverse = (event: AdminNavigateEvent) => {
      if (
        event.navigationType !== 'traverse' ||
        !event.destination.sameDocument ||
        !event.cancelable ||
        !leaveGuard.current
      )
        return;
      event.preventDefault();
      const message = leaveGuard.current;
      void confirmLeave().then((accepted) => {
        if (!accepted) return;
        leaveGuard.current = null;
        void navigation.traverseTo(event.destination.key).finished.catch(() => {
          leaveGuard.current = message;
          notify('页面切换未完成，请重试', 'error');
        });
      });
    };
    navigation.addEventListener('navigate', handleTraverse);
    return () => navigation.removeEventListener('navigate', handleTraverse);
  }, [confirmLeave, notify]);

  useEffect(() => {
    const activeTimers = timers.current;
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!leaveGuard.current) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      activeTimers.forEach(clearTimeout);
      resolver.current?.(false);
    };
  }, []);

  const handleNavigation = async (event: MouseEvent<HTMLDivElement>) => {
    if (
      !leaveGuard.current ||
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    )
      return;
    const anchor =
      event.target instanceof Element ? event.target.closest('a') : null;
    if (
      !anchor ||
      anchor.target === '_blank' ||
      anchor.hasAttribute('download')
    )
      return;
    const target = new URL(anchor.href, window.location.href);
    if (
      target.origin !== window.location.origin ||
      (target.pathname === window.location.pathname &&
        target.search === window.location.search)
    )
      return;
    event.preventDefault();
    event.stopPropagation();
    if (await confirmLeave()) {
      leaveGuard.current = null;
      router.push(`${target.pathname}${target.search}${target.hash}`);
    }
  };

  return (
    <Context.Provider value={{ notify, confirm, setLeaveGuard, confirmLeave }}>
      <div
        className="admin-feedback-root"
        onClickCapture={(event) => void handleNavigation(event)}
      >
        {children}
      </div>
      <div className="admin-toast-stack">
        {toasts.map((toast) => {
          const Icon =
            toast.tone === 'success'
              ? CheckCircle2
              : toast.tone === 'error'
                ? AlertCircle
                : Info;
          return (
            <div
              key={toast.id}
              role={toast.tone === 'error' ? 'alert' : 'status'}
              className={`admin-toast admin-toast-${toast.tone}`}
            >
              <Icon className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
              <p className="min-w-0 flex-1 text-sm leading-6">
                {toast.message}
              </p>
              <button
                type="button"
                onClick={() => dismiss(toast.id)}
                className="shrink-0 rounded-md p-1 opacity-60 hover:opacity-100"
                aria-label="关闭提示"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          );
        })}
      </div>
      <AdminDialog
        open={confirmation !== null}
        onClose={() => finishConfirmation(false)}
        title={confirmation?.title ?? ''}
        description={confirmation?.description}
        footer={
          <>
            <button
              type="button"
              className="admin-button-secondary"
              onClick={() => finishConfirmation(false)}
            >
              取消
            </button>
            <button
              type="button"
              className={
                confirmation?.danger
                  ? 'admin-button-danger'
                  : 'admin-button-primary'
              }
              onClick={() => finishConfirmation(true)}
            >
              {confirmation?.confirmLabel ?? '确定'}
            </button>
          </>
        }
      />
    </Context.Provider>
  );
}
