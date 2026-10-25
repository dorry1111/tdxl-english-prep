/**
 * P02 学习会话页（T09，ARCHITECTURE 4.1 状态机）。
 *
 * 行为要点：
 * - 进入页面：有同日未完成快照 → 弹「继续上次 / 重新开始」二选一；否则自动 start()；
 *   无词可学（'empty'）→ Toast「今日已完成」并回首页；
 * - 一屏一词：点卡片 / 空格键揭示；1~4 数字键评分（桌面调试友好）；
 * - 四档评分直接提交，不弹任何确认框；答错可点「上一个」回退重答；
 * - 「上一个」：回退最近一次作答（四表逆向恢复 + 队列还原），可连续多次；
 * - 退出二次确认「当前进度已保存，确定退出？」，确认后 exit() 回首页；
 * - 结束（settled）→ 跳转结算页 /study/summary；
 * - ≥1024px 双栏：左卡片、右词条详情常驻。
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import { Navigate, useNavigate } from 'react-router';

import { RatingBar } from '@/components/word/RatingBar';
import { WordCard, type HighlightInput } from '@/components/word/WordCard';
import { WordDetailPanel } from '@/components/word/WordDetailPanel';
import { WordNotesSection } from '@/components/word/WordNotesSection';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { Icon } from '@/components/ui/Icon';
import { ProgressBar } from '@/components/ui/ProgressBar';
import { ACTIONS, ERROR_MESSAGES, HOME, ROUTES, STUDY, homeContinueLabel } from '@/constants';
import { useBreakpoints } from '@/hooks/useMediaQuery';
import { useSpeak } from '@/hooks/useSpeak';
import {
  addHighlight,
  deleteHighlight,
  listHighlightsByStateKey,
} from '@/db/repos/noteRepo';
import { stateKeyOfNorm } from '@/lib/hash';
import { perfMarkFromFirstGesture } from '@/lib/perf';
import { getWordMemo, prefetchMemos } from '@/lib/wordbookCache';
import { primeSpeechOnFirstGesture } from '@/lib/tts';
import { useLiveQuery } from 'dexie-react-hooks';
import { computeProgress } from '@/lib/session/sessionMachine';
import { getSettings } from '@/db/repos/settingsRepo';
import { useGamepadActions } from '@/hooks/useGamepadActions';
import { useSessionStore, type ResumeInfo } from '@/store/sessionStore';
import { useUiStore } from '@/store/uiStore';
import type { Rating, WordHighlight, WordMemo } from '@/types';
import { resolveKeyAction, type KeyAction } from './studyLogic';

export default function StudyPage() {
  const navigate = useNavigate();
  const showInfo = useUiStore((state) => state.toast.info);

  const status = useSessionStore((state) => state.status);
  const machine = useSessionStore((state) => state.machine);
  const currentWord = useSessionStore((state) => state.currentWord);
  const revealed = useSessionStore((state) => state.revealed);
  const error = useSessionStore((state) => state.error);
  const checkResume = useSessionStore((state) => state.checkResume);
  const start = useSessionStore((state) => state.start);
  const reveal = useSessionStore((state) => state.reveal);
  const exit = useSessionStore((state) => state.exit);
  const back = useSessionStore((state) => state.back);
  const canBack = useSessionStore((state) => state.history.length > 0);

  const { speak, supported: ttsSupported } = useSpeak();
  const { canUseTwoColumn } = useBreakpoints();

  // 自定义快捷键（「我的 → 学习快捷键」；未配置时回退内置默认 1~4 / 手柄 A B X Y）
  const settings = useLiveQuery(() => getSettings(), [], undefined);
  const keyboardHotkeys = settings?.studyHotkeys?.keyboard;
  const gamepadHotkeys = settings?.studyHotkeys?.gamepad;

  const [resumeInfo, setResumeInfo] = useState<ResumeInfo | null>(null);
  const [exitOpen, setExitOpen] = useState(false);
  /** 标记「确认退出」后的导航离开，防止 idle 引导 effect 抢跑 */
  const leavingRef = useRef(false);
  /** 当前词条的文本高亮（笔记与高亮批次） */
  const [highlights, setHighlights] = useState<WordHighlight[]>([]);
  /** 当前词条的记忆内容（memo 分片：助记/词根兜底 + 易混/词形/考纲义项；仅答案态展示） */
  const [memo, setMemo] = useState<WordMemo | null>(null);

  const card = machine?.queue[0] ?? null;

  // ---------- memo：会话开始时按队列首字母预取分片；当前卡按需取内容 ----------
  useEffect(() => {
    if (status !== 'active' || !machine || machine.queue.length === 0) {
      return;
    }
    // wordId 形如 `core:<norm>`；队列里的词都会翻到，预取所需字母分片（已缓存零成本）
    const norms = machine.queue.map((item) => {
      const separator = item.wordId.indexOf(':');
      return separator >= 0 ? item.wordId.slice(separator + 1) : item.wordId;
    });
    void prefetchMemos(norms);
  }, [status, machine]);

  useEffect(() => {
    if (!currentWord) {
      setMemo(null);
      return;
    }
    let cancelled = false;
    void getWordMemo(currentWord.norm).then((result) => {
      if (!cancelled) {
        setMemo(result);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [currentWord]);

  // ---------- 引导：idle 时检查同日快照或自动开始 ----------
  useEffect(() => {
    // 首次交互时的语音准备：iOS/Safari 在手势栈内做静音解锁（必须），
    // 桌面端只在空闲时段预热语音列表（不在手势里发声，详见 lib/tts.ts 文件头）
    primeSpeechOnFirstGesture();
    if (status !== 'idle' || leavingRef.current) {
      return;
    }
    let cancelled = false;
    void (async () => {
      const resume = await checkResume();
      if (cancelled || leavingRef.current) {
        return;
      }
      if (resume) {
        setResumeInfo(resume);
        return;
      }
      const result = await start();
      if (cancelled) {
        return;
      }
      if (result === 'empty') {
        showInfo(HOME.todayDone);
        navigate(ROUTES.home, { replace: true });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [status, checkResume, start, navigate, showInfo]);

  // ---------- 评分（四档直接提交，不弹确认框；答错走「上一个」回退） ----------
  const handleRate = useCallback(
    (rating: Rating) => {
      const state = useSessionStore.getState();
      if (!state.machine || !state.machine.queue[0]) {
        return;
      }
      void state.submit(rating);
    },
    [],
  );

  // ---------- 揭示答案（点卡片 / 点「显示答案」）：同步 setState + 性能打点 ----------
  // 打点只在 ?perf=1 时输出，用来验证「点下去 → 揭示」之间到底被谁占住了主线程
  const handleReveal = useCallback((): void => {
    perfMarkFromFirstGesture('study:reveal');
    reveal();
  }, [reveal]);

  // ---------- 键盘：空格揭示 / 评级键评分（默认 1~4，可在「我的」自定义）/ ← 返回上一个 ----------
  useEffect(() => {
    if (status !== 'active') {
      return;
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (exitOpen) {
        return;
      }
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
      ) {
        return;
      }
      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        void useSessionStore.getState().back();
        return;
      }
      const action = resolveKeyAction(event.key, revealed, keyboardHotkeys);
      if (!action) {
        return;
      }
      event.preventDefault();
      if (action.type === 'reveal') {
        reveal();
      } else {
        handleRate(action.rating);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [status, revealed, exitOpen, reveal, handleRate, keyboardHotkeys]);

  // ---------- 手柄：A/B/X/Y 评级（默认）、Start 揭示，可在「我的」自定义按钮 ----------
  useGamepadActions(
    useCallback(
      (action: KeyAction) => {
        if (action.type === 'reveal') {
          reveal();
        } else {
          handleRate(action.rating);
        }
      },
      [reveal, handleRate],
    ),
    status === 'active' && revealed && !exitOpen,
    gamepadHotkeys,
  );

  // ---------- 出卡自动发音（ttsAutoPlay 开启时） ----------
  const wordId = currentWord?.id ?? null;
  useEffect(() => {
    if (status === 'active' && currentWord) {
      speak(currentWord.headword, { auto: true });
    }
    // 只依赖词 id：同一张卡不重复发音
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wordId, status]);

  // ---------- 高亮：随词条加载，增删走 noteRepo（写 wordbook.json 脏标记） ----------
  useEffect(() => {
    if (!currentWord) {
      setHighlights([]);
      return;
    }
    let cancelled = false;
    const stateKey = stateKeyOfNorm(currentWord.norm);
    void listHighlightsByStateKey(stateKey).then((rows) => {
      if (!cancelled) {
        setHighlights(rows);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [currentWord]);

  const handleAddHighlight = useCallback(
    async (input: HighlightInput): Promise<void> => {
      const word = useSessionStore.getState().currentWord;
      if (!word) {
        return;
      }
      try {
        const saved = await addHighlight({
          stateKey: stateKeyOfNorm(word.norm),
          wordId: word.id,
          ...input,
        });
        setHighlights((prev) => [...prev, saved]);
      } catch {
        useUiStore.getState().toast.error(ERROR_MESSAGES.DB_WRITE_FAILED);
      }
    },
    [],
  );

  const handleDeleteHighlight = useCallback(async (id: string): Promise<void> => {
    try {
      await deleteHighlight(id);
      setHighlights((prev) => prev.filter((hl) => hl.id !== id));
    } catch {
      useUiStore.getState().toast.error(ERROR_MESSAGES.DB_WRITE_FAILED);
    }
  }, []);

  // ---------- 浏览器返回手势：弹退出确认而非静默退出 ----------
  const active = status === 'active';
  useEffect(() => {
    if (!active) {
      return;
    }
    // 压入一个哨兵记录：popstate 到来时只是回到哨兵，弹确认框，不离开页面
    window.history.pushState({ tdxlStudyGuard: true }, '');
    const onPopState = (): void => {
      if (leavingRef.current) {
        return;
      }
      setExitOpen(true);
      window.history.pushState({ tdxlStudyGuard: true }, '');
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, [active]);

  // ---------- 退出确认 ----------
  const handleExitConfirm = (): void => {
    leavingRef.current = true;
    setExitOpen(false);
    exit();
    navigate(ROUTES.home);
  };

  // ---------- 快照二选一 ----------
  const handleResume = async (options?: { resume?: boolean }): Promise<void> => {
    setResumeInfo(null);
    const result = await start(options);
    if (result === 'empty') {
      showInfo(HOME.todayDone);
      navigate(ROUTES.home, { replace: true });
    }
  };

  // ---------- 渲染 ----------
  // 结算 → 结算页（放在全部 hook 之后，避免条件 hook）
  if (status === 'settled') {
    return <Navigate to={ROUTES.studySummary} replace />;
  }

  if (status !== 'active' || !machine || !card) {
    return (
      <>
        <div className="flex flex-col items-center gap-3 py-12" role="status">
          <span
            aria-hidden="true"
            className="h-6 w-6 animate-spin rounded-full border-2 border-border border-t-primary"
          />
          <p className="text-sm text-text-3">{HOME.start}</p>
        </div>

        <Dialog
          open={resumeInfo !== null}
          title={HOME.resumeTitle}
          description={HOME.resumeDesc}
          onClose={() => {
            // 关闭弹窗视为取消：回首页，不打断用户
            setResumeInfo(null);
            navigate(ROUTES.home);
          }}
          footer={
            <>
              <Button variant="secondary" onClick={() => void handleResume()}>
                {HOME.restart}
              </Button>
              <Button onClick={() => void handleResume({ resume: true })}>
                {resumeInfo ? homeContinueLabel(resumeInfo.answeredCount) : HOME.continueActive}
              </Button>
            </>
          }
        />
      </>
    );
  }

  const progress = computeProgress(machine);

  return (
    <div
      className={
        canUseTwoColumn
          ? 'flex flex-col gap-4'
          // 单栏（手机）：撑满视口剩余高度（扣除顶栏/底栏/安全区/main 上下留白），
          // 让评级条 mt-auto 强制贴底；高度组成为 TopBar(nav-h+safe-top) + pt-4 + pb(nav-h+safe-bottom+24)
          : 'flex min-h-[calc(100dvh-2*var(--nav-h)-var(--safe-top)-var(--safe-bottom)-40px)] flex-col gap-4'
      }
    >
      {/* 顶部：进度 + 退出 */}
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <ProgressBar
            value={progress.answered}
            max={progress.total}
            label={`${progress.answered} / ${progress.total}`}
          />
        </div>
        <Button
          variant="ghost"
          size="sm"
          aria-label={STUDY.backLabel}
          disabled={!canBack}
          onClick={() => void back()}
        >
          {STUDY.backLabel}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          aria-label={STUDY.exit}
          icon={<Icon name="close" size={18} />}
          onClick={() => setExitOpen(true)}
        >
          {STUDY.exit}
        </Button>
      </div>

      {error ? (
        <p role="alert" className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">
          {error}
        </p>
      ) : null}

      {/* 中部：卡片（单栏紧凑一屏直出；双栏右侧词条详情常驻） */}
      <div className={canUseTwoColumn ? 'flex items-stretch gap-4' : 'flex flex-col gap-2'}>
        <div className={canUseTwoColumn ? 'w-[55%] min-w-0' : 'w-full'}>
          <WordCard
            // key 变化强制重挂载：切卡无残留状态
            key={card.key}
            word={currentWord}
            revealed={revealed}
            kind={card.kind}
            onReveal={handleReveal}
            onSpeak={() => currentWord && speak(currentWord.headword)}
            speakDisabled={!ttsSupported}
            speakDisabledReason={ERROR_MESSAGES.TTS_UNAVAILABLE}
            highlights={highlights}
            onAddHighlight={(input) => void handleAddHighlight(input)}
            onDeleteHighlight={(id) => void handleDeleteHighlight(id)}
            compact={!canUseTwoColumn}
            memo={memo}
          />
        </div>
        {canUseTwoColumn ? (
          <aside className="w-[45%] min-w-0">
            <WordDetailPanel word={currentWord} revealed={revealed} />
          </aside>
        ) : null}
      </div>

      {/* 单栏（iPhone）：笔记与收藏一屏直出（串记/联想/谐音 + 用户例句 + 收藏 + 必应词典），
          双栏时右侧面板已含本区，不重复渲染。
          笔记可能写了词义，未揭示时同样不能露出 */}
      {!canUseTwoColumn && currentWord && revealed ? (
        <WordNotesSection key={currentWord.id} word={currentWord} compact />
      ) : null}

      {/* 底部：未揭示只有「显示答案」，揭示后四档评分条；sticky 吸底始终可见可答。
          偏移 = 底部 TabBar 高度（nav-h + 安全区），否则粘在视口底会被菜单栏盖住；
          桌面端（tablet+）无 TabBar，保持 bottom-0。
          mt-auto：单栏 min-h 撑满时把评级条推到视口底（短内容也贴底）；桌面无 min-h 时无效果 */}
      <div className="sticky bottom-[calc(var(--nav-h)+var(--safe-bottom))] z-10 mt-auto bg-bg pb-1 pt-2 tablet:bottom-0">
        {revealed ? (
          <RatingBar onRate={handleRate} />
        ) : (
          <Button block size="lg" className="h-14" onClick={handleReveal}>
            {STUDY.showAnswer}
          </Button>
        )}
      </div>

      {/* 退出二次确认 */}
      <Dialog
        open={exitOpen}
        title={STUDY.exitConfirmTitle}
        description={STUDY.exitConfirmDesc}
        onClose={() => setExitOpen(false)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setExitOpen(false)}>
              {ACTIONS.cancel}
            </Button>
            <Button variant="danger" onClick={handleExitConfirm}>
              {STUDY.exitConfirm}
            </Button>
          </>
        }
      />
    </div>
  );
}
