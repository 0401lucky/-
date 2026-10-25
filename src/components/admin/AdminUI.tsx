'use client';

import { useEffect, useId, useRef, type ReactNode } from 'react';
import { AlertCircle, ArrowRight, Loader2, X } from 'lucide-react';

export function AdminPageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow: string;
  title: string;
  description: string;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <p className="mb-2 text-xs font-semibold tracking-[0.14em] text-orange-700">
          {eyebrow}
        </p>
        <h1 className="text-2xl font-semibold tracking-tight text-stone-900 sm:text-[28px]">
          {title}
        </h1>
        <p className="mt-2 text-sm leading-6 text-stone-500">{description}</p>
      </div>
      {actions && (
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {actions}
        </div>
      )}
    </div>
  );
}

export function AdminError({
  message,
  onRetry,
}: {
  message: string;
  onRetry?: () => void;
}) {
  return (
    <div
      role="alert"
      className="flex flex-wrap items-center gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
    >
      <AlertCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
      <p className="min-w-0 flex-1">{message}</p>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="inline-flex items-center gap-1 font-semibold underline underline-offset-4"
        >
          重试
          <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      )}
    </div>
  );
}

export function AdminLoading({ label = '正在加载数据…' }: { label?: string }) {
  return (
    <div
      role="status"
      className="flex min-h-64 items-center justify-center gap-3 text-sm text-stone-500"
    >
      <Loader2
        className="h-5 w-5 animate-spin text-orange-600"
        aria-hidden="true"
      />
      {label}
    </div>
  );
}

export function AdminDialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  busy = false,
  wide = false,
  className = '',
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children?: ReactNode;
  footer?: ReactNode;
  busy?: boolean;
  wide?: boolean;
  className?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!open || !dialog) return;
    const previousFocus =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    dialog.showModal();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      dialog.close();
      document.body.style.overflow = previousOverflow;
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      aria-modal="true"
      className={`admin-dialog ${wide ? 'admin-dialog-wide' : ''} ${className}`}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
    >
      <div className="flex max-h-[inherit] flex-col">
        <div className="flex shrink-0 items-start justify-between gap-4 border-b border-stone-100 px-6 py-5">
          <div>
            <h2 id={titleId} className="text-lg font-semibold text-stone-900">
              {title}
            </h2>
            {description && (
              <p
                id={descriptionId}
                className="mt-1.5 text-sm leading-6 text-stone-500"
              >
                {description}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="admin-icon-button -mr-2 -mt-1 shrink-0"
            aria-label="关闭弹窗"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        {children && (
          <div className="min-h-0 overflow-y-auto px-6 py-5">{children}</div>
        )}
        {footer && (
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-3 border-t border-stone-100 bg-stone-50/70 px-6 py-4">
            {footer}
          </div>
        )}
      </div>
    </dialog>
  );
}
