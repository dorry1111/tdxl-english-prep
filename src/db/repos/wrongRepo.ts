/**
 * 错题本仓库（WrongItem）。
 *
 * ID 规则：`wrong:<questionId>`（ARCHITECTURE 7.6），同一题只有一条记录，
 * 重复答错只累加 `wrongCount`，不会产生重复条目。
 */
import { REMOTE_FILES } from '@/constants';
import { db, markDirty, toDbError } from '@/db';
import { now } from '@/lib/time';
import type { SectionType, WrongItem } from '@/types';

const ENTITY = REMOTE_FILES.examIndex;

/** 由题目 ID 生成错题记录 ID */
export function wrongItemIdOf(questionId: string): string {
  return `wrong:${questionId}`;
}

/**
 * 记录一道错题：不存在则新建，已存在则累加次数并复位 resolved。
 */
export async function upsertWrong(input: {
  questionId: string;
  paperId: string;
  sectionType: SectionType;
  wrongAt?: number;
}): Promise<WrongItem> {
  const stamp = input.wrongAt ?? now();
  try {
    return await db.transaction('rw', db.wrongItems, db.syncMeta, async () => {
      const id = wrongItemIdOf(input.questionId);
      const existing = await db.wrongItems.get(id);
      const next: WrongItem = existing
        ? {
            ...existing,
            wrongCount: existing.wrongCount + 1,
            lastWrongAt: stamp,
            resolved: false,
            deletedAt: null,
            updatedAt: stamp,
          }
        : {
            id,
            questionId: input.questionId,
            paperId: input.paperId,
            sectionType: input.sectionType,
            wrongCount: 1,
            lastWrongAt: stamp,
            resolved: false,
            updatedAt: stamp,
            deletedAt: null,
          };
      await db.wrongItems.put(next);
      await markDirty(ENTITY, 1);
      return next;
    });
  } catch (error) {
    throw toDbError(error);
  }
}

/**
 * 批量记录错题（交卷时一次性写入本次答错的全部题目，T14 用）。
 *
 * 单事务内逐条 upsert：不存在则新建、已存在则累加 wrongCount 并复位 resolved；
 * 全部成功或全部回滚。
 */
export async function upsertWrongMany(
  inputs: ReadonlyArray<{
    questionId: string;
    paperId: string;
    sectionType: SectionType;
    wrongAt?: number;
  }>,
): Promise<WrongItem[]> {
  if (inputs.length === 0) {
    return [];
  }
  try {
    return await db.transaction('rw', db.wrongItems, db.syncMeta, async () => {
      const results: WrongItem[] = [];
      for (const input of inputs) {
        const stamp = input.wrongAt ?? now();
        const id = wrongItemIdOf(input.questionId);
        const existing = await db.wrongItems.get(id);
        const next: WrongItem = existing
          ? {
              ...existing,
              wrongCount: existing.wrongCount + 1,
              lastWrongAt: stamp,
              resolved: false,
              deletedAt: null,
              updatedAt: stamp,
            }
          : {
              id,
              questionId: input.questionId,
              paperId: input.paperId,
              sectionType: input.sectionType,
              wrongCount: 1,
              lastWrongAt: stamp,
              resolved: false,
              updatedAt: stamp,
              deletedAt: null,
            };
        await db.wrongItems.put(next);
        results.push(next);
      }
      await markDirty(ENTITY, inputs.length);
      return results;
    });
  } catch (error) {
    throw toDbError(error);
  }
}

/** 所有待复习错题（resolved=false），按最近答错时间倒序 */
export async function listPending(): Promise<WrongItem[]> {  const rows = await db.wrongItems.toArray();
  return rows
    .filter((item) => item.deletedAt === null && !item.resolved)
    .sort((left, right) => right.lastWrongAt - left.lastWrongAt);
}

/** 按题型筛选待复习错题 */
export async function listPendingBySection(sectionType: SectionType): Promise<WrongItem[]> {
  const rows = await db.wrongItems.where('sectionType').equals(sectionType).toArray();
  return rows
    .filter((item) => item.deletedAt === null && !item.resolved)
    .sort((left, right) => right.lastWrongAt - left.lastWrongAt);
}

/** 全部错题（含已掌握，统计用） */
export async function listAll(): Promise<WrongItem[]> {
  const rows = await db.wrongItems.toArray();
  return rows
    .filter((item) => item.deletedAt === null)
    .sort((left, right) => right.lastWrongAt - left.lastWrongAt);
}

/** 标记已掌握 / 取消已掌握 */
export async function setResolved(questionId: string, resolved: boolean): Promise<void> {
  try {
    await db.transaction('rw', db.wrongItems, db.syncMeta, async () => {
      const id = wrongItemIdOf(questionId);
      const existing = await db.wrongItems.get(id);
      if (!existing) {
        return;
      }
      await db.wrongItems.put({ ...existing, resolved, updatedAt: now() });
      await markDirty(ENTITY, 1);
    });
  } catch (error) {
    throw toDbError(error);
  }
}

/** 待复习错题数（侧栏「错题本 N」） */
export async function countPending(): Promise<number> {
  const rows = await listPending();
  return rows.length;
}
