'use client';

import Matter from 'matter-js';
import seedrandom from 'seedrandom';
import { CANVAS_WIDTH, CANVAS_HEIGHT, BALL_RADIUS, PIN_RADIUS, PIN_ROWS, PIN_OFFSET, SLOT_COUNT, SLOT_WIDTH, SLOT_SCORES, LAUNCH_X, LAUNCH_Y } from './constants';

const { Engine, Render, Runner, Bodies, Composite, Events, Body } = Matter;

export interface PhysicsEngine {
  engine: Matter.Engine;
  render: Matter.Render;
  runner: Matter.Runner;
  start: () => void;
  stop: () => void;
  launchBall: (angle: number, power: number) => Promise<number>;
  reset: () => void;
}

export function createPhysicsEngine(
  canvas: HTMLCanvasElement,
  seed: string,
  onBallLanded: (slotIndex: number, score: number, duration: number) => void
): PhysicsEngine {
  const rng = seedrandom(seed);
  
  // 为每颗弹珠创建独立的随机数生成器
  let ballCount = 0;
  const getBallRng = () => seedrandom(`${seed}-ball-${ballCount++}-${Date.now()}`);
  
  // 创建物理引擎
  const engine = Engine.create({
    gravity: { x: 0, y: 1 }
  });

  // 创建渲染器
  const render = Render.create({
    canvas,
    engine,
    options: {
      width: CANVAS_WIDTH,
      height: CANVAS_HEIGHT,
      wireframes: false,
      background: '#1a1a2e',
    }
  });

  // 创建边界
  const walls = [
    Bodies.rectangle(CANVAS_WIDTH / 2, CANVAS_HEIGHT + 25, CANVAS_WIDTH, 50, { isStatic: true, render: { fillStyle: '#2a2a4e' } }),
    Bodies.rectangle(-25, CANVAS_HEIGHT / 2, 50, CANVAS_HEIGHT, { isStatic: true, render: { fillStyle: '#2a2a4e' } }),
    Bodies.rectangle(CANVAS_WIDTH + 25, CANVAS_HEIGHT / 2, 50, CANVAS_HEIGHT, { isStatic: true, render: { fillStyle: '#2a2a4e' } }),
  ];

  // 创建钉子（交错排列，覆盖整个槽位宽度）
  const pins: Matter.Body[] = [];
  const PIN_SPACING = SLOT_WIDTH; // 钉子水平间距 = 槽位宽度
  
  for (let row = 0; row < PIN_ROWS; row++) {
    // 偶数行和奇数行交错，确保覆盖整个宽度
    const isEvenRow = row % 2 === 0;
    // 偶数行：从半个间距开始，确保居中对称
    // 奇数行：从0开始，与偶数行交错
    const startX = isEvenRow ? PIN_SPACING / 2 : 0;
    const endX = CANVAS_WIDTH;
    
    for (let x = startX; x <= endX; x += PIN_SPACING) {
      // 跳过太靠近边界的钉子（留出弹珠直径的空间）
      if (x < PIN_RADIUS * 2 || x > CANVAS_WIDTH - PIN_RADIUS * 2) continue;
      
      const y = PIN_OFFSET + 80 + row * 40;
      
      // 添加随机偏移
      const jitterX = (rng() - 0.5) * 5;
      const jitterY = (rng() - 0.5) * 5;
      
      pins.push(Bodies.circle(x + jitterX, y + jitterY, PIN_RADIUS, {
        isStatic: true,
        restitution: 0.6 + rng() * 0.4, // 弹性随机 0.6~1.0，增加不确定性
        render: { fillStyle: '#4a4a6a' }
      }));
    }
  }

  // 创建槽位分隔板
  const slotDividers: Matter.Body[] = [];
  const slotY = CANVAS_HEIGHT - 40;
  
  for (let i = 0; i <= SLOT_COUNT; i++) {
    slotDividers.push(Bodies.rectangle(i * SLOT_WIDTH, slotY, 4, 80, {
      isStatic: true,
      render: { fillStyle: '#2a2a4e' }
    }));
  }

  // 创建槽位传感器
  const slotSensors: Matter.Body[] = [];
  for (let i = 0; i < SLOT_COUNT; i++) {
    const sensor = Bodies.rectangle(
      i * SLOT_WIDTH + SLOT_WIDTH / 2,
      CANVAS_HEIGHT - 20,
      SLOT_WIDTH - 4,
      30,
      {
        isStatic: true,
        isSensor: true,
        label: `slot_${i}`,
        render: { 
          fillStyle: getSlotColor(SLOT_SCORES[i]),
          opacity: 0.6 
        }
      }
    );
    slotSensors.push(sensor);
  }

  Composite.add(engine.world, [...walls, ...pins, ...slotDividers, ...slotSensors]);

  const runner = Runner.create();

  // 发射弹珠
  let activeBall: Matter.Body | null = null;
  let launchTime = 0;
  let resolvePromise: ((score: number) => void) | null = null;

  Events.on(engine, 'collisionStart', (event) => {
    for (const pair of event.pairs) {
      const { bodyA, bodyB } = pair;
      
      // 检查是否是弹珠碰撞槽位传感器
      const ball = [bodyA, bodyB].find(b => b.label === 'ball');
      const sensor = [bodyA, bodyB].find(b => b.label?.startsWith('slot_'));
      
      if (ball && sensor && ball === activeBall) {
        const slotIndex = parseInt(sensor.label!.split('_')[1]);
        const score = SLOT_SCORES[slotIndex];
        const duration = Date.now() - launchTime;
        
        // 移除弹珠
        Composite.remove(engine.world, ball);
        activeBall = null;
        
        // 通知回调
        onBallLanded(slotIndex, score, duration);
        
        // 解析 Promise
        if (resolvePromise) {
          resolvePromise(score);
          resolvePromise = null;
        }
      }
    }
  });

  return {
    engine,
    render,
    runner,
    start: () => {
      Render.run(render);
      Runner.run(runner, engine);
    },
    stop: () => {
      Render.stop(render);
      Runner.stop(runner);
    },
    launchBall: (angle: number, power: number): Promise<number> => {
      return new Promise((resolve) => {
        // 移除之前的弹珠
        if (activeBall) {
          Composite.remove(engine.world, activeBall);
        }
        
        // 为这颗弹珠创建随机扰动
        const ballRng = getBallRng();
        
        // 随机扰动：位置偏移 ±3px，角度偏移 ±2°，力度偏移 ±5%
        const posJitterX = (ballRng() - 0.5) * 6;
        const posJitterY = (ballRng() - 0.5) * 4;
        const angleJitter = (ballRng() - 0.5) * 4;  // ±2度
        const powerJitter = (ballRng() - 0.5) * 0.1; // ±5%
        
        const actualAngle = angle + angleJitter;
        const actualPower = Math.max(0.4, Math.min(1.1, power + powerJitter));
        
        // 创建新弹珠（位置有轻微随机偏移）
        const ball = Bodies.circle(
          LAUNCH_X + posJitterX, 
          LAUNCH_Y + posJitterY, 
          BALL_RADIUS, 
          {
            label: 'ball',
            restitution: 0.5 + ballRng() * 0.3, // 弹性随机 0.5~0.8
            friction: 0.005 + ballRng() * 0.01, // 摩擦随机
            frictionAir: 0.0005 + ballRng() * 0.001, // 空气阻力随机
            render: { fillStyle: '#ffd700' }
          }
        );
        
        // 计算初始速度（带随机扰动）
        const radians = (actualAngle * Math.PI) / 180;
        const baseVelocity = 15;
        const velocity = baseVelocity * actualPower;
        
        Body.setVelocity(ball, {
          x: Math.sin(radians) * velocity,
          y: Math.cos(radians) * velocity
        });
        
        Composite.add(engine.world, ball);
        activeBall = ball;
        launchTime = Date.now();
        resolvePromise = resolve;
        
        // 超时处理（10秒后自动解决）
        setTimeout(() => {
          if (activeBall === ball) {
            // 根据球的 x 位置计算落入的槽位
            const ballX = ball.position.x;
            const slotIndex = Math.min(
              Math.max(0, Math.floor(ballX / SLOT_WIDTH)),
              SLOT_COUNT - 1
            );
            const score = SLOT_SCORES[slotIndex];
            const duration = Date.now() - launchTime;
            
            Composite.remove(engine.world, ball);
            activeBall = null;
            
            // 通知回调
            onBallLanded(slotIndex, score, duration);
            resolve(score);
          }
        }, 10000);
      });
    },
    reset: () => {
      if (activeBall) {
        Composite.remove(engine.world, activeBall);
        activeBall = null;
      }
    }
  };
}

function getSlotColor(score: number): string {
  const colors: Record<number, string> = {
    5: '#3a3a5a',
    10: '#4a5a6a',
    20: '#5a6a7a',
    40: '#6a7a8a',
    80: '#ff6b6b',
  };
  return colors[score] || '#3a3a5a';
}
