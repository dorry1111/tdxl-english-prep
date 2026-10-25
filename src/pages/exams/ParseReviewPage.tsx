/**
 * P12 切题校对页（T13）。
 *
 * - 双栏（≥1024px）：左原文（区段标题行高亮、点击结构树项定位滚动），
 *   右结构树（区段 → 文章 → 题目，拖拽改区段归属）；
 * - 移动端单栏，SegmentedControl 切换「原文 / 结构」；
 * - unresolved 行红框置顶展示（点击定位原文行）；
 * - 「确认并保存试卷」→ 按当前题目归属重算区段 → savePaper 且
 *   parseStatus='verified'。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router';

import { EXAMS, ROUTES, SECTION_META, SECTION_TYPES_BY_ORDER } from '@/constants';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { getPaperDetail, savePaper } from '@/db/repos/examRepo';
import { toUserMessage } from '@/lib/errors';
import { ParseTree } from '@/components/exam/ParseTree';
import { useParseDraftStore } from '@/store/parseDraftStore';
import { useUiStore } from '@/store/uiStore';
import type { Exam, Passage, Question, Section, SectionType } from '@/types';

type ReviewPane = 'original' | 'tree';

/** 找原文行：题目定位用 stem 前 12 个字符匹配；区段标题用第一条题目所属行 */
function findLineIndexOfStem(lines: string[], stem: string): number {
  const needle = stem.replace(/\s+/g, ' ').slice(0, 12);
  if (needle.length === 0) {
    return -1;
  }
  return lines.findIndex((line) => line.replace(/\s+/g, ' ').includes(needle));
}

export default function ParseReviewPage() {
  const params = useParams<{ id: string }>();
  const paperId = params.id ?? '';
  const navigate = useNavigate();
  const toastError = useUiStore((state) => state.toast.error);
  const toastSuccess = useUiStore((state) => state.toast.success);
  const parseDraft = useParseDraftStore();

  const [exam, setExam] = useState<Exam | null>(null);
  const [passages, setPassages] = useState<Passage[]>([]);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [activeQuestionId, setActiveQuestionId] = useState<string | null>(null);
  const [activeLineIndex, setActiveLineIndex] = useState<number>(-1);
  const [pane, setPane] = useState<ReviewPane>('original');
  const [saving, setSaving] = useState(false);
  const lineRefs = useRef<Array<HTMLParagraphElement | null>>([]);

  const rawText = parseDraft.paperId === paperId ? parseDraft.rawText : '';
  const draft = parseDraft.paperId === paperId ? parseDraft.draft : null;
  const lines = useMemo(() => rawText.split('\n'), [rawText]);

  useEffect(() => {
    let cancelled = false;
    void getPaperDetail(paperId).then((detail) => {
      if (cancelled) {
        return;
      }
      if (detail.exam) {
        setExam(detail.exam);
        setPassages(detail.passages);
        setQuestions(detail.questions);
      }
      setLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, [paperId]);

  /** 结构树点击 → 左栏定位滚动 */
  const selectQuestion = useCallback(
    (question: Question) => {
      setActiveQuestionId(question.id);
      const lineIndex = findLineIndexOfStem(lines, question.stem);
      setActiveLineIndex(lineIndex);
      if (lineIndex >= 0) {
        lineRefs.current[lineIndex]?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
      setPane('original'); // 移动端切换到原文栏查看定位
    },
    [lines],
  );

  const selectUnresolvedLine = useCallback(
    (lineNo: number) => {
      const index = lines.findIndex((_, i) => i + 1 === lineNo);
      setActiveLineIndex(index);
      if (index >= 0) {
        lineRefs.current[index]?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
      setPane('original');
    },
    [lines],
  );

  /** 拖拽改区段归属：同步修正 sectionType / isObjective / passageId（跨题型移动丢文章） */
  const moveQuestion = useCallback((questionId: string, target: SectionType) => {
    setQuestions((prev) =>
      prev.map((question) => {
        if (question.id !== questionId || question.sectionType === target) {
          return question;
        }
        const stillPassageBearing =
          (target === 'reading' || target === 'cloze' || target === 'short-completion') &&
          (question.sectionType === 'reading' ||
            question.sectionType === 'cloze' ||
            question.sectionType === 'short-completion');
        return {
          ...question,
          sectionType: target,
          isObjective: SECTION_META[target].isObjective,
          passageId: stillPassageBearing ? question.passageId : null,
        };
      }),
    );
  }, []);

  /** 确认保存：按当前归属重算区段 → verified 落库 */
  const confirmSave = useCallback(async () => {
    if (!exam) {
      return;
    }
    setSaving(true);
    try {
      const sections: Section[] = SECTION_TYPES_BY_ORDER.map((type, index) => {
        const inSection = questions.filter((question) => question.sectionType === type);
        if (inSection.length === 0) {
          return null;
        }
        return {
          type,
          order: index + 1,
          score: inSection.reduce((sum, question) => sum + question.score, 0),
          questionCount: inSection.length,
          passageIds: passages
            .filter((passage) => passage.sectionType === type)
            .map((passage) => passage.id),
        };
      }).filter((section): section is Section => section !== null);
      const nextExam: Exam = {
        ...exam,
        sections,
        totalQuestions: questions.length,
        totalScore: sections.reduce((sum, section) => sum + section.score, 0),
        parseStatus: 'verified',
      };
      await savePaper(nextExam, passages, questions);
      parseDraft.clear();
      toastSuccess(EXAMS.reviewSaved);
      navigate(ROUTES.exams);
    } catch (error) {
      toastError(toUserMessage(error));
    } finally {
      setSaving(false);
    }
  }, [exam, navigate, passages, parseDraft, questions, toastError, toastSuccess]);

  if (!loaded) {
    return (
      <Card title={EXAMS.reviewTitle}>
        <p className="text-sm text-text-2">{EXAMS.jsonReading}</p>
      </Card>
    );
  }
  if (!exam) {
    return (
      <Card title={EXAMS.reviewTitle}>
        <p className="text-sm text-text-2">{EXAMS.emptyTitle}</p>
      </Card>
    );
  }

  const unresolved = draft?.unresolved ?? [];
  const warnings = draft?.warnings ?? [];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-lg font-semibold text-text">{EXAMS.reviewTitle}</h1>
        <span className="text-sm text-text-2">{exam.title}</span>
        <Button size="sm" className="ms-auto" onClick={() => void confirmSave()} disabled={saving}>
          {EXAMS.reviewConfirmSave}
        </Button>
      </div>

      {/* unresolved 红框置顶 */}
      <div className="rounded-md border-2 border-danger bg-danger-soft px-3 py-2">
        <p className="text-sm font-semibold text-danger">
          {unresolved.length > 0
            ? EXAMS.reviewUnresolvedTitle(unresolved.length)
            : EXAMS.reviewNoUnresolved}
        </p>
        {unresolved.length > 0 ? (
          <ul className="mt-1 flex flex-col gap-1">
            {unresolved.map((item) => (
              <li key={`${item.lineNo}-${item.text}`}>
                <button
                  type="button"
                  onClick={() => selectUnresolvedLine(item.lineNo)}
                  className="app-tappable w-full rounded-sm border border-danger bg-surface px-2 py-1 text-left text-xs text-text"
                >
                  <span className="font-semibold text-danger">
                    {EXAMS.reviewLineOf(item.lineNo)}
                  </span>{' '}
                  {item.text}
                  <span className="ms-1 text-text-3">
                    {EXAMS.reviewUnresolvedReason}: {item.reason}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      {/* 切题告警 */}
      {warnings.length > 0 ? (
        <div className="rounded-md border border-warn px-3 py-2">
          <p className="text-sm font-semibold text-warn">{EXAMS.reviewWarningTitle}</p>
          <ul className="mt-1 list-disc pl-5 text-xs text-text">
            {warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {rawText === '' ? (
        <p className="text-sm text-text-2">{EXAMS.reviewRawMissing}</p>
      ) : null}

      {/* 移动端栏切换 */}
      <div className="tablet:hidden">
        <SegmentedControl<ReviewPane>
          ariaLabel={EXAMS.reviewTitle}
          value={pane}
          onChange={setPane}
          options={[
            { value: 'original', label: EXAMS.reviewPaneOriginal },
            { value: 'tree', label: EXAMS.reviewPaneTree },
          ]}
        />
      </div>

      {/* 双栏 / 单栏 */}
      <div className="flex flex-col gap-4 tablet:grid tablet:grid-cols-[1fr_380px] tablet:items-start">
        {/* 左：原文 */}
        <Card
          className={pane === 'original' ? '' : 'hidden tablet:block'}
          bodyClassName="max-h-[70vh] overflow-y-auto"
        >
          <div className="flex flex-col gap-0.5">
            {lines.map((line, index) => {
              const isBoundary =
                SECTION_TYPES_BY_ORDER.some((type) =>
                  SECTION_META[type].name.length > 0 && line.includes(SECTION_META[type].name),
                ) && line.length <= 80;
              const isActive = index === activeLineIndex;
              return (
                <p
                  key={index}
                  data-line={index + 1}
                  ref={(element) => {
                    lineRefs.current[index] = element;
                  }}
                  className={clsxLine(isBoundary, isActive)}
                >
                  {line === '' ? '\u00A0' : line}
                </p>
              );
            })}
          </div>
        </Card>

        {/* 右：结构树 */}
        <div className={pane === 'tree' ? '' : 'hidden tablet:block'}>
          <ParseTree
            sections={exam.sections}
            questions={questions}
            passages={passages}
            activeQuestionId={activeQuestionId}
            onSelectQuestion={selectQuestion}
            onMoveQuestion={moveQuestion}
          />
        </div>
      </div>
    </div>
  );
}

/** 行样式：区段边界高亮 / 定位行高亮 */
function clsxLine(isBoundary: boolean, isActive: boolean): string {
  const base = 'rounded-sm px-1 py-0.5 font-mono text-xs leading-relaxed text-text-2';
  if (isActive) {
    return `${base} bg-primary-soft text-text outline outline-1 outline-primary`;
  }
  if (isBoundary) {
    return `${base} bg-primary-soft font-semibold text-text`;
  }
  return base;
}
