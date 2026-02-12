'use client';

import { useEffect, useRef } from 'react';
import {
  drawSprite,
  PLAYER_SPRITE,
  MONSTER_SPRITE,
  ADD_SPRITE,
  MULTIPLY_SPRITE,
  PLAYER_PALETTE,
  MONSTER_PALETTE,
  ADD_PALETTE,
  MULTIPLY_PALETTE,
} from '../lib/sprites';
import { COLORS, CANVAS_WIDTH, CANVAS_HEIGHT, PIXEL_SCALE, SPRITE_SIZE } from '../lib/constants';
import type { TowerLaneContent, TowerFloor } from '@/lib/tower-engine';

interface TowerCanvasProps {
  currentFloor: TowerFloor | null;
  playerPower: number;
  floorNumber: number;
  animState: 'idle' | 'walking' | 'attacking' | 'powerup' | 'death' | 'nextFloor';
  selectedLane: number | null;
  /** 飘字动画列表 */
  floatingTexts: Array<{ text: string; x: number; y: number; color: string; age: number }>;
}

const SPRITE_RENDER_SIZE = SPRITE_SIZE * PIXEL_SCALE;

export default function TowerCanvas({
  currentFloor,
  playerPower,
  floorNumber,
  animState,
  selectedLane,
  floatingTexts,
}: TowerCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animFrameRef = useRef<number>(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let running = true;

    const render = () => {
      if (!running) return;

      ctx.imageSmoothingEnabled = false;

      // 背景
      ctx.fillStyle = COLORS.bg;
      ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

      // 砖块纹理背景
      drawBricks(ctx);

      // 楼层信息
      ctx.fillStyle = COLORS.floorText;
      ctx.font = 'bold 14px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(`FLOOR ${floorNumber}`, CANVAS_WIDTH / 2, 30);

      // 力量值
      ctx.fillStyle = COLORS.powerText;
      ctx.font = 'bold 18px monospace';
      ctx.fillText(`POWER: ${playerPower}`, CANVAS_WIDTH / 2, 56);

      // 画通道
      if (currentFloor) {
        const laneCount = currentFloor.lanes.length;
        const laneWidth = CANVAS_WIDTH / laneCount;

        for (let i = 0; i < laneCount; i++) {
          const lane = currentFloor.lanes[i];
          const laneX = i * laneWidth;
          const laneCenterX = laneX + laneWidth / 2;

          // 通道分隔线
          if (i > 0) {
            ctx.strokeStyle = 'rgba(255,255,255,0.1)';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(laneX, 80);
            ctx.lineTo(laneX, CANVAS_HEIGHT - 120);
            ctx.stroke();
          }

          // 选中高亮
          if (selectedLane === i) {
            ctx.fillStyle = 'rgba(255,255,255,0.08)';
            ctx.fillRect(laneX, 80, laneWidth, CANVAS_HEIGHT - 200);
          }

          // 绘制通道内容
          const entityY = 160;
          drawLaneEntity(ctx, lane, laneCenterX - SPRITE_RENDER_SIZE / 2, entityY);

          // 数字标签
          ctx.textAlign = 'center';
          ctx.font = 'bold 20px monospace';

          if (lane.type === 'monster') {
            const canBeat = playerPower > lane.value;
            ctx.fillStyle = canBeat ? '#66bb6a' : '#ef5350';
            ctx.fillText(`${lane.value}`, laneCenterX, entityY + SPRITE_RENDER_SIZE + 24);

            // 小提示
            ctx.font = '10px monospace';
            ctx.fillStyle = canBeat ? 'rgba(102,187,106,0.7)' : 'rgba(239,83,80,0.7)';
            ctx.fillText(canBeat ? 'CAN BEAT' : 'DANGER!', laneCenterX, entityY + SPRITE_RENDER_SIZE + 40);
          } else if (lane.type === 'add') {
            ctx.fillStyle = '#66bb6a';
            ctx.fillText(`+${lane.value}`, laneCenterX, entityY + SPRITE_RENDER_SIZE + 24);
          } else if (lane.type === 'multiply') {
            ctx.fillStyle = '#ffa726';
            ctx.fillText(`x${lane.value}`, laneCenterX, entityY + SPRITE_RENDER_SIZE + 24);
          }
        }
      }

      // 玩家角色
      const playerX = CANVAS_WIDTH / 2 - SPRITE_RENDER_SIZE / 2;
      let playerY = CANVAS_HEIGHT - 140;

      if (animState === 'walking') {
        // 行走动画 - 上下浮动
        playerY -= Math.sin(Date.now() / 150) * 4;
      } else if (animState === 'death') {
        // 死亡闪烁
        if (Math.floor(Date.now() / 100) % 2 === 0) {
          ctx.globalAlpha = 0.3;
        }
      }

      drawSprite(ctx, PLAYER_SPRITE, PLAYER_PALETTE, playerX, playerY, PIXEL_SCALE);
      ctx.globalAlpha = 1;

      // 玩家头顶力量值
      ctx.fillStyle = COLORS.powerText;
      ctx.font = 'bold 16px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(`${playerPower}`, CANVAS_WIDTH / 2, playerY - 8);

      // 飘字特效
      for (const ft of floatingTexts) {
        const alpha = Math.max(0, 1 - ft.age / 60);
        ctx.globalAlpha = alpha;
        ctx.fillStyle = ft.color;
        ctx.font = 'bold 18px monospace';
        ctx.textAlign = 'center';
        ctx.fillText(ft.text, ft.x, ft.y - ft.age * 0.8);
      }
      ctx.globalAlpha = 1;

      animFrameRef.current = requestAnimationFrame(render);
    };

    animFrameRef.current = requestAnimationFrame(render);

    return () => {
      running = false;
      cancelAnimationFrame(animFrameRef.current);
    };
  }, [currentFloor, playerPower, floorNumber, animState, selectedLane, floatingTexts]);

  return (
    <canvas
      ref={canvasRef}
      width={CANVAS_WIDTH}
      height={CANVAS_HEIGHT}
      className="rounded-2xl border-2 border-slate-700 shadow-xl bg-slate-900 mx-auto block"
      style={{ imageRendering: 'pixelated' }}
    />
  );
}

function drawBricks(ctx: CanvasRenderingContext2D) {
  const brickW = 24;
  const brickH = 12;
  for (let y = 0; y < CANVAS_HEIGHT; y += brickH) {
    const offset = (Math.floor(y / brickH) % 2) * (brickW / 2);
    for (let x = -brickW; x < CANVAS_WIDTH + brickW; x += brickW) {
      ctx.fillStyle = COLORS.brick;
      ctx.fillRect(x + offset, y, brickW - 1, brickH - 1);
      // 顶部高光
      ctx.fillStyle = COLORS.brickLight;
      ctx.fillRect(x + offset, y, brickW - 1, 1);
    }
  }
  // 半透明覆盖层让背景不那么嘈杂
  ctx.fillStyle = 'rgba(26, 26, 46, 0.75)';
  ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
}

function drawLaneEntity(
  ctx: CanvasRenderingContext2D,
  lane: TowerLaneContent,
  x: number,
  y: number
) {
  if (lane.type === 'monster') {
    drawSprite(ctx, MONSTER_SPRITE, MONSTER_PALETTE, x, y, PIXEL_SCALE);
  } else if (lane.type === 'add') {
    drawSprite(ctx, ADD_SPRITE, ADD_PALETTE, x, y, PIXEL_SCALE);
  } else if (lane.type === 'multiply') {
    drawSprite(ctx, MULTIPLY_SPRITE, MULTIPLY_PALETTE, x, y, PIXEL_SCALE);
  }
}
