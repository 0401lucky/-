'use client';

import { useState, useCallback, useRef, useEffect } from 'react';

interface LaunchControlProps {
  onLaunch: (angle: number, power: number) => void;
  disabled: boolean;
  ballsRemaining: number;
}

export function LaunchControl({ onLaunch, disabled, ballsRemaining }: LaunchControlProps) {
  const [isCharging, setIsCharging] = useState(false);
  const [power, setPower] = useState(0); // 0-100
  const chargeIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const chargeDirectionRef = useRef<1 | -1>(1); // 1 = 增加, -1 = 减少
  const isChargingRef = useRef(false); // 用于事件中同步状态
  const powerRef = useRef(0); // 用于事件中获取当前力度
  const buttonRef = useRef<HTMLButtonElement>(null);
  const activePointerIdRef = useRef<number | null>(null); // 多指保护

  // 清理 interval 的工具函数
  const clearChargeInterval = useCallback(() => {
    if (chargeIntervalRef.current) {
      clearInterval(chargeIntervalRef.current);
      chargeIntervalRef.current = null;
    }
  }, []);

  // 开始蓄力 - 同步更新 refs，防止竞态
  const startCharging = useCallback(() => {
    if (disabled || ballsRemaining === 0) return;
    
    // 如果已在蓄力中，先清理旧 interval（防止多重 interval 泄漏）
    if (isChargingRef.current) {
      clearChargeInterval();
    }
    
    // 同步更新 refs（在 setState 之前）
    isChargingRef.current = true;
    powerRef.current = 0;
    chargeDirectionRef.current = 1;
    
    // 更新 React 状态
    setIsCharging(true);
    setPower(0);
    
    // 力度条来回摆动
    chargeIntervalRef.current = setInterval(() => {
      setPower(prev => {
        const newPower = prev + chargeDirectionRef.current * 3;
        let result: number;
        if (newPower >= 100) {
          chargeDirectionRef.current = -1;
          result = 100;
        } else if (newPower <= 0) {
          chargeDirectionRef.current = 1;
          result = 0;
        } else {
          result = newPower;
        }
        // 同步更新 powerRef
        powerRef.current = result;
        return result;
      });
    }, 30);
  }, [disabled, ballsRemaining, clearChargeInterval]);

  // 停止蓄力并发射 - 同步更新 refs，防止重复触发
  const stopChargingAndLaunch = useCallback(() => {
    // 如果不在蓄力中，直接返回（使用 ref 判断，不依赖 effect）
    if (!isChargingRef.current) return;
    
    // 立即标记为非蓄力状态，防止重复调用
    isChargingRef.current = false;
    
    // 清理 interval
    clearChargeInterval();
    
    // 获取当前力度并发射
    const currentPower = powerRef.current;
    if (currentPower > 5) {
      // 角度随机 (-20 ~ +20)
      const randomAngle = (Math.random() - 0.5) * 40;
      // 力度映射到 0.5 ~ 1.0
      const launchPower = 0.5 + (currentPower / 100) * 0.5;
      onLaunch(randomAngle, launchPower);
    }
    
    // 重置状态
    powerRef.current = 0;
    setIsCharging(false);
    setPower(0);
    activePointerIdRef.current = null;
  }, [onLaunch, clearChargeInterval]);

  // Pointer Events 处理（统一鼠标和触摸）
  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    // 只响应主键（鼠标左键或触摸）
    if (e.button !== 0) return;
    
    // 多指保护：如果已有活动 pointer，忽略新的
    if (activePointerIdRef.current !== null) return;
    
    e.preventDefault();
    activePointerIdRef.current = e.pointerId;
    
    // 捕获指针，确保在元素外释放也能触发 pointerup
    try {
      buttonRef.current?.setPointerCapture(e.pointerId);
    } catch {
      // 忽略 capture 失败
    }
    
    startCharging();
  }, [startCharging]);

  const handlePointerUp = useCallback((e: React.PointerEvent) => {
    // 只处理当前活动的 pointer
    if (activePointerIdRef.current !== e.pointerId) return;
    
    e.preventDefault();
    try {
      buttonRef.current?.releasePointerCapture(e.pointerId);
    } catch {
      // 忽略 release 失败
    }
    
    stopChargingAndLaunch();
  }, [stopChargingAndLaunch]);

  const handlePointerCancel = useCallback((e: React.PointerEvent) => {
    // 只处理当前活动的 pointer
    if (activePointerIdRef.current !== e.pointerId) return;
    
    try {
      buttonRef.current?.releasePointerCapture(e.pointerId);
    } catch {
      // 忽略 release 失败
    }
    
    stopChargingAndLaunch();
  }, [stopChargingAndLaunch]);

  // 键盘支持：Space 按住蓄力，松开发射
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // 忽略输入框中的 Space
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
        return;
      }
      
      // 只响应 Space 键，且未在蓄力中（使用 ref 判断）
      if (e.code === 'Space' && !e.repeat && !isChargingRef.current) {
        e.preventDefault();
        startCharging();
      }
    };
    
    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space' && isChargingRef.current) {
        e.preventDefault();
        stopChargingAndLaunch();
      }
    };
    
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [startCharging, stopChargingAndLaunch]);

  // 失焦兜底：切后台、alt-tab 时强制停止
  useEffect(() => {
    const handleBlur = () => {
      if (isChargingRef.current) {
        stopChargingAndLaunch();
      }
    };
    
    const handleVisibilityChange = () => {
      if (document.hidden && isChargingRef.current) {
        stopChargingAndLaunch();
      }
    };
    
    window.addEventListener('blur', handleBlur);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    
    return () => {
      window.removeEventListener('blur', handleBlur);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [stopChargingAndLaunch]);

  // 组件卸载时清理
  useEffect(() => {
    return () => {
      clearChargeInterval();
    };
  }, [clearChargeInterval]);

  // 获取力度条颜色
  const getPowerColor = () => {
    if (power < 30) return 'from-green-400 to-green-500';
    if (power < 70) return 'from-yellow-400 to-orange-500';
    return 'from-red-400 to-red-600';
  };

  const canLaunch = !disabled && ballsRemaining > 0;

  return (
    <div className="flex flex-col items-center w-full">
      {/* 剩余弹珠 */}
      <div className="flex items-center gap-3 mb-6 bg-slate-50 px-4 py-2 rounded-full border border-slate-100">
        <span className="text-slate-500 text-xs font-bold uppercase tracking-wider">剩余弹珠</span>
        <div className="flex gap-1.5">
          {Array.from({ length: 5 }).map((_, i) => (
            <div
              key={i}
              className={`w-4 h-4 rounded-full transition-all duration-300 ${
                i < ballsRemaining 
                  ? 'bg-slate-900 scale-100 shadow-sm' 
                  : 'bg-slate-200 scale-75'
              }`}
            />
          ))}
        </div>
      </div>

      {/* 力度条 */}
      <div className="w-full max-w-xs mb-8">
        <div className="flex justify-between text-[10px] font-bold text-slate-400 mb-2 uppercase tracking-wider">
          <span>MIN</span>
          <span className={`tabular-nums text-sm transition-colors ${power > 70 ? 'text-red-500' : power > 30 ? 'text-orange-500' : 'text-green-500'}`}>
            {Math.round(power)}%
          </span>
          <span>MAX</span>
        </div>
        <div className="h-3 bg-slate-100 rounded-full overflow-hidden shadow-inner">
          <div 
            className={`h-full bg-gradient-to-r ${getPowerColor()} transition-all duration-75 rounded-full`}
            style={{ width: `${power}%` }}
          />
        </div>
      </div>

      {/* 发射按钮 - 使用 Pointer Events 统一处理 */}
      <button
        ref={buttonRef}
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
        disabled={!canLaunch}
        className={`
          relative w-36 h-36 rounded-full 
          transition-all duration-200 
          select-none touch-none
          flex items-center justify-center
          ${canLaunch 
            ? isCharging
              ? 'bg-slate-50 shadow-inner scale-95 border-4 border-slate-200'
              : 'bg-white shadow-[0_10px_40px_-10px_rgba(0,0,0,0.1)] hover:shadow-[0_20px_40px_-10px_rgba(0,0,0,0.2)] hover:-translate-y-1 border border-slate-100'
            : 'bg-slate-50 border border-slate-100 cursor-not-allowed opacity-60'
          }
        `}
      >
        {/* 按钮内圈 */}
        <div className={`
          w-28 h-28 rounded-full 
          flex items-center justify-center
          transition-all duration-200
          ${canLaunch
            ? isCharging
              ? 'bg-gradient-to-br from-red-500 to-red-600 shadow-inner scale-90'
              : 'bg-slate-900 hover:bg-slate-800 shadow-lg shadow-slate-200'
            : 'bg-slate-200'
          }
        `}>
          <div className="text-center">
            {!canLaunch ? (
              <span className="text-slate-400 text-xs font-bold uppercase tracking-wider">
                {ballsRemaining === 0 ? '完成' : '等待'}
              </span>
            ) : isCharging ? (
              <div className="text-white">
                <div className="text-3xl font-bold animate-pulse">🎯</div>
                <div className="text-[10px] font-bold mt-1 uppercase tracking-wide opacity-90">RELEASE</div>
              </div>
            ) : (
              <div className="text-white group">
                <div className="text-3xl mb-1 transform group-hover:scale-110 transition-transform">🚀</div>
                <div className="text-[10px] font-bold uppercase tracking-wide opacity-80">HOLD</div>
              </div>
            )}
          </div>
        </div>

        {/* 蓄力动画环 */}
        {isCharging && (
          <div 
            className="absolute inset-[-4px] rounded-full border-2 border-red-500/30 animate-ping"
            style={{ animationDuration: '1s' }}
          />
        )}
      </button>
      
      {!isCharging && canLaunch && (
         <div className="mt-4 text-xs font-medium text-slate-400 bg-slate-50 px-3 py-1 rounded-full border border-slate-100">
            按住 Space 也可以
         </div>
      )}
    </div>
  );
}
