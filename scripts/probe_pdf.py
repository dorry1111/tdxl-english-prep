"""探测大纲 PDF 的文本格式：抽样几页看排版。"""
import pdfplumber
from pathlib import Path

PDF = Path(r"C:\Users\12132\Desktop\同等学力人员申请硕士学位英语水平全国统一考试大纲（第六版）\同等学力人员申请硕士学位英语水平全国统一考试大纲（第六版）_92-314.pdf")

with pdfplumber.open(PDF) as pdf:
    print("总页数:", len(pdf.pages))
    # 抽样：第1、2、3、100、200 页（0-based）
    for idx in [0, 1, 2, 50, 100]:
        page = pdf.pages[idx]
        text = page.extract_text() or "(空)"
        print(f"\n{'='*70}\n[第 {idx+1} 页]\n{'='*70}")
        print(text[:900])
