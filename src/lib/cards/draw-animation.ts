import type { CardConfig } from './types';

export const DRAW_MOTION = {
  intro: 280,
  entry: 480,
  entryStagger: 50,
  firstFlip: 500,
  flipStagger: 150,
  flip: 660,
  settle: 100,
  skip: 120,
  exit: 180,
  imageTimeout: 1600,
} as const;

export function getDrawImage(card: CardConfig, single: boolean): string {
  return single ? card.image : card.thumbnailImage ?? card.image;
}

export function waitForDrawIntro(signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const finish = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', finish);
      resolve();
    };
    const timer = setTimeout(finish, DRAW_MOTION.intro);
    signal.addEventListener('abort', finish, { once: true });
    if (signal.aborted) finish();
  });
}

/** Decode the same assets used by the reveal, with a bounded wait for slow images. */
export function prepareDrawImages(cards: CardConfig[], signal: AbortSignal): Promise<void> {
  if (signal.aborted || typeof window === 'undefined') return Promise.resolve();
  const sources = [...new Set(cards.map((card) => getDrawImage(card, cards.length === 1)))];
  return new Promise((resolve) => {
    const images: HTMLImageElement[] = [];
    let remaining = sources.length;
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      signal.removeEventListener('abort', finish);
      images.forEach((image) => { image.onload = null; image.onerror = null; });
      resolve();
    };
    const timer = setTimeout(finish, DRAW_MOTION.imageTimeout);
    signal.addEventListener('abort', finish, { once: true });
    if (remaining === 0) { finish(); return; }
    sources.forEach((src) => {
      const image = new window.Image();
      images.push(image);
      let settled = false;
      const ready = () => {
        if (settled || finished) return;
        settled = true;
        remaining -= 1;
        if (remaining === 0) finish();
      };
      image.decoding = 'async';
      image.onload = () => {
        if (typeof image.decode === 'function') void image.decode().catch(() => {}).then(ready);
        else ready();
      };
      image.onerror = ready;
      image.src = src;
      if (image.complete && image.naturalWidth > 0) image.onload(new Event('load'));
    });
  });
}
