#!/usr/bin/env python3
"""2026 真题 OCR 文本重建（读 data-raw/ocr/2026/*.png，绕开坏文本层 + 双栏阅读顺序）。

与 extract_new_exams.py 的差异：真题 PDF 文本层局部字符镜像且行内无空格，pypdfium2
抽出的文本不可用；本脚本用 RapidOCR 识别渲染图，按「左右半版」分栏重建阅读顺序，
输出 data-raw/exams/2026-exam.txt（覆盖原文本层抽取结果）。
注：必须与渲染进程分离（pymupdf 2.0 与 onnxruntime 同进程 DLL 冲突），故渲染由
render_2026.py（pypdfium2）单独完成。幂等：结果只取决于 PNG 与 OCR 引擎。
"""
import os
import sys

from PIL import Image
from rapidocr_onnxruntime import RapidOCR

ROOT = os.path.dirname(__file__)
PNG_DIR = os.path.join(ROOT, "..", "data-raw", "ocr", "2026")
OUT = os.path.join(ROOT, "..", "data-raw", "exams", "2026-exam.txt")


def main() -> None:
    engine = RapidOCR()
    pngs = sorted(
        (f for f in os.listdir(PNG_DIR) if f.lower().endswith(".png")),
        key=lambda s: int("".join(ch for ch in s if ch.isdigit()) or 0),
    )
    print(f"共 {len(pngs)} 页，开始 OCR…", file=sys.stderr)
    out_pages: list[str] = []
    for idx, name in enumerate(pngs, start=1):
        img = Image.open(os.path.join(PNG_DIR, name))
        result, _ = engine(img)
        blocks: list[dict] = []
        if result:
            for box, text, score in result:
                xs = [p[0] for p in box]
                ys = [p[1] for p in box]
                x0, x1 = min(xs), max(xs)
                y0, y1 = min(ys), max(ys)
                cx = (x0 + x1) / 2
                blocks.append(
                    {"x0": x0, "x1": x1, "y0": y0, "y1": y1, "cx": cx, "text": text.strip()}
                )
        width = img.width
        mid = width / 2
        left = [b for b in blocks if b["cx"] < mid]
        right = [b for b in blocks if b["cx"] >= mid]

        def order(group: list[dict]) -> list[str]:
            group = sorted(group, key=lambda b: (b["y0"], b["x0"]))
            if not group:
                return []
            rows: list[list[dict]] = []
            for b in group:
                placed = False
                for row in rows:
                    ref = row[-1]
                    row_h = max(ref["y1"] - ref["y0"], 6)
                    if b["y0"] <= ref["y1"] + row_h * 0.5:
                        row.append(b)
                        placed = True
                        break
                if not placed:
                    rows.append([b])
            lines: list[str] = []
            for row in rows:
                row.sort(key=lambda b: b["x0"])
                lines.append(" ".join(b["text"] for b in row))
            return lines

        left_lines = order(left)
        right_lines = order(right)
        out_pages.append(f"<<<PAGE {idx}>>>\n" + "\n".join(left_lines + right_lines))
        print(f"  page {idx}: {len(blocks)} blocks -> {len(left_lines)}L/{len(right_lines)}R", file=sys.stderr)

    with open(OUT, "w", encoding="utf-8") as f:
        f.write("\n".join(out_pages))
    print(f"-> {OUT}", file=sys.stderr)


if __name__ == "__main__":
    main()
