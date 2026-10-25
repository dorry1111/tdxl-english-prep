/**
 * 内置词库元数据（ARCHITECTURE 7.7）。
 *
 * 注意：词条正文不在这里，也不在首屏加载。词条按字母分片放在
 * `public/data/words/core-<letter>.json`，由 T08 实现按需加载。
 * 因此本文件的 `wordCount` 只是「元信息默认值」，真实词数以
 * `core-index.json` 为准（T08 会在索引加载完成后回写 WordBook.wordCount）。
 */
export const BUILTIN_BOOK_ID = 'core';
export const BUILTIN_BOOK_NAME = '考纲核心词';

/** 生词本虚拟词库 ID（seed 时创建，source = 'virtual-notebook'） */
export const NOTEBOOK_BOOK_ID = 'notebook';
export const NOTEBOOK_BOOK_NAME = '生词本';

/** 内置词库分片的字母清单（26 片） */
export const WORD_SHARD_LETTERS: readonly string[] = Array.from({ length: 26 }, (_, index) =>
  String.fromCharCode(97 + index),
);

/** 词条按首字母懒加载时的分片 URL 前缀 */
export const WORD_SHARD_URL_PREFIX = '/data/words/core-';

/** 内置词库的默认叠加优先级（数字小者优先） */
export const BUILTIN_BOOK_PRIORITY = 0;
/** 生词本虚拟库排在最后 */
export const NOTEBOOK_BOOK_PRIORITY = 99;

/**
 * 内置词库词条数默认值。
 * 数据文件尚未落地（T08），这里保持 0，避免界面显示虚构的「5500 词」。
 */
export const BUILTIN_BOOK_WORD_COUNT = 0;
