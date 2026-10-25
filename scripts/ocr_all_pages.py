"""大纲 PDF 批量 OCR。

流程：
1. PyMuPDF 把每页渲染成 300 DPI PNG（支持断点续跑：已渲染的跳过）
2. RapidOCR 逐页识别，保留每个文本块的坐标与置信度（已识别的跳过）
3. 输出 data-raw/ocr/all_pages.json：[{page, width, height, items:[{x,y,w,h,text,conf}]}]

坐标用于后续重建「左栏→右栏」的阅读顺序。
"""
import json
import re
import time
from pathlib import Path

import pymupdf
from rapidocr_onnxruntime import RapidOCR

PDF = Path(r"C:\Users\12132\Desktop\同等学力人员申请硕士学位英语水平全国统一考试大纲（第六版）\同等学力人员申请硕士学位英语水平全国统一考试大纲（第六版）_92-314.pdf")
IMG_DIR = Path("data-raw/ocr/pages")
OUT = Path("data-raw/ocr/all_pages.json")

IMG_DIR.mkdir(parents=True, exist_ok=True)


def render_all(doc) -> list[Path]:
    paths = []
    for i in range(len(doc)):
        p = IMG_DIR / f"p{i:03d}.png"
        if not p.exists():
            pix = doc[i].get_pixmap(dpi=300)
            pix.save(p)
        paths.append(p)
    return paths


def main():
    doc = pymupdf.open(PDF)
    total = len(doc)
    print(f"总页数 {total}，开始渲染…")
    t0 = time.time()
    images = render_all(doc)
    print(f"渲染完成 {len(images)} 张，用时 {time.time()-t0:.0f}s")

    engine = RapidOCR()
    pages = []
    t0 = time.time()
    for i, img in enumerate(images):
        result, _ = engine(str(img))
        items = []
        if result:
            for box, text, conf in result:
                xs = [pt[0] for pt in box]
                ys = [pt[1] for pt in box]
                items.append({
                    "x": round(min(xs)), "y": round(min(ys)),
                    "w": round(max(xs) - min(xs)), "h": round(max(ys) - min(ys)),
                    "text": text, "conf": round(float(conf), 3),
                })
        pages.append({"page": i, "width": images[i] and None, "items": items})
        if (i + 1) % 10 == 0 or i == total - 1:
            rate = (i + 1) / (time.time() - t0)
            remain = (total - i - 1) / rate if rate > 0 else 0
            print(f"[{i+1}/{total}] {rate:.2f} 页/秒，预计剩余 {remain/60:.1f} 分钟")
            # 增量落盘，防中断丢失
            OUT.write_text(json.dumps(pages, ensure_ascii=False), encoding="utf-8")

    OUT.write_text(json.dumps(pages, ensure_ascii=False), encoding="utf-8")
    print("完成，已保存", OUT)


if __name__ == "__main__":
    main()
