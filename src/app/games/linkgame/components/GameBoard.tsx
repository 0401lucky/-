'use client';

import { useCallback, useState, useEffect, useRef } from 'react';
import Image from 'next/image';
import type { LinkGameDifficultyConfig, LinkGamePosition } from '@/lib/types/game';
import {
  indexOfPosition,
  isActivePosition,
  isStack3DConfig,
  isStackTileBlocked,
  isStackTileSelectable,
  LINKGAME_TILE_IMAGE_PATHS,
} from '@/lib/linkgame';
import { cn } from '@/lib/utils';

interface GameBoardProps {
  tileLayout: (string | null)[];
  config: LinkGameDifficultyConfig;
  selected: number[];
  shakingIndices?: number[];
  matchingIndices?: number[];
  matchPaths?: LinkGamePosition[][];
  onSelect: (index: number) => void;
  onMatch?: (index1: number, index2: number) => void;
  onGameEnd?: () => void;
}

export function GameBoard({
  tileLayout,
  config,
  selected,
  shakingIndices = [],
  matchingIndices = [],
  matchPaths,
  onSelect,
}: GameBoardProps) {
  const [entranceComplete, setEntranceComplete] = useState(false);
  const [matchingTiles, setMatchingTiles] = useState<number[]>([]);
  const [shakingTiles, setShakingTiles] = useState<number[]>([]);
  const [pathPointsList, setPathPointsList] = useState<string[]>([]);
  const gridRef = useRef<HTMLDivElement>(null);

  const resetPathPoints = useCallback(() => {
    setPathPointsList([]);
  }, []);

  const syncMatchingTiles = useCallback((indices: number[]) => {
    if (indices.length > 0) {
      setMatchingTiles(prev => [...new Set([...prev, ...indices])]);
      return;
    }
    setMatchingTiles(indices);
  }, []);

  const syncShakingTiles = useCallback((indices: number[]) => {
    setShakingTiles(indices);
  }, []);

  // 根据棋盘尺寸重新计算连线路径，保证移动端缩放后线条仍然对齐。
  useEffect(() => {
    if (isStack3DConfig(config) || !matchPaths || matchPaths.length === 0 || !gridRef.current) {
      const frame = requestAnimationFrame(() => {
        resetPathPoints();
      });
      return () => cancelAnimationFrame(frame);
    }

    const validPaths = matchPaths.filter((p) => Array.isArray(p) && p.length >= 2);
    if (validPaths.length === 0) {
      const frame = requestAnimationFrame(() => {
        resetPathPoints();
      });
      return () => cancelAnimationFrame(frame);
    }

    const updatePath = () => {
      if (!gridRef.current) return;
      const { width, height } = gridRef.current.getBoundingClientRect();
      const computedStyle = getComputedStyle(gridRef.current);
      const gapX = parseFloat(computedStyle.columnGap) || 0;
      const gapY = parseFloat(computedStyle.rowGap) || 0;
      const { rows, cols } = config;

      const cellWidth = (width - (cols - 1) * gapX) / cols;
      const cellHeight = (height - (rows - 1) * gapY) / rows;

      const getX = (c: number) => {
        const offset = Math.max(gapX, gapY) * 1.5;
        if (c < 0) return -offset;
        if (c >= cols) return width + offset;
        return c * (cellWidth + gapX) + cellWidth / 2;
      };

      const getY = (r: number) => {
        const offset = Math.max(gapX, gapY) * 1.5;
        if (r < 0) return -offset;
        if (r >= rows) return height + offset;
        return r * (cellHeight + gapY) + cellHeight / 2;
      };

      const pointsList = validPaths.map((path) => path.map((p) => `${getX(p.col)},${getY(p.row)}`).join(' '));
      setPathPointsList(pointsList);
    };

    updatePath();
    const resizeObserver = new ResizeObserver(updatePath);
    resizeObserver.observe(gridRef.current);

    return () => resizeObserver.disconnect();
  }, [matchPaths, config, resetPathPoints]);

  // 动画状态保留在本地，避免父组件快速刷新时打断反馈。
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      syncMatchingTiles(matchingIndices);
    });
    return () => cancelAnimationFrame(frame);
  }, [matchingIndices, syncMatchingTiles]);

  useEffect(() => {
    if (shakingIndices.length === 0) {
      const frame = requestAnimationFrame(() => {
        syncShakingTiles([]);
      });
      return () => cancelAnimationFrame(frame);
    }

    if (shakingIndices.length > 0) {
      const frame = requestAnimationFrame(() => {
        syncShakingTiles(shakingIndices);
      });
      const timer = setTimeout(() => {
        syncShakingTiles([]);
      }, 400);
      return () => {
        cancelAnimationFrame(frame);
        clearTimeout(timer);
      };
    }
  }, [shakingIndices, syncShakingTiles]);

  useEffect(() => {
    const maxDelay = (config.rows + config.cols) * 50;
    const timer = setTimeout(() => {
      setEntranceComplete(true);
    }, maxDelay + 500);
    return () => clearTimeout(timer);
  }, [config.rows, config.cols]);

  const getTileContent = (tile: string | null) => {
    if (!tile) return null;
    const imageSrc = LINKGAME_TILE_IMAGE_PATHS[tile];

    if (!imageSrc) {
      return tile;
    }

    return (
      <Image
        src={imageSrc}
        alt=""
        aria-hidden="true"
        draggable={false}
        width={256}
        height={256}
        sizes="(max-width: 640px) 44px, (max-width: 1024px) 64px, 80px"
        className="pointer-events-none select-none object-contain drop-shadow-sm transition-transform sm:hover:scale-110"
        style={{ width: '68%', height: '68%' }}
      />
    );
  };

  const handleAnimationEnd = (animationName: string) => {
    if (animationName.includes('tile-match')) {
      // 匹配动画结束后由父组件统一清理棋盘状态。
    }
  };

  if (isStack3DConfig(config)) {
    const layers = [...(config.layers ?? [])].sort((a, b) => a.z - b.z);
    const layerOffsets = [
      { x: 0, y: 0 },
      { x: 22, y: -14 },
      { x: -12, y: -32 },
      { x: 14, y: -50 },
      { x: -22, y: -66 },
    ];

    return (
      <div className="link-board-surface is-stack">
        <div className="absolute inset-0 bg-gradient-to-br from-white/40 to-transparent pointer-events-none" />
        <div
          className="link-stack-board"
          style={{
            aspectRatio: `${config.cols} / ${config.rows}`,
          }}
        >
          {layers.map((layer) => (
            <div
              key={layer.z}
              className={`link-stack-layer layer-${layer.z}`}
              style={{
                gridTemplateColumns: `repeat(${config.cols}, minmax(0, 1fr))`,
                gridTemplateRows: `repeat(${config.rows}, minmax(0, 1fr))`,
                transform: `translate(${layerOffsets[layer.z]?.x ?? layer.z * 18}px, ${layerOffsets[layer.z]?.y ?? layer.z * -18}px)`,
                zIndex: layer.z + 1,
              }}
            >
              {Array.from({ length: config.rows * config.cols }).map((_, cellIndex) => {
                const row = Math.floor(cellIndex / config.cols);
                const col = cellIndex % config.cols;
                const pos: LinkGamePosition = { row, col, z: layer.z };
                const active = isActivePosition(config, pos);

                if (!active) {
                  return <div key={cellIndex} className="link-stack-cell is-empty" aria-hidden />;
                }

                const index = indexOfPosition(pos, config);
                const tile = tileLayout[index];
                const isVisible = tile !== null;
                const isSelected = selected.includes(index);
                const isShaking = shakingTiles.includes(index) || shakingIndices.includes(index);
                const isMatching = matchingTiles.includes(index) || matchingIndices.includes(index);
                const isBlocked = isVisible && isStackTileBlocked(tileLayout, pos, config);
                const isSelectable = isVisible && isStackTileSelectable(tileLayout, pos, config);
                const delay = (layer.z * 4 + row + col) * 40;

                return (
                  <div key={cellIndex} className={cn("link-stack-cell", !isVisible && "is-empty")}>
                    <button
                      onClick={() => isSelectable && onSelect(index)}
                      disabled={!isSelectable || isMatching}
                      onAnimationEnd={(e) => handleAnimationEnd(e.animationName)}
                      className={cn(
                        "link-stack-tile relative flex h-full w-full select-none items-center justify-center overflow-hidden rounded-2xl border-2 text-xl transition-all duration-300 sm:text-3xl",
                        isVisible
                          ? "bg-white border-white shadow-[0_4px_0_0_rgba(15,23,42,0.08)]"
                          : "invisible opacity-0",
                        isVisible && !entranceComplete && "animate-tile-entrance",
                        isVisible && isBlocked && "is-covered",
                        isSelectable && !isMatching && "cursor-pointer hover:-translate-y-1 hover:shadow-[0_7px_0_0_rgba(15,23,42,0.08)]",
                        isSelected && "animate-tile-pulse ring-4 ring-pink-400 border-pink-500 z-10 bg-pink-50 rotate-3 scale-[1.06]",
                        isShaking && "animate-tile-shake bg-red-50 border-red-400 text-red-500 ring-4 ring-red-200 z-10 rotate-12",
                        isMatching && "animate-tile-match z-20 border-emerald-400 bg-emerald-50 ring-4 ring-emerald-200 rotate-[-12deg] scale-110"
                      )}
                      style={{
                        animationDelay: isVisible && !entranceComplete && !isShaking && !isMatching ? `${delay}ms` : '0ms',
                      }}
                      title={isBlocked ? '未完全露出' : undefined}
                      type="button"
                    >
                      <span className="flex h-full w-full items-center justify-center drop-shadow-sm filter transition-transform">
                        {getTileContent(tile)}
                      </span>

                      {isMatching && (
                        <>
                          <span className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1/2 text-2xl animate-sparkle" style={{ animationDelay: '0.1s' }}>✨</span>
                          <span className="absolute bottom-0 left-0 -translate-x-1/4 translate-y-1/4 text-xl animate-sparkle" style={{ animationDelay: '0.2s' }}>💖</span>
                          <span className="absolute top-1/2 right-0 translate-x-1/2 -translate-y-1/2 text-xl animate-sparkle" style={{ animationDelay: '0.3s' }}>⭐</span>
                        </>
                      )}
                    </button>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="link-board-surface">
      <div className="absolute inset-0 bg-gradient-to-br from-white/40 to-transparent pointer-events-none" />

      <div
        ref={gridRef}
        className="link-board-grid"
        style={{
          gridTemplateColumns: `repeat(${config.cols}, minmax(0, 1fr))`,
          maxWidth: '100%',
          aspectRatio: `${config.cols} / ${config.rows}`,
        }}
      >
        {pathPointsList.length > 0 && (
          <svg className="absolute inset-0 w-full h-full pointer-events-none z-50 overflow-visible">
            <defs>
              <filter id="glow" x="-20%" y="-20%" width="140%" height="140%">
                <feGaussianBlur stdDeviation="4" result="coloredBlur"/>
                <feMerge>
                  <feMergeNode in="coloredBlur"/>
                  <feMergeNode in="SourceGraphic"/>
                </feMerge>
              </filter>
            </defs>
            {pathPointsList.map((points, idx) => {
              const colors = ['#f472b6', '#a78bfa', '#22d3ee'];
              const color = colors[idx % colors.length];
              return (
                <g key={idx}>
                  {/* 外层辉光 */}
                  <polyline
                    points={points}
                    fill="none"
                    stroke={color}
                    strokeWidth="8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="opacity-50 blur-sm"
                  />
                  {/* 主连线 */}
                  <polyline
                    points={points}
                    fill="none"
                    stroke={color}
                    strokeWidth="6"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    filter="url(#glow)"
                    className="animate-draw-line"
                  />
                  {/* 内层高光 */}
                  <polyline
                    points={points}
                    fill="none"
                    stroke="white"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="opacity-70"
                  />
                </g>
              );
            })}
          </svg>
        )}
        {tileLayout.map((tile, index) => {
          const isSelected = selected.includes(index);
          const isVisible = tile !== null;

          const isShaking = shakingTiles.includes(index) || shakingIndices.includes(index);
          const isMatching = matchingTiles.includes(index) || matchingIndices.includes(index);
          const row = Math.floor(index / config.cols);
          const col = index % config.cols;
          const delay = (row + col) * 50;

          return (
            <div key={index} className="relative group perspective-500">
              <button
                onClick={() => isVisible && onSelect(index)}
                disabled={!isVisible || isMatching}
                onAnimationEnd={(e) => handleAnimationEnd(e.animationName)}
                className={cn(
                  "relative w-full h-full flex items-center justify-center overflow-hidden text-xl sm:text-3xl md:text-4xl select-none transition-all duration-300 ease-[cubic-bezier(0.34,1.56,0.64,1)]",
                  "rounded-2xl sm:rounded-3xl aspect-square shadow-[0_3px_0_0_rgba(0,0,0,0.05)] active:shadow-none active:translate-y-[3px]",
                  isVisible
                    ? "bg-white border-b-4 border-r-2 border-l-2 border-t-2 border-white cursor-pointer hover:-translate-y-1 hover:shadow-[0_6px_0_0_rgba(0,0,0,0.05)]"
                    : "invisible opacity-0",

                  isVisible && !entranceComplete && "animate-tile-entrance",

                  isVisible && !isSelected && !isMatching && !isShaking && "bg-gradient-to-br from-white to-slate-50",
                  isSelected && isVisible && "animate-tile-pulse ring-4 ring-pink-400 border-pink-500 z-10 shadow-xl bg-pink-50 rotate-3 text-2xl sm:text-4xl md:text-5xl scale-[1.06] sm:scale-110",

                  isShaking && "animate-tile-shake bg-red-50 border-red-400 text-red-500 ring-4 ring-red-200 z-10 rotate-12",

                  isMatching && "animate-tile-match z-20 border-emerald-400 bg-emerald-50 ring-4 ring-emerald-200 rotate-[-12deg] scale-110 sm:scale-125"
                )}
                style={{
                  animationDelay: isVisible && !entranceComplete && !isShaking && !isMatching ? `${delay}ms` : '0ms'
                }}
              >
                <span className="flex h-full w-full transform items-center justify-center drop-shadow-sm filter transition-transform sm:hover:scale-110">
                  {getTileContent(tile)}
                </span>

                {isMatching && (
                  <>
                    <span className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1/2 text-2xl animate-sparkle" style={{ animationDelay: '0.1s' }}>✨</span>
                    <span className="absolute bottom-0 left-0 -translate-x-1/4 translate-y-1/4 text-xl animate-sparkle" style={{ animationDelay: '0.2s' }}>💖</span>
                    <span className="absolute top-1/2 right-0 translate-x-1/2 -translate-y-1/2 text-xl animate-sparkle" style={{ animationDelay: '0.3s' }}>⭐</span>
                    <span className="absolute -top-2 -right-2 text-xl animate-sparkle" style={{ animationDelay: '0.4s' }}>🍬</span>
                  </>
                )}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
