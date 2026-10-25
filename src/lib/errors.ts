/**
 * 错误类型与错误码（ARCHITECTURE 7.4）。
 *
 * 设计要点：
 * - 错误码是「唯一真源」：`ErrorCode` = `ERROR_MESSAGES` 的 key 集合，
 *   因此不可能出现「有错误码没有中文文案」的情况；
 * - 用户可见文案永不包含原始 `error.message` / stack / 英文报错；
 * - `lib/` 纯函数入参非法时抛 `AppError('INVALID_INPUT')`，业务分支用返回值表达。
 */
import { messageOfCode } from '@/constants/messages';
import type { ERROR_MESSAGES } from '@/constants/messages';

/** 合法错误码联合类型（由文案表推导） */
export type ErrorCode = keyof typeof ERROR_MESSAGES;

/** 应用内统一错误类型 */
export class AppError extends Error {
  /** 机器可读错误码 */
  readonly code: ErrorCode;

  /** 排查用细节，不展示给用户 */
  readonly detail: unknown;

  constructor(code: ErrorCode, detail?: unknown) {
    super(messageOfCode(code));
    this.name = 'AppError';
    this.code = code;
    this.detail = detail;
    // 让 instanceof 在 ES5 目标下也可靠（编译到 ES2022 后仅作保险）
    Object.setPrototypeOf(this, AppError.prototype);
  }
}

/** 判断是否为 AppError */
export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}

/** 把任意异常收敛成 AppError（保留原始信息到 detail，便于控制台排查） */
export function toAppError(error: unknown, fallback: ErrorCode = 'UNKNOWN'): AppError {
  if (isAppError(error)) {
    return error;
  }
  if (error instanceof Error) {
    return new AppError(fallback, { name: error.name, message: error.message });
  }
  return new AppError(fallback, error);
}

/**
 * 把任意异常转成可以直接展示给用户的中文文案。
 * 绝不返回原始英文错误信息。
 */
export function toUserMessage(error: unknown): string {
  if (isAppError(error)) {
    return error.message;
  }
  return messageOfCode('UNKNOWN');
}

/** 校验入参，失败直接抛 INVALID_INPUT（lib 纯函数专用） */
export function assertValid(condition: unknown, detail?: unknown): asserts condition {
  if (!condition) {
    throw new AppError('INVALID_INPUT', detail);
  }
}
