/**
 * P11 试卷录入（T13）：三个 Tab。
 *
 * 1. 粘贴切题：大文本框 + 字数统计 + 「自动切题」→ parsePastedPaper →
 *    硬校验通过后整卷落库（parseStatus='parsed'）→ 跳校对页；
 * 2. 手动逐题：表单 + 「保存并下一题」，草稿每次改动写 localStorage
 *    （刷新 / 中途退出不丢），「完成并保存试卷」落库为 verified；
 * 3. 导入 JSON：file input → validateExamJson 错误清单（带字段路径），
 *    全部通过才 buildExamFromJson + savePaper（不合法时零写入）。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router';

import { DEFAULT_EXAM_TIME_LIMIT_SEC, EXAMS, ROUTES, SECTION_META, SECTION_TYPES_BY_ORDER } from '@/constants';
import { MANUAL_EXAM_DRAFT_KEY } from '@/constants/storage';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { getExam, savePaper } from '@/db/repos/examRepo';
import { importExamJson } from '@/db/seed';
import { toUserMessage } from '@/lib/errors';
import { newId } from '@/lib/id';
import { parsePastedPaper } from '@/lib/exam/parse/buildDraft';
import { validateExamJson } from '@/lib/importers/examJson';
import { useParseDraftStore } from '@/store/parseDraftStore';
import { useUiStore } from '@/store/uiStore';
import type { ParsedPaperDraft, Question, SectionType } from '@/types';

type EditTab = 'paste' | 'manual' | 'json';

/** 手动录入草稿（localStorage 持久化结构） */
interface ManualDraft {
  paperTitle: string;
  /** 已保存的题目（含派生好的分值与题型） */
  saved: ManualSavedQuestion[];
}

/** 已保存的手动题（草稿与落库之间的中间形态） */
interface ManualSavedQuestion {
  seq: number;
  sectionType: SectionType;
  stem: string;
  options: Array<{ key: string; text: string }>;
  answerKey: string | null;
  referenceAnswer: string | null;
  explanation: string;
  score: number;
  /** 该题对应的原文（可空；同区段同文本归并为同一 Passage） */
  passageText: string;
}

function loadManualDraft(): ManualDraft {
  try {
    const raw = window.localStorage.getItem(MANUAL_EXAM_DRAFT_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as ManualDraft;
      if (Array.isArray(parsed.saved)) {
        return parsed;
      }
    }
  } catch {
    // 损坏即视为无草稿
  }
  return { paperTitle: '', saved: [] };
}

function saveManualDraft(draft: ManualDraft): void {
  try {
    window.localStorage.setItem(MANUAL_EXAM_DRAFT_KEY, JSON.stringify(draft));
  } catch {
    // 隐私模式等：降级为仅内存
  }
}

/** 手动录入表单的选项文本键 */
type OptionKey = 'A' | 'B' | 'C' | 'D';
const OPTION_KEYS: readonly OptionKey[] = ['A', 'B', 'C', 'D'];

const EMPTY_MANUAL_FORM = {
  sectionType: 'dialogue' as SectionType,
  stem: '',
  optionTexts: { A: '', B: '', C: '', D: '' } as Record<OptionKey, string>,
  answerKey: 'A' as OptionKey,
  referenceAnswer: '',
  explanation: '',
  score: 1,
  passageText: '',
};

export default function ExamEditPage() {
  const params = useParams<{ id: string }>();
  const paperIdParam = params.id ?? 'new';
  const isNew = paperIdParam === 'new';
  const navigate = useNavigate();
  const toastError = useUiStore((state) => state.toast.error);
  const toastSuccess = useUiStore((state) => state.toast.success);
  const setParseDraft = useParseDraftStore((state) => state.setDraft);

  const [tab, setTab] = useState<EditTab>('paste');
  const [existingTitle, setExistingTitle] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);

  // ---- Tab 1：粘贴切题 ----
  const [pastedText, setPastedText] = useState('');

  // ---- Tab 2：手动逐题 ----
  const [manualDraft, setManualDraft] = useState<ManualDraft>(() => loadManualDraft());
  const [form, setForm] = useState({ ...EMPTY_MANUAL_FORM });
  const draftRestoredRef = useRef(false);

  // ---- Tab 3：导入 JSON ----
  const [jsonErrors, setJsonErrors] = useState<string[]>([]);
  const [jsonReading, setJsonReading] = useState(false);

  useEffect(() => {
    if (isNew) {
      return;
    }
    let cancelled = false;
    void getExam(paperIdParam).then((exam) => {
      if (cancelled) {
        return;
      }
      if (!exam) {
        setMissing(true);
        return;
      }
      setExistingTitle(exam.title);
    });
    return () => {
      cancelled = true;
    };
  }, [isNew, paperIdParam]);

  // 手动草稿：仅当确有内容时提示恢复（避免每次进入都弹提示）
  useEffect(() => {
    if (draftRestoredRef.current) {
      return;
    }
    draftRestoredRef.current = true;
    const draft = loadManualDraft();
    if (draft.saved.length > 0) {
      setManualDraft(draft);
      toastSuccess(EXAMS.manualDraftRestored);
    }
  }, [toastSuccess]);

  const persistManual = useCallback((next: ManualDraft) => {
    setManualDraft(next);
    saveManualDraft(next);
  }, []);

  /** 粘贴切题：parse → 落库（parsed）→ 校对页 */
  const autoSplit = useCallback(async () => {
    if (pastedText.trim() === '') {
      return;
    }
    const { draft, validation } = parsePastedPaper(pastedText);
    if (validation.errors.length > 0) {
      toastError(EXAMS.parseFailedTitle);
      setJsonErrors(validation.errors); // 复用错误清单区域展示
      return;
    }
    try {
      const id = await saveDraftPaper(draft, isNew ? newId('paper') : paperIdParam);
      setParseDraft(id, pastedText, draft);
      navigate(ROUTES.examParseReview.replace(':id', id));
    } catch (error) {
      toastError(toUserMessage(error));
    }
  }, [isNew, navigate, paperIdParam, pastedText, setParseDraft, toastError]);

  /** 把切题草稿转成整卷并落库（questionId 按 paperId 重生成，避免 draft-qN 全局冲突） */
  async function saveDraftPaper(draft: ParsedPaperDraft, paperId: string): Promise<string> {
    const stamp = Date.now();
    const passageIdMap = new Map<string, string>();
    const passages = draft.passages.map((passage, index) => {
      const nextId = `${paperId}-p${index + 1}`;
      passageIdMap.set(passage.id, nextId);
      return {
        id: nextId,
        paperId,
        sectionType: passage.sectionType,
        order: passage.order,
        content: passage.content,
        updatedAt: stamp,
        deletedAt: null,
      };
    });
    const questions: Question[] = draft.questions.map((question) => ({
      ...question,
      id: `${paperId}-q${question.seq}`,
      paperId,
      passageId:
        question.passageId !== null ? (passageIdMap.get(question.passageId) ?? null) : null,
      updatedAt: stamp,
      deletedAt: null,
    }));
    const sections = draft.sections.map((section) => ({
      ...section,
      passageIds: passages
        .filter((passage) => passage.sectionType === section.type)
        .map((passage) => passage.id),
    }));
    const totalScore = sections.reduce((sum, section) => sum + section.score, 0);
    await savePaper(
      {
        id: paperId,
        title: draft.title,
        source: 'pasted',
        sections,
        totalQuestions: questions.length,
        totalScore,
        timeLimitSec: draft.timeLimitSec > 0 ? draft.timeLimitSec : DEFAULT_EXAM_TIME_LIMIT_SEC,
        parseStatus: 'parsed',
        createdAt: stamp,
        updatedAt: stamp,
        deletedAt: null,
      },
      passages,
      questions,
    );
    return paperId;
  }

  /** 手动逐题：保存并下一题 */
  const saveManualQuestion = useCallback(() => {
    if (form.stem.trim() === '') {
      toastError(EXAMS.manualNeedStem);
      return;
    }
    const isObjective = SECTION_META[form.sectionType].isObjective;
    const options = isObjective
      ? OPTION_KEYS.map((key) => ({ key, text: form.optionTexts[key] })).filter(
          (option) => option.text.trim() !== '',
        )
      : [];
    const answerKey = isObjective ? form.answerKey : null;
    if (isObjective && answerKey !== null && !options.some((option) => option.key === answerKey)) {
      toastError(EXAMS.manualAnswerInvalid);
      return;
    }
    const next: ManualDraft = {
      paperTitle: manualDraft.paperTitle,
      saved: [
        ...manualDraft.saved,
        {
          seq: manualDraft.saved.length + 1,
          sectionType: form.sectionType,
          stem: form.stem.trim(),
          options,
          answerKey,
          referenceAnswer: isObjective ? null : form.referenceAnswer.trim() || null,
          explanation: form.explanation.trim(),
          score: form.score,
          passageText: form.passageText.trim(),
        },
      ],
    };
    persistManual(next);
    toastSuccess(EXAMS.manualSaved(next.saved.length));
    setForm({ ...EMPTY_MANUAL_FORM });
  }, [form, manualDraft, persistManual, toastError, toastSuccess]);

  /** 手动逐题：完成并保存整卷 */
  const finishManual = useCallback(async () => {
    if (manualDraft.paperTitle.trim() === '') {
      toastError(EXAMS.manualNeedTitle);
      return;
    }
    if (manualDraft.saved.length === 0) {
      toastError(EXAMS.manualEmpty);
      return;
    }
    const paperId = isNew ? newId('paper') : paperIdParam;
    const stamp = Date.now();
    // 同区段同文本归并为一个 Passage
    const passageKeyToId = new Map<string, string>();
    const passages: Array<{
      id: string;
      paperId: string;
      sectionType: SectionType;
      order: number;
      content: string;
      updatedAt: number;
      deletedAt: null;
    }> = [];
    for (const saved of manualDraft.saved) {
      if (saved.passageText === '') {
        continue;
      }
      const key = `${saved.sectionType}::${saved.passageText}`;
      if (!passageKeyToId.has(key)) {
        const id = `${paperId}-p${passageKeyToId.size + 1}`;
        passageKeyToId.set(key, id);
        passages.push({
          id,
          paperId,
          sectionType: saved.sectionType,
          order: passageKeyToId.size,
          content: saved.passageText,
          updatedAt: stamp,
          deletedAt: null,
        });
      }
    }
    const questions: Question[] = manualDraft.saved.map((saved) => {
      const key = saved.passageText === '' ? '' : `${saved.sectionType}::${saved.passageText}`;
      return {
        id: `${paperId}-q${saved.seq}`,
        paperId,
        sectionType: saved.sectionType,
        passageId: key !== '' ? (passageKeyToId.get(key) ?? null) : null,
        seq: saved.seq,
        stem: saved.stem,
        blankIndex: null,
        options: saved.options,
        answerKey: saved.answerKey,
        referenceAnswer: saved.referenceAnswer,
        explanation: saved.explanation,
        score: saved.score,
        isObjective: SECTION_META[saved.sectionType].isObjective,
        updatedAt: stamp,
        deletedAt: null,
      };
    });
    // 区段按题型归并
    const sections = SECTION_TYPES_BY_ORDER.map((type, index) => {
      const inSection = questions.filter((question) => question.sectionType === type);
      if (inSection.length === 0) {
        return null;
      }
      return {
        type,
        order: index + 1,
        score: inSection.reduce((sum, question) => sum + question.score, 0),
        questionCount: inSection.length,
        passageIds: passages.filter((passage) => passage.sectionType === type).map((p) => p.id),
      };
    }).filter((section): section is NonNullable<typeof section> => section !== null);

    try {
      await savePaper(
        {
          id: paperId,
          title: manualDraft.paperTitle.trim(),
          source: 'manual',
          sections,
          totalQuestions: questions.length,
          totalScore: sections.reduce((sum, section) => sum + section.score, 0),
          timeLimitSec: DEFAULT_EXAM_TIME_LIMIT_SEC,
          parseStatus: 'verified', // 手动表单结构化校验过，直接可模拟
          createdAt: stamp,
          updatedAt: stamp,
          deletedAt: null,
        },
        passages,
        questions,
      );
      persistManual({ paperTitle: '', saved: [] });
      toastSuccess(EXAMS.manualSavedDone);
      navigate(ROUTES.exams);
    } catch (error) {
      toastError(toUserMessage(error));
    }
  }, [isNew, manualDraft, navigate, paperIdParam, persistManual, toastError, toastSuccess]);

  /** 导入 JSON：文件读取 → 校验 → 通过才落库 */
  const importJsonFile = useCallback(
    async (file: File) => {
      setJsonReading(true);
      setJsonErrors([]);
      try {
        const text = await file.text();
        const json: unknown = JSON.parse(text);
        const result = validateExamJson(json);
        if (!result.ok) {
          setJsonErrors(result.errors);
          toastError(EXAMS.jsonIssuesTitle);
          return;
        }
        await importExamJson(json, isNew ? {} : { paperId: paperIdParam });
        toastSuccess(EXAMS.jsonImportOk);
        navigate(ROUTES.exams);
      } catch (error) {
        setJsonErrors([toUserMessage(error)]);
        toastError(EXAMS.jsonIssuesTitle);
      } finally {
        setJsonReading(false);
      }
    },
    [isNew, navigate, paperIdParam, toastError, toastSuccess],
  );

  if (missing) {
    return (
      <Card title={EXAMS.editTitleNew}>
        <p className="text-sm text-text-2">{EXAMS.reviewRawMissing}</p>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-lg font-semibold text-text">
        {existingTitle ?? EXAMS.editTitleNew}
      </h1>

      <SegmentedControl<EditTab>
        ariaLabel={EXAMS.editTitleNew}
        value={tab}
        onChange={setTab}
        options={[
          { value: 'paste', label: EXAMS.tabPaste },
          { value: 'manual', label: EXAMS.tabManual },
          { value: 'json', label: EXAMS.tabJson },
        ]}
      />

      {/* Tab 1：粘贴切题 */}
      {tab === 'paste' ? (
        <Card title={EXAMS.tabPaste}>
          <div className="flex flex-col gap-3">
            <label htmlFor="paste-input" className="text-sm text-text-2">
              {EXAMS.pasteLabel}
            </label>
            <textarea
              id="paste-input"
              value={pastedText}
              onChange={(event) => setPastedText(event.target.value)}
              placeholder={EXAMS.pastePlaceholder}
              rows={16}
              className="w-full rounded-md border border-border bg-surface px-3 py-2 font-mono text-sm leading-relaxed text-text placeholder:text-text-3"
            />
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs text-text-3">{EXAMS.charCount(pastedText.length)}</span>
              <Button size="sm" onClick={() => void autoSplit()} disabled={pastedText.trim() === ''}>
                {EXAMS.autoSplit}
              </Button>
            </div>
            {jsonErrors.length > 0 ? (
              <div className="rounded-md border border-danger bg-danger-soft px-3 py-2">
                <p className="text-sm font-semibold text-danger">{EXAMS.parseFailedTitle}</p>
                <ul className="mt-1 list-disc pl-5 text-xs text-text">
                  {jsonErrors.map((error) => (
                    <li key={error}>{error}</li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        </Card>
      ) : null}

      {/* Tab 2：手动逐题 */}
      {tab === 'manual' ? (
        <>
          <Card title={EXAMS.manualFormTitle}>
            <div className="flex flex-col gap-3">
              <div className="flex flex-col gap-1">
                <label htmlFor="manual-title" className="text-sm text-text-2">{EXAMS.manualPaperTitleLabel}</label>
                <input
                  id="manual-title"
                  value={manualDraft.paperTitle}
                  onChange={(event) =>
                    persistManual({ ...manualDraft, paperTitle: event.target.value })
                  }
                  placeholder={EXAMS.manualPaperTitlePlaceholder}
                  className="h-11 rounded-md border border-border bg-surface px-3 text-base text-text placeholder:text-text-3"
                />
              </div>

              <div className="flex flex-col gap-1">
                <label htmlFor="manual-section" className="text-sm text-text-2">{EXAMS.manualSectionLabel}</label>
                <select
                  id="manual-section"
                  value={form.sectionType}
                  onChange={(event) => setForm({ ...form, sectionType: event.target.value as SectionType })}
                  className="h-11 rounded-md border border-border bg-surface px-3 text-base text-text"
                >
                  {SECTION_TYPES_BY_ORDER.map((type) => (
                    <option key={type} value={type}>
                      {SECTION_META[type].name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex flex-col gap-1">
                <label htmlFor="manual-stem" className="text-sm text-text-2">{EXAMS.manualStemLabel}</label>
                <textarea
                  id="manual-stem"
                  value={form.stem}
                  onChange={(event) => setForm({ ...form, stem: event.target.value })}
                  placeholder={EXAMS.manualStemPlaceholder}
                  rows={3}
                  className="w-full rounded-md border border-border bg-surface px-3 py-2 text-base text-text placeholder:text-text-3"
                />
              </div>

              {SECTION_META[form.sectionType].isObjective ? (
                <>
                  <div className="flex flex-col gap-1">
                    <span className="text-sm text-text-2">{EXAMS.manualOptionsLabel}</span>
                    {OPTION_KEYS.map((key) => (
                      <div key={key} className="flex items-center gap-2">
                        <span className="w-6 text-sm font-semibold text-text-2">{key}</span>
                        <input
                          value={form.optionTexts[key]}
                          onChange={(event) =>
                            setForm({
                              ...form,
                              optionTexts: { ...form.optionTexts, [key]: event.target.value },
                            })
                          }
                          aria-label={EXAMS.manualOptionLabel(key)}
                          className="h-11 flex-1 rounded-md border border-border bg-surface px-3 text-base text-text"
                        />
                      </div>
                    ))}
                  </div>
                  <div className="flex items-center gap-2">
                    <label htmlFor="manual-answer" className="text-sm text-text-2">{EXAMS.manualAnswerLabel}</label>
                    <select
                      id="manual-answer"
                      value={form.answerKey}
                      onChange={(event) => setForm({ ...form, answerKey: event.target.value as OptionKey })}
                      className="h-11 rounded-md border border-border bg-surface px-3 text-base text-text"
                    >
                      {OPTION_KEYS.map((key) => (
                        <option key={key} value={key}>{key}</option>
                      ))}
                    </select>
                  </div>
                </>
              ) : (
                <div className="flex flex-col gap-1">
                  <label htmlFor="manual-reference" className="text-sm text-text-2">{EXAMS.manualReferenceLabel}</label>
                  <textarea
                    id="manual-reference"
                    value={form.referenceAnswer}
                    onChange={(event) => setForm({ ...form, referenceAnswer: event.target.value })}
                    rows={3}
                    className="w-full rounded-md border border-border bg-surface px-3 py-2 text-base text-text"
                  />
                </div>
              )}

              <div className="flex flex-col gap-1">
                <label htmlFor="manual-passage" className="text-sm text-text-2">{EXAMS.manualPassageLabel}</label>
                <textarea
                  id="manual-passage"
                  value={form.passageText}
                  onChange={(event) => setForm({ ...form, passageText: event.target.value })}
                  placeholder={EXAMS.manualPassagePlaceholder}
                  rows={3}
                  className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-text placeholder:text-text-3"
                />
              </div>

              <div className="flex items-center gap-2">
                <label htmlFor="manual-score" className="text-sm text-text-2">{EXAMS.manualScoreLabel}</label>
                <input
                  id="manual-score"
                  type="number"
                  min={1}
                  max={15}
                  value={form.score}
                  onChange={(event) => setForm({ ...form, score: Math.max(1, Number(event.target.value) || 1) })}
                  className="h-11 w-20 rounded-md border border-border bg-surface px-2 text-center text-base text-text"
                />
              </div>

              <div className="flex items-center gap-2">
                <Button size="sm" onClick={saveManualQuestion}>{EXAMS.saveAndNext}</Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    persistManual({ paperTitle: manualDraft.paperTitle, saved: [] });
                    toastSuccess(EXAMS.manualDraftCleared);
                  }}
                >
                  {EXAMS.manualClearDraft}
                </Button>
              </div>
            </div>
          </Card>

          <Card title={`${EXAMS.manualSavedList}（${manualDraft.saved.length}）`}>
            {manualDraft.saved.length === 0 ? (
              <p className="text-sm text-text-3">{EXAMS.manualEmpty}</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {manualDraft.saved.map((saved) => (
                  <li key={saved.seq} className="flex items-start gap-2 rounded-md border border-border px-3 py-2">
                    <span className="w-8 shrink-0 tabular-nums text-sm font-semibold text-text-3">
                      {saved.seq}
                    </span>
                    <div className="flex-1">
                      <p className="line-clamp-2 text-sm text-text">{saved.stem}</p>
                      <p className="mt-1 text-xs text-text-3">
                        {SECTION_META[saved.sectionType].name} · {EXAMS.scoreOf(saved.score)}
                        {saved.answerKey ? ` · ${saved.answerKey}` : ''}
                      </p>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        persistManual({
                          ...manualDraft,
                          saved: manualDraft.saved
                            .filter((item) => item.seq !== saved.seq)
                            .map((item, index) => ({ ...item, seq: index + 1 })),
                        })
                      }
                    >
                      {EXAMS.manualRemove}
                    </Button>
                  </li>
                ))}
              </ul>
            )}
            <div className="mt-3">
              <Button block onClick={() => void finishManual()} disabled={manualDraft.saved.length === 0}>
                {EXAMS.manualFinish}
              </Button>
            </div>
          </Card>
        </>
      ) : null}

      {/* Tab 3：导入 JSON */}
      {tab === 'json' ? (
        <Card title={EXAMS.tabJson}>
          <div className="flex flex-col gap-3">
            <label className="app-tappable inline-flex min-h-[44px] cursor-pointer items-center justify-center rounded-md border border-border bg-surface-2 px-4 text-base font-medium text-text">
              {jsonReading ? EXAMS.jsonReading : EXAMS.jsonPickFile}
              <input
                type="file"
                accept=".json,application/json"
                className="sr-only"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) {
                    void importJsonFile(file);
                  }
                  event.target.value = '';
                }}
              />
            </label>
            {jsonErrors.length > 0 ? (
              <div className="rounded-md border border-danger bg-danger-soft px-3 py-2">
                <p className="text-sm font-semibold text-danger">{EXAMS.jsonIssuesTitle}</p>
                <ul className="mt-1 list-disc pl-5 text-xs text-text">
                  {jsonErrors.map((error) => (
                    <li key={error}>{error}</li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        </Card>
      ) : null}
    </div>
  );
}
