/**
 * Vitest 环境准备（ARCHITECTURE T05）。
 *
 * - `fake-indexeddb/auto`：让 Dexie 在 Node 里跑起来；
 * - `crypto.randomUUID` 垫片：老环境可能没有；
 * - 每个用例前后清库，保证用例之间互不污染。
 *
 * 说明：真正的业务算法测试在批次 2 开始写，这里只提供基础设施。
 */
import 'fake-indexeddb/auto';

import { afterEach, beforeEach } from 'vitest';

import { db } from '@/db';

// crypto.randomUUID 垫片（部分 jsdom / 老 Node 环境缺失）
if (typeof globalThis.crypto === 'undefined') {
  Object.defineProperty(globalThis, 'crypto', { value: {}, writable: true });
}
if (typeof globalThis.crypto.randomUUID !== 'function') {
  Object.defineProperty(globalThis.crypto, 'randomUUID', {
    value: () => {
      const template = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx';
      return template.replace(/[xy]/g, (char) => {
        const random = Math.floor(Math.random() * 16);
        const value = char === 'x' ? random : (random & 0x3) | 0x8;
        return value.toString(16);
      });
    },
    writable: true,
    configurable: true,
  });
}

beforeEach(async () => {
  if (!db.isOpen()) {
    await db.open();
  }
});

afterEach(async () => {
  // 逐表清空比删库更快，也避免下一次用例重新建 schema
  if (db.isOpen()) {
    await Promise.all(db.tables.map((table) => table.clear()));
  }
});
