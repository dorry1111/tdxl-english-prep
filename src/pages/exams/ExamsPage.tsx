/**
 * P10 试卷库（T13）。
 *
 * - 宽屏表格（标题 / 题型数 / 题数 / 总分 / 操作），移动端卡片；
 *   不展示解析状态与缺答案题数，避免列表被运营信息占位；
 * - 「开始模拟」不做状态拦截：未校对 / 缺答案的卷在组卷页开考前弹确认框；
 * - 「导入内置真题」：拉取 public/data/exams/2012..2025.json 逐套导入
 *   （importExamJson 走 PRD 8.3 校验 + savePaper 整卷事务；
 *   2023-2025 回忆版卷传 recalled 宽容校验，缺答案客观题照实落库）；
 * - 删除走软删除确认框。
 */
import { useCallback, useState } from 'react';
import { useNavigate } from 'react-router';
import { useLiveQuery } from 'dexie-react-hooks';

import { ACTIONS, EXAMS, ROUTES } from '@/constants';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Dialog } from '@/components/ui/Dialog';
import { EmptyState } from '@/components/ui/EmptyState';
import { listExams, softDeleteExam } from '@/db/repos/examRepo';
import { importExamJson } from '@/db/seed';
import { toUserMessage } from '@/lib/errors';
import { useUiStore } from '@/store/uiStore';
import type { Exam } from '@/types';

/** 内置真题年份（public/data/exams/<year>.json；2023-2025 为回忆版卷，2026 源文本不全暂不上架） */
const BUILTIN_EXAM_YEARS: readonly number[] = [
  2012, 2013, 2014, 2015, 2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025,
];

/** 2023 起为单文件回忆版（客观题允许缺答案），导入走宽容校验 */
const RECALLED_FROM_YEAR = 2023;

export default function ExamsPage() {
  const navigate = useNavigate();
  const toastError = useUiStore((state) => state.toast.error);
  const toastSuccess = useUiStore((state) => state.toast.success);

  const exams = useLiveQuery(async () => listExams(), [], undefined);
  const [importing, setImporting] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<Exam | null>(null);

  const startMock = useCallback(
    (exam: Exam) => {
      navigate(ROUTES.examStart.replace(':id', exam.id));
    },
    [navigate],
  );

  const importBuiltin = useCallback(async () => {
    setImporting(true);
    let imported = 0;
    let failed = 0;
    const base = import.meta.env.BASE_URL ?? '/';
    for (const year of BUILTIN_EXAM_YEARS) {
      try {
        const response = await fetch(`${base}data/exams/${year}.json`);
        if (!response.ok) {
          failed += 1;
          continue;
        }
        const json = (await response.json()) as unknown;
        await importExamJson(json, {
          paperId: `builtin-${year}`,
          ...(year >= RECALLED_FROM_YEAR ? { recalled: true } : {}),
        });
        imported += 1;
      } catch {
        failed += 1; // 单套失败不阻塞其余导入
      }
    }
    setImporting(false);
    if (imported === 0 && failed > 0) {
      toastError(EXAMS.importFailed);
      return;
    }
    toastSuccess(EXAMS.importDone(imported, failed));
  }, [toastError, toastSuccess]);

  const confirmDelete = useCallback(async () => {
    if (!pendingDelete) {
      return;
    }
    try {
      await softDeleteExam(pendingDelete.id);
      toastSuccess(EXAMS.deleted);
    } catch (error) {
      toastError(toUserMessage(error));
    }
    setPendingDelete(null);
  }, [pendingDelete, toastError, toastSuccess]);

  const toEdit = (exam: Exam): string => ROUTES.examEdit.replace(':id', exam.id);
  const toReview = (exam: Exam): string => ROUTES.examParseReview.replace(':id', exam.id);

  return (
    <div className="flex flex-col gap-4">
      {/* 操作区 */}
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="secondary" size="sm" onClick={() => void importBuiltin()} disabled={importing}>
          {importing ? EXAMS.importing : EXAMS.importBuiltin}
        </Button>
        <Button size="sm" onClick={() => navigate(ROUTES.examEdit.replace(':id', 'new'))}>
          {EXAMS.newPaper}
        </Button>
        <Button variant="ghost" size="sm" className="ms-auto" onClick={() => navigate(ROUTES.wrongBook)}>
          {EXAMS.wrongBookEntry}
        </Button>
      </div>

      {/* 列表 */}
      {exams === undefined ? null : exams.length === 0 ? (
        <Card>
          <EmptyState icon="exams" title={EXAMS.emptyTitle} description={EXAMS.emptyDesc} />
        </Card>
      ) : (
        <>
          {/* 宽屏表格 */}
          <Card className="hidden tablet:block" bodyClassName="p-0">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-border text-text-2">
                  <th scope="col" className="px-4 py-3 font-medium">{EXAMS.colTitle}</th>
                  <th scope="col" className="px-4 py-3 font-medium">{EXAMS.colSections}</th>
                  <th scope="col" className="px-4 py-3 font-medium">{EXAMS.colQuestions}</th>
                  <th scope="col" className="px-4 py-3 font-medium">{EXAMS.colScore}</th>
                  <th scope="col" className="px-4 py-3 font-medium">{EXAMS.colActions}</th>
                </tr>
              </thead>
              <tbody>
                {exams.map((exam) => (
                  <tr key={exam.id} className="border-b border-border last:border-b-0">
                    <td className="max-w-[280px] truncate px-4 py-3 font-medium text-text">{exam.title}</td>
                    <td className="px-4 py-3 text-text-2">{EXAMS.paperOfSections(exam.sections.length)}</td>
                    <td className="px-4 py-3 text-text-2">{EXAMS.questionCountUnit(exam.totalQuestions)}</td>
                    <td className="px-4 py-3 text-text-2">{EXAMS.scoreOf(exam.totalScore)}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1">
                        <Button variant="primary" size="sm" onClick={() => startMock(exam)}>
                          {EXAMS.startMock}
                        </Button>
                        {exam.parseStatus === 'parsed' ? (
                          <Button variant="secondary" size="sm" onClick={() => navigate(toReview(exam))}>
                            {EXAMS.reviewParse}
                          </Button>
                        ) : (
                          <Button variant="secondary" size="sm" onClick={() => navigate(toEdit(exam))}>
                            {EXAMS.editPaper}
                          </Button>
                        )}
                        <Button variant="ghost" size="sm" onClick={() => setPendingDelete(exam)}>
                          {EXAMS.deletePaper}
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>

          {/* 移动端卡片 */}
          <div className="flex flex-col gap-3 tablet:hidden">
            {exams.map((exam) => (
              <Card key={exam.id}>
                <div className="flex flex-col gap-3">
                  <h2 className="text-base font-semibold text-text">{exam.title}</h2>
                  <p className="text-sm text-text-2">
                    {EXAMS.paperOfSections(exam.sections.length)} ·{' '}
                    {EXAMS.questionCountUnit(exam.totalQuestions)} · {EXAMS.scoreOf(exam.totalScore)}
                  </p>
                  <div className="flex items-center gap-2">
                    <Button size="sm" onClick={() => startMock(exam)}>{EXAMS.startMock}</Button>
                    {exam.parseStatus === 'parsed' ? (
                      <Button variant="secondary" size="sm" onClick={() => navigate(toReview(exam))}>
                        {EXAMS.reviewParse}
                      </Button>
                    ) : (
                      <Button variant="secondary" size="sm" onClick={() => navigate(toEdit(exam))}>
                        {EXAMS.editPaper}
                      </Button>
                    )}
                    <Button variant="ghost" size="sm" onClick={() => setPendingDelete(exam)}>
                      {EXAMS.deletePaper}
                    </Button>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        </>
      )}

      {/* 删除确认 */}
      <Dialog
        open={pendingDelete !== null}
        title={EXAMS.deleteConfirmTitle}
        description={EXAMS.deleteConfirmDesc}
        onClose={() => setPendingDelete(null)}
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" size="sm" onClick={() => setPendingDelete(null)}>
              {ACTIONS.cancel}
            </Button>
            <Button variant="danger" size="sm" onClick={() => void confirmDelete()}>
              {EXAMS.deletePaper}
            </Button>
          </div>
        }
      />
    </div>
  );
}
