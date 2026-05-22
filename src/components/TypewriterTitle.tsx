'use client';

import { useEffect, useState } from 'react';

interface TypewriterTitleProps {
  /** 第一行文本（普通颜色） */
  line1: string;
  /** 第二行文本（应用 spanClassName 的渐变色） */
  line2: string;
  /** 第二行 span 的 className，用于继承父页面的渐变色样式 */
  spanClassName?: string;
  /** 每个字符的间隔（毫秒） */
  charDelay?: number;
  /** 第一行打完后到第二行开始的停顿（毫秒） */
  lineDelay?: number;
  /** 组件挂载到第一个字之间的初始延迟（毫秒） */
  initialDelay?: number;
}

/**
 * 两行打字机标题：
 * - 先逐字打第一行，光标停在第一行末
 * - 短暂停顿后切到第二行继续打字
 * - 第二行打完后光标常驻第二行末持续闪烁
 *
 * 第二行外面套一个 <span className={spanClassName}>，用于复用各页面已有的渐变色样式。
 */
export function TypewriterTitle({
  line1,
  line2,
  spanClassName,
  charDelay = 90,
  lineDelay = 280,
  initialDelay = 200,
}: TypewriterTitleProps) {
  const [shown1, setShown1] = useState('');
  const [shown2, setShown2] = useState('');
  const [phase, setPhase] = useState<'before' | 'line1' | 'between' | 'line2' | 'done'>('before');

  useEffect(() => {
    let cancelled = false;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const intervals: ReturnType<typeof setInterval>[] = [];

    const startId = setTimeout(() => {
      if (cancelled) return;
      setPhase('line1');
      let i = 0;
      const t1 = setInterval(() => {
        if (cancelled) {
          clearInterval(t1);
          return;
        }
        i += 1;
        setShown1(line1.slice(0, i));
        if (i >= line1.length) {
          clearInterval(t1);
          setPhase('between');
          const betweenId = setTimeout(() => {
            if (cancelled) return;
            setPhase('line2');
            let j = 0;
            const t2 = setInterval(() => {
              if (cancelled) {
                clearInterval(t2);
                return;
              }
              j += 1;
              setShown2(line2.slice(0, j));
              if (j >= line2.length) {
                clearInterval(t2);
                setPhase('done');
              }
            }, charDelay);
            intervals.push(t2);
          }, lineDelay);
          timers.push(betweenId);
        }
      }, charDelay);
      intervals.push(t1);
    }, initialDelay);
    timers.push(startId);

    return () => {
      cancelled = true;
      timers.forEach(clearTimeout);
      intervals.forEach(clearInterval);
    };
  }, [line1, line2, charDelay, lineDelay, initialDelay]);

  // 光标位置：line1 阶段在第一行；between 期间停在第一行末；line2/done 在第二行末
  const cursorOnLine1 = phase === 'line1' || phase === 'between';
  const cursorOnLine2 = phase === 'line2' || phase === 'done';

  return (
    <>
      {shown1}
      {cursorOnLine1 && <span className="tw-cursor" aria-hidden="true">|</span>}
      <br />
      <span className={spanClassName}>
        {shown2}
        {cursorOnLine2 && <span className="tw-cursor" aria-hidden="true">|</span>}
      </span>
      <style jsx global>{`
        .tw-cursor {
          display: inline-block;
          margin-left: 0.04em;
          font-weight: 200;
          animation: tw-blink 1s steps(2, start) infinite;
          will-change: opacity;
        }

        @keyframes tw-blink {
          to { opacity: 0; }
        }

        @media (prefers-reduced-motion: reduce) {
          .tw-cursor { animation: none; }
        }
      `}</style>
    </>
  );
}

export default TypewriterTitle;
