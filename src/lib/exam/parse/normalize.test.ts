import { describe, expect, it } from 'vitest';
import { normalizeText } from './normalize';

describe('normalizeText', () => {
  it('CRLF / CR 统一为 LF', () => {
    expect(normalizeText('a\r\nb\rc')).toBe('a\nb\nc');
  });

  it('全角数字与标点转半角，全角空格转普通空格', () => {
    expect(normalizeText('１２３ＡＢＣ')).toBe('123ABC');
    expect(normalizeText('（２分）')).toBe('(2分)');
    expect(normalizeText('A．xx　B．yy')).toBe('A.xx B.yy');
  });

  it('去零宽字符（ZWSP/ZWNJ/BOM 等）', () => {
    expect(normalizeText('a\u200Bb\uFEFFc\u2060d')).toBe('abcd');
  });

  it('去页眉页脚：「第 X 页」「第 X 页/共 Y 页」与纯页码行', () => {
    const text = ['正文A', '第 3 页', '3', '第 4 页/共 10 页', '正文B'].join('\n');
    expect(normalizeText(text)).toBe('正文A\n\n正文B');
  });

  it('支持自定义页眉页脚（如每页重复的口号行）', () => {
    const text = ['有志者事竟成', '正文', '有志者事竟成'].join('\n');
    expect(normalizeText(text, { extraHeaderFooter: [/^有志者事竟成$/] })).toBe('正文');
  });

  it('压缩连续 3 个以上空行为 1 个空行', () => {
    expect(normalizeText('a\n\n\n\n\nb')).toBe('a\n\nb');
  });

  it('幂等：同一文本规范化 3 次结果深度相等', () => {
    const raw = '１２３\r\n第 2 页\na\u200Bb\n\n\n\nb（３分）\n\n\n\n\nc';
    const once = normalizeText(raw);
    expect(normalizeText(normalizeText(once))).toBe(once);
    expect(normalizeText(normalizeText(normalizeText(raw)))).toBe(once);
  });

  it('统计报告：全角转换 / 零宽删除 / 页眉页脚行数', () => {
    const report = {
      fullWidthConverted: 0,
      zeroWidthRemoved: 0,
      headerFooterLines: 0,
      blankLinesCollapsed: 0,
    };
    normalizeText('ＡＢＣ\uFEFF\n第 9 页\n\n\n\nb', { report });
    expect(report.fullWidthConverted).toBe(3);
    expect(report.zeroWidthRemoved).toBe(1);
    expect(report.headerFooterLines).toBe(1);
    // 页眉占位空行 + 3 个连续空行 = 4 个空行压成 1 个
    expect(report.blankLinesCollapsed).toBe(3);
  });
});
