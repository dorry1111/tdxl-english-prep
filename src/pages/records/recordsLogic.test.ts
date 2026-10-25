/**
 * 做题记录纯函数单测：交卷判定 / 概览汇总 / 按试卷分组。
 *
 * 口径重点：进行中的答卷不参与平均分（否则 0 分会拉低均值），
 * 但计入套数、近 7 天与分组的「次数」。
 */
import { describe, expect, it } from 'vitest';

import type { Attempt } from '@/types';

import { groupByPaper, isSubmitted, summarize } from './recordsLogic';

const DAY = 24 * 60 * 60 * 1000;
const NOW = 1_700_000_000_000;

/** 造一条答卷；未交卷时要显式传 submittedAt: null（?? 会把 null 吃掉，这里用 in 判断） */
function attempt(patch: Partial<Attempt> & Pick<Attempt, 'id'>): Attempt {
  return {
    id: patch.id,
    paperId: patch.paperId ?? 'builtin-2025',
    mode: patch.mode ?? 'full',
    sectionType: patch.sectionType ?? null,
    startedAt: patch.startedAt ?? NOW,
    submittedAt: patch.submittedAt === undefined ? NOW : patch.submittedAt,
    durationSec: patch.durationSec ?? 3600,
    objectiveScore: patch.objectiveScore ?? 60,
    subjectiveScore: patch.subjectiveScore ?? null,
    totalScore: patch.totalScore ?? 78,
    deviceId: 'dev-a',
    updatedAt: patch.updatedAt ?? NOW,
    deletedAt: null,
  };
}

describe('isSubmitted', () => {
  it('submittedAt 非 null 视为已交卷', () => {
    expect(isSubmitted(attempt({ id: 'a', submittedAt: NOW }))).toBe(true);
    expect(isSubmitted(attempt({ id: 'b', submittedAt: null }))).toBe(false);
  });
});

describe('summarize', () => {
  it('平均分只统计已交卷，进行中计入套数', () => {
    const rows = [
      attempt({ id: 'a', totalScore: 80, durationSec: 600 }),
      attempt({ id: 'b', totalScore: 60, durationSec: 300 }),
      attempt({ id: 'c', submittedAt: null, totalScore: 0, durationSec: 120 }),
    ];
    const summary = summarize(rows, NOW);
    expect(summary.total).toBe(3);
    expect(summary.submitted).toBe(2);
    expect(summary.inProgress).toBe(1);
    expect(summary.avgScore).toBe(70);
    expect(summary.totalDurationSec).toBe(900);
    expect(summary.recent7d).toBe(3);
  });

  it('没有已交卷记录时平均分为 null', () => {
    const summary = summarize([attempt({ id: 'a', submittedAt: null })], NOW);
    expect(summary.avgScore).toBeNull();
    expect(summary.submitted).toBe(0);
    expect(summary.totalDurationSec).toBe(0);
  });

  it('近 7 天只算窗口内的记录', () => {
    const rows = [
      attempt({ id: 'recent', startedAt: NOW - 6 * DAY }),
      attempt({ id: 'edge', startedAt: NOW - 7 * DAY }), // 恰好 7 天：在窗口内
      attempt({ id: 'old', startedAt: NOW - 8 * DAY }),
    ];
    expect(summarize(rows, NOW).recent7d).toBe(2);
  });

  it('空列表各项归零', () => {
    expect(summarize([], NOW)).toEqual({
      total: 0,
      submitted: 0,
      inProgress: 0,
      avgScore: null,
      totalDurationSec: 0,
      recent7d: 0,
    });
  });
});

describe('groupByPaper', () => {
  const titles: Record<string, string> = {
    'builtin-2025': '2025 年真题',
    'builtin-2024': '2024 年真题',
  };
  const titleOf = (paperId: string): string | undefined => titles[paperId];

  it('按试卷分组，组内保持新→旧，组间按最近时间倒序', () => {
    const rows = [
      attempt({ id: 'p2025-1', paperId: 'builtin-2025', startedAt: NOW, totalScore: 82 }),
      attempt({ id: 'p2024-1', paperId: 'builtin-2024', startedAt: NOW - DAY, totalScore: 90 }),
      attempt({ id: 'p2025-2', paperId: 'builtin-2025', startedAt: NOW - 2 * DAY, totalScore: 70 }),
    ];
    const groups = groupByPaper(rows, titleOf);
    expect(groups.map((group) => group.paperId)).toEqual(['builtin-2025', 'builtin-2024']);
    expect(groups[0]?.attempts.map((row) => row.id)).toEqual(['p2025-1', 'p2025-2']);
    expect(groups[0]?.bestScore).toBe(82);
    expect(groups[1]?.bestScore).toBe(90);
  });

  it('最高分只看已交卷，进行中的 0 分不算', () => {
    const rows = [
      attempt({ id: 'a', paperId: 'builtin-2025', totalScore: 65 }),
      attempt({ id: 'b', paperId: 'builtin-2025', submittedAt: null, totalScore: 0 }),
    ];
    expect(groupByPaper(rows, titleOf)[0]?.bestScore).toBe(65);
  });

  it('全部未交卷时最高分为 null', () => {
    const rows = [attempt({ id: 'a', paperId: 'builtin-2025', submittedAt: null })];
    expect(groupByPaper(rows, titleOf)[0]?.bestScore).toBeNull();
  });

  it('试卷已被删除时用兜底标题', () => {
    const rows = [attempt({ id: 'a', paperId: 'gone-paper' })];
    expect(groupByPaper(rows, titleOf)[0]?.title).toBe('已删除的试卷');
  });
});
