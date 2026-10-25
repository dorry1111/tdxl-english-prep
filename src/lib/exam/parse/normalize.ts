/**
 * 文本规范化（T12 管线第 1 步，ARCHITECTURE 4.3）。
 *
 * 纯函数、幂等：同一文本重复规范化结果深度相等。
 * 处理项（T12 任务卡）：全角→半角、CRLF→LF、去零宽字符、
 * 去页眉页脚（「第 X 页」行 / 纯页码行）、去连续 3 个以上空行。
 */

/** 零宽字符：ZWSP / ZWNJ / ZWJ / BOM / WORD JOINER */
const ZERO_WIDTH_RE = /[\u200B\u200C\u200D\uFEFF\u2060]/g;

/** 页眉页脚行：仅页码、「第 X 页」「第 X 页/共 Y 页」 */
const HEADER_FOOTER_RES: readonly RegExp[] = [
  /^第\s*\d+\s*页(?:\s*[/／]\s*共\s*\d+\s*页)?$/,
  /^\d{1,4}$/,
];

/** 可选的规范化参数 */
export interface NormalizeOptions {
  /** 额外的页眉页脚行匹配（如某些 PDF 每页重复的口号行） */
  extraHeaderFooter?: readonly RegExp[];
  /** 保留纯数字行（离线管线用：口语对话的空位号会独占一行，不能当页码删） */
  keepBareNumberLines?: boolean;
  /** 规范化统计（传入则原地填充，供质量报告用） */
  report?: NormalizeReport;
}

/** 规范化统计 */
export interface NormalizeReport {
  /** 全角转半角的字符数 */
  fullWidthConverted: number;
  /** 移除的零宽字符数 */
  zeroWidthRemoved: number;
  /** 判定为页眉页脚而删除的行数 */
  headerFooterLines: number;
  /** 被压缩掉的空行数 */
  blankLinesCollapsed: number;
}

/** 全角 ASCII（U+FF01-U+FF5E）→ 半角，全角空格（U+3000）→ 普通空格 */
function toHalfWidth(text: string, converted: { n: number }): string {
  let out = '';
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    if (code === 0x3000) {
      converted.n += 1;
      out += ' ';
    } else if (code >= 0xff01 && code <= 0xff5e) {
      converted.n += 1;
      out += String.fromCharCode(code - 0xfee0);
    } else {
      out += ch;
    }
  }
  return out;
}

/**
 * 规范化整卷粘贴文本。
 * 步骤：CRLF→LF → 去零宽 → 全角→半角 → 去页眉页脚行 → 压缩连续空行 → 去行尾空白。
 */
export function normalizeText(raw: string, options: NormalizeOptions = {}): string {
  const { extraHeaderFooter = [], keepBareNumberLines = false, report } = options;
  const converted = { n: 0 };

  // 1. CRLF / CR → LF
  let text = raw.replace(/\r\n?/g, '\n');

  // 2. 零宽字符
  const zwCount = text.match(ZERO_WIDTH_RE)?.length ?? 0;
  text = text.replace(ZERO_WIDTH_RE, '');

  // 3. 全角 → 半角
  text = toHalfWidth(text, converted);

  // 4. 逐行：去页眉页脚、去行尾空白
  const headerFooterRes = keepBareNumberLines
    ? [...extraHeaderFooter, HEADER_FOOTER_RES[0] as RegExp]
    : [...HEADER_FOOTER_RES, ...extraHeaderFooter];
  const kept: string[] = [];
  let headerFooterLines = 0;
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.length > 0 && headerFooterRes.some((re) => re.test(trimmed))) {
      headerFooterLines += 1;
      // 以空行占位：保留被页眉页脚打断的段落边界
      kept.push('');
      continue;
    }
    kept.push(line.replace(/[ \t]+$/g, ''));
  }

  // 5. 压缩连续空行：连续 ≥ 2 个空行压成 1 个空行（段落分隔符），行内空行不产生数据
  const out: string[] = [];
  let blankRun = 0;
  let blankLinesCollapsed = 0;
  for (const line of kept) {
    if (line.trim() === '') {
      blankRun += 1;
      continue;
    }
    if (blankRun > 0 && out.length > 0) {
      out.push('');
      blankLinesCollapsed += Math.max(0, blankRun - 1);
      blankRun = 0;
    } else if (blankRun > 0) {
      blankLinesCollapsed += blankRun;
      blankRun = 0;
    }
    out.push(line);
  }
  // 文末空行直接丢弃
  if (blankRun > 0) blankLinesCollapsed += blankRun;

  if (report) {
    report.fullWidthConverted = converted.n;
    report.zeroWidthRemoved = zwCount;
    report.headerFooterLines = headerFooterLines;
    report.blankLinesCollapsed = blankLinesCollapsed;
  }
  return out.join('\n');
}
