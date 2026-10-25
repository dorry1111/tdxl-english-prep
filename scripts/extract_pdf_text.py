#!/usr/bin/env python3
"""真题 PDF → 纯文本抽取（11 年管线第 1 步）。

从 C:/Users/12132/Desktop/英语/{真题,解析} 的 22 份 PDF 抽取文本层
（pypdfium2，无需 OCR），落到 data-raw/exams/<year>-{exam,sol}.txt，
每页之间插入 <<<PAGE n>>> 标记。

后续解析见 scripts/build_exams.ts（npx vite-node 运行）。
幂等：可重复执行，输出只取决于 PDF 内容。
"""
import glob
import os
import re

import pypdfium2 as pdfium

SRC = {
    "exam": r"C:/Users/12132/Desktop/英语/真题",
    "sol": r"C:/Users/12132/Desktop/英语/解析",
}
OUT_DIR = os.path.join(os.path.dirname(__file__), "..", "data-raw", "exams")


def main() -> None:
    os.makedirs(OUT_DIR, exist_ok=True)
    for kind, folder in SRC.items():
        for path in sorted(glob.glob(os.path.join(folder, "*.pdf"))):
            m = re.search(r"(\d{4})", os.path.basename(path))
            assert m, f"文件名缺少年份：{path}"
            year = m.group(1)
            pdf = pdfium.PdfDocument(path)
            parts = []
            for i in range(len(pdf)):
                parts.append(f"<<<PAGE {i}>>>")
                parts.append(pdf[i].get_textpage().get_text_bounded().replace("\r", ""))
            out = os.path.join(OUT_DIR, f"{year}-{kind}.txt")
            with open(out, "w", encoding="utf-8") as f:
                f.write("\n".join(parts))
            print(f"{year}-{kind}: {len(pdf)} 页 -> {out}")


if __name__ == "__main__":
    main()
