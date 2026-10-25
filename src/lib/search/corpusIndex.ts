/**
 * 真题语料内存索引（P4 搜索增强）。
 *
 * - 数据源：db.passages（原文逐段切句）/ db.questions（题干、解析）/ db.exams（标题映射）；
 * - 搜索：大小写不敏感的子串匹配（英文归一小写、中文原样），命中返回整句 + 定位信息；
 * - 缓存：模块级单例，首次搜索时构建（几十份卷 ≈ 数千句，构建 <100ms）；
 *   试卷导入/删除/覆盖保存后由 examRepo 调用 invalidateCorpusIndex() 失效，
 *   下次搜索自动重建。
 *
 * 定位锚点用 questionId（内置卷确定性 ID，跨设备稳定），跳转解析页用。
 */
import { db } from '@/db';
import type { EntityId } from '@/types';

/** 一条可搜索的语料句 */
export interface CorpusSentence {
  /** 所在题目（句子都归属到题：原文句 → 关联该原文的第一题，题干/解析 → 本题） */
  questionId: EntityId;
  paperId: EntityId;
  /** 句子原文（原文句来自 passage.content，题干/解析来自 question） */
  text: string;
  /** 语料来源 */
  source: 'passage' | 'stem' | 'explanation';
}

/** 搜索命中：句子 + 试卷标题（展示用） */
export interface CorpusHit extends CorpusSentence {
  paperTitle: string;
}

/** 内部索引结构 */
interface CorpusIndex {
  sentences: CorpusSentence[];
  titleByPaper: Map<EntityId, string>;
}

let indexCache: Promise<CorpusIndex> | null = null;

/** 使索引失效（试卷导入/删除/覆盖保存后调用；下次搜索自动重建） */
export function invalidateCorpusIndex(): void {
  indexCache = null;
}

/**
 * 句子切分：先按换行切段，再切句。
 * 英文按「句末标点 + 空白」切（缩写 U.S. 不误切）；中文标点后无空格，直接切。
 */
export function splitSentences(text: string): string[] {
  const out: string[] = [];
  for (const paragraph of text.split(/\n+/)) {
    for (const sentence of paragraph.split(/(?<=[.!?])\s+|(?<=[。！？…])/)) {
      const trimmed = sentence.trim();
      if (trimmed.length > 0) {
        out.push(trimmed);
      }
    }
  }
  return out;
}

/** 最短可搜句长：太短的碎片（如 "A." 单独成句）噪音大 */
const MIN_SENTENCE_LENGTH = 6;

/** 构建索引（全量读三张表，一次性内存构建） */
async function buildIndex(): Promise<CorpusIndex> {
  const [exams, passages, questions] = await Promise.all([
    db.exams.toArray(),
    db.passages.toArray(),
    db.questions.toArray(),
  ]);

  const titleByPaper = new Map<EntityId, string>();
  /** 已删除试卷集合：其下文章/题目即便没写墓碑也一并排除 */
  const deletedPaperIds = new Set<EntityId>();
  for (const exam of exams) {
    if (exam.deletedAt === null) {
      titleByPaper.set(exam.id, exam.title);
    } else {
      deletedPaperIds.add(exam.id);
    }
  }

  const activePassages = passages.filter((row) => row.deletedAt === null);
  const activeQuestions = questions
    .filter((row) => row.deletedAt === null)
    .sort((left, right) => left.seq - right.seq);

  /** passageId → 关联的首个题目（原文句归属到该题） */
  const firstQuestionByPassage = new Map<EntityId, EntityId>();
  for (const question of activeQuestions) {
    if (question.passageId !== null && !firstQuestionByPassage.has(question.passageId)) {
      firstQuestionByPassage.set(question.passageId, question.id);
    }
  }

  const sentences: CorpusSentence[] = [];
  for (const passage of activePassages) {
    if (deletedPaperIds.has(passage.paperId)) {
      continue;
    }
    const questionId = firstQuestionByPassage.get(passage.id);
    if (questionId === undefined) {
      continue; // 没有题目关联的孤文不进索引（不可定位）
    }
    for (const text of splitSentences(passage.content)) {
      if (text.length >= MIN_SENTENCE_LENGTH) {
        sentences.push({ questionId, paperId: passage.paperId, text, source: 'passage' });
      }
    }
  }
  for (const question of activeQuestions) {
    if (deletedPaperIds.has(question.paperId)) {
      continue;
    }
    for (const text of splitSentences(question.stem)) {
      if (text.length >= MIN_SENTENCE_LENGTH) {
        sentences.push({ questionId: question.id, paperId: question.paperId, text, source: 'stem' });
      }
    }
    for (const text of splitSentences(question.explanation)) {
      if (text.length >= MIN_SENTENCE_LENGTH) {
        sentences.push({
          questionId: question.id,
          paperId: question.paperId,
          text,
          source: 'explanation',
        });
      }
    }
  }

  return { sentences, titleByPaper };
}

/** 取索引（单例；已失效则重建） */
export function loadCorpusIndex(): Promise<CorpusIndex> {
  indexCache ??= buildIndex();
  return indexCache;
}

/**
 * 真题整句搜索：大小写不敏感子串匹配。
 *
 * - 英文查询词按小写比对；中文直接比对（中文无大小写）；
 * - 排序：来源权重 passage < stem < explanation？不——按「原卷顺序」更自然：
 *   索引构建时已按 passage → 逐题（题干 → 解析）顺序追加，天然稳定；
 * - 返回上限 limit，带试卷标题（找不到标题显示兜底文案由 UI 决定）。
 */
export async function searchCorpus(query: string, limit = 10): Promise<CorpusHit[]> {
  const needle = query.trim().toLowerCase();
  if (needle.length === 0) {
    return [];
  }
  const { sentences, titleByPaper } = await loadCorpusIndex();
  const hits: CorpusHit[] = [];
  for (const sentence of sentences) {
    if (sentence.text.toLowerCase().includes(needle)) {
      hits.push({
        ...sentence,
        paperTitle: titleByPaper.get(sentence.paperId) ?? '',
      });
      if (hits.length >= limit) {
        break;
      }
    }
  }
  return hits;
}
