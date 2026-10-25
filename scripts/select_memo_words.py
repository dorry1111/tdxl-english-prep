# -*- coding: utf-8 -*-
"""选词脚本：Tier B = 15 年真题文本命中词(2985) + ECDICT 词频补足到 3000。
输出 data-raw/memos/selection.json：含每词的上下文（headword/meanings/roots/examples），
供 memo 内容生成使用。纯本地运行，无外部依赖。
"""
import json
import re
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WORDS_DIR = os.path.join(ROOT, "public", "data", "words")
EXAMS_DIR = os.path.join(ROOT, "public", "data", "exams")
OUT = os.path.join(ROOT, "data-raw", "memos", "selection.json")

TARGET = 3000

def load_index():
    with open(os.path.join(WORDS_DIR, "core-index.json"), encoding="utf-8") as f:
        idx = json.load(f)
    return idx

def load_shard_words():
    """把 26 个分片的 word 对象全部读进内存（norm -> word）。"""
    words = {}
    for fn in os.listdir(WORDS_DIR):
        if re.fullmatch(r"core-[a-z]\.json", fn):
            with open(os.path.join(WORDS_DIR, fn), encoding="utf-8") as f:
                shard = json.load(f)
            for w in shard["words"]:
                words[w["norm"]] = w
    return words

def exam_text():
    chunks = []
    for fn in sorted(os.listdir(EXAMS_DIR)):
        if not re.fullmatch(r"\d{4}\.json", fn):
            continue
        with open(os.path.join(EXAMS_DIR, fn), encoding="utf-8") as f:
            d = json.load(f)
        for p in d.get("passages") or []:
            chunks.append(p.get("content") or "")
        for q in d.get("questions") or []:
            chunks.append(q.get("stem") or "")
            for o in q.get("options") or []:
                chunks.append(o.get("text") or "")
            if q.get("explanation"):
                chunks.append(q["explanation"])
    return " ".join(chunks).lower()

def main():
    idx = load_index()
    entries = idx["entries"]  # [norm, headword, sourceOrder, frequencyRank|null, shard]
    words = load_shard_words()
    text = exam_text()

    hit = set()
    for e in entries:
        norm = e[0]
        if re.search(r"\b" + re.escape(norm) + r"\b", text):
            hit.add(norm)

    selected = set(hit)
    # 词频补足：frequencyRank 升序（越小越高频），取未命中的高频词
    rest = sorted(
        (e for e in entries if e[0] not in hit and e[3] is not None),
        key=lambda e: e[3],
    )
    for e in rest:
        if len(selected) >= TARGET:
            break
        selected.add(e[0])

    out = []
    for e in entries:
        if e[0] not in selected:
            continue
        w = words[e[0]]
        meanings = [
            {"pos": m.get("pos"), "cn": m.get("cn")}
            for m in (w.get("meanings") or [])[:4]
        ]
        out.append({
            "norm": w["norm"],
            "headword": w.get("headword"),
            "frq": e[3],
            "examHit": e[0] in hit,
            "meanings": meanings,
            "roots": w.get("roots") or [],
            "hasExamples": bool(w.get("examples")),
            "mnemonic": w.get("mnemonic"),  # 已有助记的词生成时跳过该字段
        })

    out.sort(key=lambda r: (r["frq"] is None, r["frq"] if r["frq"] is not None else 0))
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump({"total": len(out), "examHit": len(hit), "words": out}, f, ensure_ascii=False, indent=1)
    print(f"selected={len(out)} examHit={len(hit)} -> {OUT}")

if __name__ == "__main__":
    main()
