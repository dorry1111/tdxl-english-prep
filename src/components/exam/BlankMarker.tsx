/**
 * 空位标记（完形 46~55 / 口语 1~10 等）。
 *
 * 源 PDF 里空位是「一条长下划线 + 上方题号」，OCR 后只剩裸数字混在正文里，
 * 扫读时完全找不到空。这里还原成长下划线：inline-flex + 2px 下边框 + 最小宽度，
 * 数字居中浮在下划线之上；当前正在作答的空位用主题色，其余中性色。
 */
import clsx from 'clsx';

export interface BlankMarkerProps {
  /** 空位序号 */
  value: number;
  /** 是否为当前正在作答的空位（主题色高亮） */
  active?: boolean;
  className?: string;
}

export function BlankMarker({ value, active = false, className }: BlankMarkerProps) {
  return (
    <span
      data-blank={value}
      data-blank-active={active ? 'true' : 'false'}
      className={clsx(
        'mx-1 inline-flex min-w-[3.25rem] justify-center border-b-2 px-1 align-baseline font-bold tabular-nums',
        active ? 'border-primary text-primary' : 'border-text-3 text-text-2',
        className,
      )}
    >
      {value}
    </span>
  );
}
