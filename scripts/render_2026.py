#!/usr/bin/env python3
"""渲染 2026.pdf 每页为 PNG（pypdfium2，避开与 onnxruntime 的 DLL 冲突）。
输出 data-raw/ocr/2026/pNNN.png，供 ocr_2026.py 单独进程识别。
"""
import os

import pypdfium2 as pdfium

ROOT = os.path.dirname(__file__)
PDF = "C:/Users/12132/Desktop/英语/2026.pdf"
OUT_DIR = os.path.join(ROOT, "..", "data-raw", "ocr", "2026")
SCALE = 4.0  # ~288 DPI


def main() -> None:
    os.makedirs(OUT_DIR, exist_ok=True)
    pdf = pdfium.PdfDocument(PDF)
    total = len(pdf)
    print(f"总页数 {total}，渲染中…", flush=True)
    for i in range(total):
        page = pdf[i]
        bitmap = page.render(scale=SCALE)
        pil = bitmap.to_pil()
        out = os.path.join(OUT_DIR, f"p{i + 1:03d}.png")
        pil.save(out, "PNG")
    print(f"-> {OUT_DIR}", flush=True)


if __name__ == "__main__":
    main()
