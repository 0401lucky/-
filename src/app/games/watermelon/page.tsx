'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Apple, ArrowRight, Check, Leaf, LoaderCircle, Pause, Play, RotateCcw, Trophy, WifiOff } from 'lucide-react';
import GamePageShell from '../_components/GamePageShell';
import { useWatermelonBridge } from '@/lib/watermelon/useWatermelonBridge';
import { ApiError, watermelonAPI, type GameSubmitResp, type WatermelonActiveSession, type WatermelonStatus } from '@/lib/watermelon/api';
import { WATERMELON_FRUITS, watermelonFruitName } from '@/lib/watermelon/fruits';
import type { WatermelonProgress } from '@/lib/watermelon/bridge';
import { WatermelonSession, readWatermelonRecovery, reconcileWatermelon, watermelonRequest, type WatermelonRestore, type WatermelonSyncState } from '@/lib/watermelon/session';
import styles from './watermelon.module.css';

const request = <T,>(action: string, body?: unknown) => watermelonRequest(signal => watermelonAPI<T>(action, body, signal));
const EMPTY: WatermelonProgress = { tick: 0, moves: 0, score: 0, best: 0, highest: -1, held: 0, next: 0, phase: 'ready', overflow: 0, sound: false, locked: false };
const SYNC_TEXT: Record<WatermelonSyncState, string> = { saved: '进度自动保存', saving: '正在保存进度…', recovered: '已恢复，点击继续', offline: '连接中断，进度已保留', expired: '本局已结束或过期', settled: '本局已结算' };

export default function WatermelonPage() {
  const manager = useRef<WatermelonSession | null>(null);
  const alive = useRef(true);
  const actions = useRef({ claim: () => {}, practice: () => {}, freeze: async () => {} });
  const [status, setStatus] = useState<WatermelonStatus | null>(null);
  const [progress, setProgress] = useState(EMPTY);
  const [active, setActive] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState('');
  const [loginRequired, setLoginRequired] = useState(false);
  const [sync, setSync] = useState<WatermelonSyncState>('saved');
  const [result, setResult] = useState<GameSubmitResp | null>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [frameError, setFrameError] = useState(false);

  const bridge = useWatermelonBridge({
    progress(value) {
      if (!alive.current) return;
      setProgress(value);
      const round = manager.current;
      if (!round) return;
      round.progress(value.tick, value.moves);
      if (round.needsCheckpoint() && value.phase === 'playing' && !value.locked) {
        void round.checkpoint().catch(error => {
          if (alive.current && manager.current === round) setNotice(error instanceof Error ? error.message : '进度已保留，请重新连接。');
        });
      }
    },
    drop(drop, moves) {
      try { manager.current?.recordDrop(drop, moves); }
      catch (error) {
        setNotice(error instanceof Error ? error.message : '进度需要恢复。');
        setSync('offline');
        void actions.current.freeze().catch(() => {});
      }
    },
    claim: () => actions.current.claim(),
    practice: () => actions.current.practice(),
  });
  const { ready, initialize, capture, resume, complete } = bridge;

  const refreshStatus = useCallback(async () => {
    const next = await request<WatermelonStatus>('status');
    if (alive.current) { setStatus(next); setCooldown(next.cooldownRemaining); setLoginRequired(false); }
    return next;
  }, []);

  const restoreFrame = useCallback((plan: WatermelonRestore, paused = true) => initialize({
    mode: 'challenge', session_id: plan.session.session_id, seed: plan.session.seed,
    state: plan.session.state, limits: plan.session.limits, drops: plan.recovery.drops,
    to_tick: plan.recovery.to_tick, paused, locked: plan.recovery.finishing,
  }), [initialize]);

  const displayResult = useCallback((value: GameSubmitResp) => {
    if (!alive.current) return;
    setResult(value); setActive(false); setSync('settled'); setNotice('');
    void complete().catch(() => {});
    void refreshStatus().catch(() => {});
  }, [complete, refreshStatus]);

  const enterChallenge = useCallback(async (session: WatermelonActiveSession, userId: number, paused: boolean) => {
    const stored = readWatermelonRecovery(userId, session.session_id);
    let plan = reconcileWatermelon(userId, session, stored);
    manager.current?.dispose();
    const round = new WatermelonSession(userId, plan, {
      checkpoint: segment => request('checkpoint', segment),
      submit: segment => request('submit', segment),
      status: () => request('status'),
      cancel: sessionId => request('cancel', { session_id: sessionId }),
    }, {
      freeze: async () => { await capture(true); },
      restore: async restored => {
        if (!alive.current || manager.current !== round) return;
        await restoreFrame(restored);
        setNotice(restored.reset ? '已恢复到最近保存的进度。' : '进度已恢复，准备好就继续。');
      },
      state: value => { if (alive.current && manager.current === round) setSync(value); },
      settled: value => { if (alive.current && manager.current === round) displayResult(value); },
    });
    manager.current = round;
    setActive(true); setResult(null); setSync('saved');
    try { await restoreFrame(plan, paused || !!stored); }
    catch (error) {
      if (!stored) throw error;
      plan = reconcileWatermelon(userId, session, null);
      round.recovery = plan.recovery;
      round.progress(session.base_tick, session.base_moves);
      await restoreFrame(plan);
      setNotice('已恢复到最近保存的进度。');
      return;
    }
    if (plan.recovery.finishing) setNotice('上次结算尚未确认，点击“结算积分”继续。');
    else if (paused || stored) setNotice('上次的水果还在，点击继续这一杯。');
    else { setNotice(''); await resume(); }
  }, [capture, displayResult, restoreFrame, resume]);

  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; manager.current?.dispose(); manager.current = null; };
  }, []);

  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    void (async () => {
      try {
        const next = await refreshStatus();
        if (cancelled) return;
        if (next.active_session) await enterChallenge(next.active_session, next.userId, true);
        else await initialize({ mode: 'practice', session_id: null, ready: true });
      } catch (error) {
        if (cancelled) return;
        setLoginRequired(error instanceof ApiError && error.status === 401);
        setNotice(error instanceof ApiError && error.status === 401 ? '登录后可开启积分挑战，练习随时可玩。' : error instanceof Error ? error.message : '游戏服务暂不可用。');
      } finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [ready, refreshStatus, enterChallenge, initialize]);

  useEffect(() => {
    if (ready) return;
    const timer = window.setTimeout(() => setFrameError(true), 15000);
    return () => window.clearTimeout(timer);
  }, [ready]);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = window.setTimeout(() => setCooldown(value => Math.max(0, value - 1)), 1000);
    return () => window.clearTimeout(timer);
  }, [cooldown]);

  const runAction = useCallback(async (action: () => Promise<unknown>) => {
    setBusy(true); setNotice('');
    try { await action(); }
    catch (error) {
      if (alive.current) {
        setNotice(error instanceof Error ? error.message : '操作失败，请重试。');
        if (error instanceof ApiError && error.status === 401) setLoginRequired(true);
      }
    } finally { if (alive.current) setBusy(false); }
  }, []);

  const practice = useCallback(async () => {
    manager.current?.dispose(); manager.current = null;
    setActive(false); setResult(null); setSync('saved');
    await initialize({ mode: 'practice', session_id: null });
  }, [initialize]);
  const requestPractice = useCallback(() => {
    if (manager.current && !manager.current.result && !manager.current.expired) {
      setConfirmCancel(true);
      void capture(false).catch(() => {});
    } else void runAction(practice);
  }, [capture, practice, runAction]);
  const claim = useCallback(() => {
    const round = manager.current;
    if (round) void runAction(() => round.submit());
  }, [runAction]);
  useEffect(() => { actions.current = { claim, practice: requestPractice, freeze: async () => { await capture(true); } }; }, [claim, requestPractice, capture]);

  const start = () => void runAction(async () => {
    const next = await refreshStatus();
    const session = next.active_session ?? await request<WatermelonActiveSession>('start', {});
    await enterChallenge(session, next.userId, !!next.active_session);
  });
  const reconnect = () => void runAction(async () => {
    if (manager.current && !manager.current.result && !manager.current.expired) await manager.current.reconnect();
    else {
      const next = await refreshStatus();
      if (next.active_session) await enterChallenge(next.active_session, next.userId, true);
    }
  });
  const fruit = WATERMELON_FRUITS[progress.next];
  const best = Math.max(progress.best, ...(status?.records.map(record => record.score) ?? [0]));
  const expected = Math.min(status?.dailyRemaining ?? 0, status?.maxRoundPoints ?? 200, Math.floor(progress.score / (status?.rewardDivisor ?? 16)));
  const blocked = busy || loading || !ready;

  return <GamePageShell brandTitle="软软西瓜" brandIcon={Apple} balance={status?.balance}>
    <div className={styles.page}>
      <header className={styles.intro}>
        <div><p className={styles.eyebrow}><Leaf size={14} /> MELON MELT · 合成大西瓜</p><h1>让快乐，<em>软着陆。</em></h1></div>
        <p>一点重力，一点弹性。<br />让相同水果相遇，慢慢合成一颗大西瓜。</p>
      </header>
      <div className={styles.layout}>
        <section className={styles.playArea} aria-label="合成大西瓜游戏">
          <div className={styles.scorebar}>
            <div><span>{active ? '积分挑战' : '自由练习'}</span><strong>{progress.score.toLocaleString()}<small>分</small></strong></div>
            <div><span>最高分</span><b>{best.toLocaleString()}</b></div>
            <div className={styles.nextFruit}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={fruit.image} alt="" draggable={false} /><span>下一颗<br /><b>{fruit.name}</b></span>
            </div>
          </div>
          <div className={styles.boardWrap}>
            <iframe ref={bridge.iframe} src={bridge.src} onLoad={bridge.onLoad} className={styles.board} title="软软西瓜：左右拖动瞄准，松手投放；方向键移动，空格落下" allow="autoplay" />
            {!ready && <div className={styles.loading} role="status">{frameError ? <><p>游戏画面加载失败</p><button onClick={() => window.location.reload()}>重新加载</button></> : <><LoaderCircle className={styles.spin} />正在装好这一杯水果…</>}</div>}
          </div>
          <p className={styles.inputHint}>拖动瞄准，松手落下 <span>·</span> 方向键移动 / 空格投放 / P 暂停</p>
        </section>

        <aside className={styles.sidebar}>
          <section className={styles.panel}>
            <p className={styles.eyebrow}><Trophy size={15} /> 合成有收获</p>
            <h2>{result ? '这一杯，收好啦。' : '快乐，也能攒积分。'}</h2>
            {result ? <div className={styles.reward} role="status"><span>本局到账</span><strong>+{result.pointsEarned}<small>积分</small></strong><p>{result.record.score} 分 · 最高合成{watermelonFruitName(result.record.highestTile)}</p><Link href="/profile">查看个人战绩 <ArrowRight size={14} /></Link></div>
              : active ? <div className={styles.reward}><span>本局预计可得</span><strong>{expected}<small>积分</small></strong><p>最高合成：{progress.highest < 0 ? '还差一次合成' : WATERMELON_FRUITS[progress.highest].name}</p></div>
                : <p className={styles.copy}>让果冻水果软软地落下，<br />合成大西瓜，也攒下一份好运。</p>}

            <div className={styles.actions}>
              {active ? <>
                <button className={styles.primary} onClick={claim} disabled={blocked || sync === 'expired'}><Check size={17} />{busy ? '正在处理…' : '结算积分'}</button>
                {sync === 'offline' ? <button onClick={reconnect} disabled={busy}><RotateCcw size={16} />重新连接，恢复本局</button>
                  : <button disabled={blocked || progress.phase === 'over' || sync === 'expired'} onClick={() => void runAction(async () => { await capture(false); if (progress.phase === 'paused') await resume(); })}>{progress.phase === 'playing' ? <Pause size={16} /> : <Play size={16} />}{progress.phase === 'playing' ? '暂停一会' : '继续这一杯'}</button>}
                <button className={styles.quiet} onClick={requestPractice} disabled={busy}>结束挑战，去练习</button>
              </> : <>
                {loginRequired ? <Link className={styles.primary} href="/login?redirect=%2Fgames%2Fwatermelon">登录，挑战赢积分 <ArrowRight size={16} /></Link>
                  : <button className={styles.primary} onClick={start} disabled={blocked || cooldown > 0}><Play size={17} />{cooldown > 0 ? `${cooldown} 秒后再挑战` : result ? '再挑战一杯' : '开始积分挑战'}</button>}
                <button onClick={requestPractice} disabled={!ready || busy}><Leaf size={16} />{progress.phase === 'playing' && !result ? '重新练习' : '自由练习'}</button>
              </>}
            </div>
            {active && <p className={styles.sync} role="status">{sync === 'offline' ? <WifiOff size={13} /> : <Check size={13} />}{SYNC_TEXT[sync]}</p>}
            {notice && <div className={styles.notice} role="status">{notice}<button onClick={reconnect} disabled={busy || !ready}>重新连接</button></div>}
            <div className={styles.rules}>
              <p>每 <b>{status?.rewardDivisor ?? 16}</b> 分兑换 1 积分，单局最多 <b>{status?.maxRoundPoints ?? 200}</b> 积分。</p>
              <p>{status ? `今日游戏积分剩余 ${status.dailyRemaining} / ${status.dailyLimit}，与其他小游戏共享上限。` : '积分挑战与其他小游戏共享每日积分上限。'}</p>
              <p>可随时结算，按实际合成得分发放。练习不计积分，最高分保存在本机。</p>
            </div>
          </section>
          <section className={styles.tips}><h3>慢慢来，才装得下。</h3><p>同类水果相碰，就会融合升级。</p><p>软软的果肉会挤压变形，试着填满空隙。</p><p>别让水果长时间越过容器里的红色虚线。</p></section>
        </aside>
      </div>

      <section className={styles.evolution} aria-label="水果合成路线">
        <h2>从一颗葡萄，到一整个夏天。</h2><ol>{WATERMELON_FRUITS.map(item => <li key={item.id}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={item.image} alt="" loading="lazy" draggable={false} /><span>{item.name}</span>
        </li>)}</ol>
      </section>
      {!!status?.records.length && <section className={styles.records}><h2>最近的几杯</h2><div>{status.records.slice(0, 5).map(record => <p key={record.id}><span>{watermelonFruitName(record.highestTile)}</span><b>{record.score} 分</b><span>+{record.pointsEarned} 积分</span></p>)}</div></section>}
    </div>
    {confirmCancel && <div className={styles.modalBackdrop}><section className={styles.modal} role="dialog" aria-modal="true" aria-labelledby="watermelon-cancel-title"><h2 id="watermelon-cancel-title">结束这一杯挑战？</h2><p>直接结束不会获得积分。也可以保留这杯，先结算已经合成的得分。</p><button autoFocus onClick={() => setConfirmCancel(false)} disabled={busy}>保留这一杯</button><button onClick={() => void runAction(async () => { await manager.current?.cancel(); setConfirmCancel(false); await practice(); await refreshStatus(); })} disabled={busy}>结束，去练习</button></section></div>}
  </GamePageShell>;
}
