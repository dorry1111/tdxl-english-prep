/**
 * P19 真题成绩曲线（批次 4 空壳，T20 完成）。
 */
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { EXAMS, PLACEHOLDER } from '@/constants';

export default function StatsExamsPage() {
  return (
    <div className="flex flex-col gap-4">
      <Card title={EXAMS.statsEntry}>
        <EmptyState
          icon="exams"
          title={PLACEHOLDER.building}
          description={EXAMS.statsExamsDesc}
        />
      </Card>
    </div>
  );
}
