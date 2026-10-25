/**
 * 做题记录（一级导航，路由 /records）。
 *
 * - 一页看全：概览四格（累计套数 / 平均分 / 累计用时 / 近 7 天）；
 * - 两种视图：按试卷分组（默认，看单卷进步）与按时间平铺（看最近做了什么）；
 * - 已交卷 → 查看成绩 / 查看解析；未交卷 → 继续答题（attemptStore.restore 接上剩余时间）；
 * - 删除为软删（Attempt.deletedAt 墓碑），试卷与错题本不受影响。
 *
 * 数据全部来自本地 attempts 表（真题域目前不参与 WebDAV 同步），
 * 分组与汇总口径见 recordsLogic.ts。
 */
import { useCallback, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { useLiveQuery } from 'dexie-react-hooks';

import { ACTIONS, EXAMS, ROUTES } from '@/constants';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Dialog } from '@/components/ui/Dialog';
import { EmptyState } from '@/components/ui/EmptyState';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { Tag } from '@/components/ui/Tag';
import { listAllActive, softDeleteAttempt } from '@/db/repos/attemptRepo';
import { listExams } from '@/db/repos/examRepo';
import { fmtDate, fmtDuration } from '@/lib/time';
import { toUserMessage } from '@/lib/errors';
import { useAttemptStore } from '@/store/attemptStore';
import { useUiStore } from '@/store/uiStore';
import type { Attempt } from '@/types';

import { groupByPaper, isSubmitted, summarize } from './recordsLogic';

type RecordView = 'grouped' | 'timeline';

export default function RecordsPage() {
  const navigate = useNavigate();
  const toastError = useUiStore((state) => state.toast.error);
  const toastSuccess = useUiStore((state) => state.toast.success);
  const restore = useAttemptStore((state) => state.restore);

  const data = useLiveQuery(async () => {
    const [attempts, exams] = await Promise.all([listAllActive(), listExams()]);
    const titles: Record<string, string> = {};
    for (const exam of exams) {
      titles[exam.id] = exam.title;
    }
    return { attempts, titles };
  }, [], undefined);

  const [view, setView] = useState<RecordView>('grouped');
  const [pendingDelete, setPendingDelete] = useState<Attempt | null>(null);

  const summary = useMemo(
    () => (data === undefined ? null : summarize(data.attempts, Date.now())),
    [data],
  );
  const groups = useMemo(
    () =>
      data === undefined
        ? []
        : groupByPaper(data.attempts, (paperId) => data.titles[paperId]),
    [data],
  );
  const hasDeletedPaper = useMemo(
    () => (data === undefined ? false : data.attempts.some((row) => data.titles[row.paperId] === undefined)),
    [data],
  );

  const openResult = useCallback(
    (attempt: Attempt) => navigate(ROUTES.attemptResult.replace(':id', attempt.id)),
    [navigate],
  );
  const openReview = useCallback(
    (attempt: Attempt) => navigate(ROUTES.attemptReview.replace(':id', attempt.id)),
    [navigate],
  );
  const resume = useCallback(
    async (attempt: Attempt) => {
      const ok = await restore(attempt.id);
      if (!ok) {
        toastError(EXAMS.recordsResumeFailed);
        return;
      }
      navigate(ROUTES.attempt.replace(':id', attempt.id));
    },
    [navigate, restore, toastError],
  );

  const confirmDelete = useCallback(async () => {
    if (!pendingDelete) {
      return;
    }
    try {
      await softDeleteAttempt(pendingDelete.id);
      toastSuccess(EXAMS.recordsDeleted);
    } catch (error) {
      toastError(toUserMessage(error));
    }
    setPendingDelete(null);
  }, [pendingDelete, toastError, toastSuccess]);

  const renderRow = (attempt: Attempt, paperTitle: string | undefined, showPaper: boolean) => (
    <RecordRow
      key={attempt.id}
      attempt={attempt}
      paperTitle={paperTitle}
      showPaper={showPaper}
      onResult={() => openResult(attempt)}
      onReview={() => openReview(attempt)}
      onResume={() => void resume(attempt)}
      onDelete={() => setPendingDelete(attempt)}
    />
  );

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-lg font-semibold text-text">{EXAMS.recordsTitle}</h1>

      {data === undefined ? null : data.attempts.length === 0 ? (
        <Card>
          <EmptyState
            icon="exams"
            title={EXAMS.recordsEmptyTitle}
            description={EXAMS.recordsEmptyDesc}
          />
          <div className="mt-3 flex justify-center">
            <Button size="sm" onClick={() => navigate(ROUTES.exams)}>
              {EXAMS.recordsToExams}
            </Button>
          </div>
        </Card>
      ) : (
        <>
          {/* 概览四格 */}
          <div className="grid grid-cols-2 gap-2 tablet:grid-cols-4">
            <Stat label={EXAMS.recordsStatAttempts} value={EXAMS.recordsUnit(summary?.total ?? 0)} />
            <Stat
              label={EXAMS.recordsStatAvg}
              value={summary?.avgScore === null || summary === null ? '—' : summary.avgScore.toFixed(1)}
            />
            <Stat
              label={EXAMS.recordsStatDuration}
              value={fmtDuration(summary?.totalDurationSec ?? 0)}
            />
            <Stat label={EXAMS.recordsStatRecent} value={EXAMS.recordsUnit(summary?.recent7d ?? 0)} />
          </div>

          <SegmentedControl<RecordView>
            ariaLabel={EXAMS.recordsTitle}
            value={view}
            onChange={setView}
            options={[
              { value: 'grouped', label: EXAMS.recordsViewGrouped },
              { value: 'timeline', label: EXAMS.recordsViewTimeline },
            ]}
          />

          {view === 'grouped' ? (
            <div className="flex flex-col gap-3">
              {groups.map((group) => (
                <Card key={group.paperId} bodyClassName="py-3">
                  <div className="flex flex-col gap-1">
                    <h2 className="text-base font-semibold text-text">{group.title}</h2>
                    <p className="text-xs text-text-3">
                      {EXAMS.recordsUnit(group.attempts.length)}
                      {group.bestScore !== null ? ` · ${EXAMS.recordsBestOf(group.bestScore)}` : ''}
                      {` · ${EXAMS.recordsLastAt(fmtDate(group.lastAt, 'MM-DD HH:mm'))}`}
                    </p>
                    <ul className="mt-1 flex flex-col">
                      {group.attempts.map((attempt) =>
                        renderRow(attempt, group.title, false),
                      )}
                    </ul>
                  </div>
                </Card>
              ))}
            </div>
          ) : (
            <Card bodyClassName="py-3">
              <ul className="flex flex-col">
                {data.attempts.map((attempt) =>
                  renderRow(attempt, data.titles[attempt.paperId], true),
                )}
              </ul>
            </Card>
          )}

          {hasDeletedPaper ? (
            <p className="text-xs text-text-3">{EXAMS.recordsSummaryStale}</p>
          ) : null}
        </>
      )}

      {/* 删除确认 */}
      <Dialog
        open={pendingDelete !== null}
        title={EXAMS.recordsDeleteConfirmTitle}
        description={EXAMS.recordsDeleteConfirmDesc}
        onClose={() => setPendingDelete(null)}
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" size="sm" onClick={() => setPendingDelete(null)}>
              {ACTIONS.cancel}
            </Button>
            <Button variant="danger" size="sm" onClick={() => void confirmDelete()}>
              {EXAMS.recordsDelete}
            </Button>
          </div>
        }
      />
    </div>
  );
}

/** 概览格 */
function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col items-center gap-1 rounded-lg border border-border bg-surface px-2 py-3">
      <span className="text-xs text-text-2">{label}</span>
      <span className="text-lg font-semibold tabular-nums text-text">{value}</span>
    </div>
  );
}

/** 单条记录行 */
function RecordRow({
  attempt,
  paperTitle,
  showPaper,
  onResult,
  onReview,
  onResume,
  onDelete,
}: {
  attempt: Attempt;
  paperTitle: string | undefined;
  showPaper: boolean;
  onResult: () => void;
  onReview: () => void;
  onResume: () => void;
  onDelete: () => void;
}) {
  const submitted = isSubmitted(attempt);
  return (
    <li className="flex flex-col gap-2 border-b border-border py-3 last:border-b-0 tablet:flex-row tablet:items-center tablet:gap-3">
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-2 text-sm text-text">
          <span className="tabular-nums">{fmtDate(attempt.startedAt)}</span>
          <Tag>{attempt.mode === 'full' ? EXAMS.resultModeFull : EXAMS.resultModeSection}</Tag>
          {submitted ? (
            <Tag color="var(--c-success)">{EXAMS.recordsSubmitted}</Tag>
          ) : (
            <Tag color="var(--c-warn)">{EXAMS.recordsInProgress}</Tag>
          )}
        </p>
        <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-text-3">
          {showPaper && paperTitle ? <span className="truncate">{paperTitle}</span> : null}
          <span>{EXAMS.recordsDurationOf(fmtDuration(attempt.durationSec))}</span>
          {submitted ? (
            <>
              <span>{EXAMS.recordsObjectiveOf(attempt.objectiveScore)}</span>
              <span>{EXAMS.recordsTotalOf(attempt.totalScore)}</span>
            </>
          ) : null}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-1">
        {submitted ? (
          <>
            <Button size="sm" onClick={onResult}>
              {EXAMS.recordsViewResult}
            </Button>
            <Button variant="secondary" size="sm" onClick={onReview}>
              {EXAMS.recordsViewReview}
            </Button>
          </>
        ) : (
          <Button size="sm" onClick={onResume}>
            {EXAMS.recordsResume}
          </Button>
        )}
        <Button variant="ghost" size="sm" onClick={onDelete}>
          {EXAMS.recordsDelete}
        </Button>
      </div>
    </li>
  );
}
