#!/usr/bin/env python3
"""新批次（2023-2026 单文件回忆版）真题 PDF → 纯文本抽取。

从 C:/Users/12132/Desktop/英语/{2023,2024,2025,2026}.pdf 抽取文本层，
落到 data-raw/exams/<year>-exam.txt（单文件，答案内嵌，无 <<<PAGE>>> 之外的Sol）。
2026 的行方向修复在 TS 侧（scripts/build_exams.ts）处理，本脚本只按原样落盘。
幂等：可重复执行，输出只取决于 PDF 内容。
"""
import os
import re

import pypdfium2 as pdfium

SRC_DIR = r"C:/Users/12132/Desktop/英语"
OUT_DIR = os.path.join(os.path.dirname(__file__), "..", "data-raw", "exams")


def main() -> None:
    os.makedirs(OUT_DIR, exist_ok=True)
    for name in ("2023", "2024", "2025", "2026"):
        path = os.path.join(SRC_DIR, f"{name}.pdf")
        pdf = pdfium.PdfDocument(path)
        parts = []
        for i in range(len(pdf)):
            parts.append(f"<<<PAGE {i + 1}>>>")
            parts.append(pdf[i].get_textpage().get_text_bounded().replace("\r", ""))
        out = os.path.join(OUT_DIR, f"{name}-exam.txt")
        with open(out, "w", encoding="utf-8") as f:
            f.write("\n".join(parts))
        print(f"{name}: {len(pdf)} 页 -> {out}")


if __name__ == "__main__":
    main()
