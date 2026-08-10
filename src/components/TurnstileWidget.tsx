'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

const TURNSTILE_SCRIPT_ID = 'cloudflare-turnstile-script';
const TURNSTILE_SCRIPT_URL =
  'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

type TurnstileWidgetId = string;

interface TurnstileRenderOptions {
  sitekey: string;
  theme?: 'light' | 'dark' | 'auto';
  language?: string;
  size?: 'normal' | 'compact' | 'flexible';
  callback: (token: string) => void;
  'expired-callback': () => void;
  'error-callback': () => void;
}

interface TurnstileApi {
  render: (
    container: HTMLElement,
    options: TurnstileRenderOptions,
  ) => TurnstileWidgetId;
  reset: (widgetId?: TurnstileWidgetId) => void;
  remove: (widgetId: TurnstileWidgetId) => void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

let turnstileScriptPromise: Promise<TurnstileApi> | null = null;

function loadTurnstileScript(): Promise<TurnstileApi> {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('Turnstile 只能在浏览器中加载'));
  }

  if (window.turnstile) {
    return Promise.resolve(window.turnstile);
  }

  if (turnstileScriptPromise) {
    return turnstileScriptPromise;
  }

  turnstileScriptPromise = new Promise<TurnstileApi>((resolve, reject) => {
    const handleLoad = () => {
      if (window.turnstile) {
        resolve(window.turnstile);
        return;
      }

      document.getElementById(TURNSTILE_SCRIPT_ID)?.remove();
      turnstileScriptPromise = null;
      reject(new Error('Turnstile 脚本已加载，但验证接口不可用'));
    };

    const handleError = () => {
      document.getElementById(TURNSTILE_SCRIPT_ID)?.remove();
      turnstileScriptPromise = null;
      reject(new Error('Turnstile 脚本加载失败'));
    };

    const existingScript = document.getElementById(
      TURNSTILE_SCRIPT_ID,
    ) as HTMLScriptElement | null;

    if (existingScript) {
      existingScript.addEventListener('load', handleLoad, { once: true });
      existingScript.addEventListener('error', handleError, { once: true });
      return;
    }

    const script = document.createElement('script');
    script.id = TURNSTILE_SCRIPT_ID;
    script.src = TURNSTILE_SCRIPT_URL;
    script.async = true;
    script.defer = true;
    script.addEventListener('load', handleLoad, { once: true });
    script.addEventListener('error', handleError, { once: true });
    document.head.appendChild(script);
  });

  return turnstileScriptPromise;
}

type VerificationStatus =
  | 'loading'
  | 'ready'
  | 'verified'
  | 'expired'
  | 'error';

const STATUS_TEXT: Record<VerificationStatus, string> = {
  loading: '正在加载人机验证…',
  ready: '请完成人机验证',
  verified: '人机验证已完成',
  expired: '验证已过期，请重新验证',
  error: '人机验证加载失败，请重试',
};

export interface TurnstileWidgetProps {
  siteKey: string;
  onTokenChange: (token: string | null) => void;
}

export default function TurnstileWidget({
  siteKey,
  onTokenChange,
}: TurnstileWidgetProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<TurnstileWidgetId | null>(null);
  const [status, setStatus] = useState<VerificationStatus>('loading');
  const [retryVersion, setRetryVersion] = useState(0);

  const resetWidget = useCallback(() => {
    const widgetId = widgetIdRef.current;
    if (widgetId && window.turnstile) {
      window.turnstile.reset(widgetId);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    onTokenChange(null);

    void loadTurnstileScript()
      .then((turnstile) => {
        if (cancelled || !containerRef.current) return;

        widgetIdRef.current = turnstile.render(containerRef.current, {
          sitekey: siteKey,
          theme: 'light',
          language: 'zh-CN',
          size: 'flexible',
          callback: (token) => {
            if (cancelled) return;
            onTokenChange(token);
            setStatus('verified');
          },
          'expired-callback': () => {
            if (cancelled) return;
            onTokenChange(null);
            resetWidget();
            setStatus('expired');
          },
          'error-callback': () => {
            if (cancelled) return;
            onTokenChange(null);
            resetWidget();
            setStatus('error');
          },
        });
        setStatus('ready');
      })
      .catch(() => {
        if (cancelled) return;
        onTokenChange(null);
        setStatus('error');
      });

    return () => {
      cancelled = true;
      const widgetId = widgetIdRef.current;
      widgetIdRef.current = null;
      if (widgetId && window.turnstile) {
        window.turnstile.remove(widgetId);
      }
    };
  }, [onTokenChange, resetWidget, retryVersion, siteKey]);

  const handleRetry = () => {
    onTokenChange(null);
    setStatus('loading');
    setRetryVersion((version) => version + 1);
  };

  return (
    <div className="turnstile-field">
      <span className="turnstile-label">人机验证</span>
      <div className="turnstile-panel">
        <div ref={containerRef} className="turnstile-widget-host" />
        <div
          className={`turnstile-status is-${status}`}
          role="status"
          aria-live="polite"
        >
          <span className="turnstile-status-dot" aria-hidden />
          <span>{STATUS_TEXT[status]}</span>
          {status === 'error' && (
            <button type="button" onClick={handleRetry}>
              重新加载验证
            </button>
          )}
        </div>
      </div>

      <style jsx>{`
        .turnstile-field {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }

        .turnstile-label {
          color: #64748b;
          font-size: 12px;
          font-weight: 700;
          letter-spacing: 0.4px;
        }

        .turnstile-panel {
          padding: 12px;
          border: 1.5px solid rgba(255, 255, 255, 0.85);
          border-radius: 14px;
          background: rgba(255, 255, 255, 0.6);
          backdrop-filter: blur(12px);
          -webkit-backdrop-filter: blur(12px);
        }

        .turnstile-widget-host {
          display: flex;
          width: 100%;
          min-height: 65px;
          align-items: center;
          justify-content: center;
        }

        .turnstile-status {
          display: flex;
          min-height: 20px;
          align-items: center;
          justify-content: center;
          gap: 7px;
          margin-top: 8px;
          color: #64748b;
          font-size: 12px;
          font-weight: 600;
          text-align: center;
        }

        .turnstile-status-dot {
          width: 7px;
          height: 7px;
          flex: 0 0 auto;
          border-radius: 999px;
          background: #94a3b8;
        }

        .turnstile-status.is-verified {
          color: #047857;
        }

        .turnstile-status.is-verified .turnstile-status-dot {
          background: #10b981;
          box-shadow: 0 0 0 3px rgba(16, 185, 129, 0.14);
        }

        .turnstile-status.is-expired,
        .turnstile-status.is-error {
          color: #be123c;
        }

        .turnstile-status.is-expired .turnstile-status-dot,
        .turnstile-status.is-error .turnstile-status-dot {
          background: #f43f5e;
          box-shadow: 0 0 0 3px rgba(244, 63, 94, 0.14);
        }

        .turnstile-status button {
          padding: 0;
          border: 0;
          border-bottom: 1px solid currentColor;
          background: transparent;
          color: inherit;
          cursor: pointer;
          font: inherit;
        }
      `}</style>
    </div>
  );
}
