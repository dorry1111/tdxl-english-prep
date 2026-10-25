# -*- coding: utf-8 -*-
"""合并脚本（A6）：sample + batch + inflections → public/data/words/memo-*.json

合并规则：
- 分片规则与 src/lib/wordbookCache.ts 的 memoLetterOf 一致：norm[0] 为 a-z 归入对应字母，
  其它归入 misc；
- 同词多来源时按「字段级合并、sample 优先」：sample（手写样例）字段覆盖 batch 字段，
  batch 未提供的字段保留；inflections 单独成字段，不参与冲突；
- 输出 {letter, version, memos} 结构，与 MemoShard 类型对应。
"""
import json
import os
import re
import glob

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MEMOS_DIR = os.path.join(ROOT, "data-raw", "memos")
WORDS_DIR = os.path.join(ROOT, "public", "data", "words")
VERSION = 1

VALID_FIELDS = {"mnemonic", "roots", "confusables", "examSenses", "inflections"}


def letter_of(norm: str) -> str:
    first = (norm or "").strip().lower()[:1]
    return first if "a" <= first <= "z" else "misc"


def clean_entry(raw: dict) -> dict:
    """只保留合法字段，字段类型做基本校验，不合法整体丢弃该字段。"""
    out = {}
    m = raw.get("mnemonic")
    if isinstance(m, str) and m.strip():
        out["mnemonic"] = m.strip()
    roots = raw.get("roots")
    if isinstance(roots, list):
        ok = [
            r for r in roots
            if isinstance(r, dict) and isinstance(r.get("type"), str)
            and isinstance(r.get("text"), str) and isinstance(r.get("meaning"), str)
        ]
        if ok:
            out["roots"] = ok
    conf = raw.get("confusables")
    if isinstance(conf, list):
        ok = [
            c for c in conf
            if isinstance(c, dict) and isinstance(c.get("word"), str) and isinstance(c.get("diff"), str)
        ]
        if ok:
            out["confusables"] = ok
    senses = raw.get("examSenses")
    if isinstance(senses, list):
        ok = [
            s for s in senses
            if isinstance(s, dict) and isinstance(s.get("pos"), str) and isinstance(s.get("cn"), str)
        ]
        if ok:
            out["examSenses"] = ok
    infl = raw.get("inflections")
    if isinstance(infl, dict):
        keys = {"plural", "third", "past", "pastParticiple", "presentParticiple", "other", "irregular"}
        ok = {k: v for k, v in infl.items() if k in keys and isinstance(v, (str, bool))}
        if ok:
            out["inflections"] = ok
    return out


def main():
    merged: dict[str, dict] = {}

    def absorb(source: str, words: dict, priority: bool):
        for norm, raw in words.items():
            if not isinstance(raw, dict):
                continue
            norm = norm.strip().lower()
            entry = clean_entry(raw)
            if not entry:
                continue
            if norm not in merged:
                merged[norm] = entry
                continue
            # 字段级合并；priority=True 时覆盖已有字段
            for k, v in entry.items():
                if priority or k not in merged[norm]:
                    merged[norm][k] = v

    stats = {"batch": 0, "sample": 0, "inflections": 0}

    # 1. batch（按文件名排序，后写不覆盖先写的同名字段——先到先得）
    for path in sorted(glob.glob(os.path.join(MEMOS_DIR, "batch-*.json"))):
        data = json.load(open(path, encoding="utf-8"))
        absorb(os.path.basename(path), data.get("words") or {}, priority=False)
        stats["batch"] += len(data.get("words") or {})

    # 2. sample 优先覆盖
    sample_path = os.path.join(MEMOS_DIR, "sample.json")
    if os.path.exists(sample_path):
        data = json.load(open(sample_path, encoding="utf-8"))
        absorb("sample", data.get("words") or {}, priority=True)
        stats["sample"] += len(data.get("words") or {})

    # 3. inflections（规则脚本生成，扁平结构 {norm: {third...}}，字段独立无冲突）
    infl_path = os.path.join(MEMOS_DIR, "inflections.json")
    if os.path.exists(infl_path):
        data = json.load(open(infl_path, encoding="utf-8"))
        infl_keys = {"plural", "third", "past", "pastParticiple",
                     "presentParticiple", "other", "irregular"}
        for norm, infl in data.items():
            if not isinstance(infl, dict):
                continue
            n = norm.strip().lower()
            ok = {k: v for k, v in infl.items()
                  if k in infl_keys and isinstance(v, (str, bool))}
            if not ok:
                continue
            merged.setdefault(n, {})["inflections"] = ok
        stats["inflections"] = len(data)

    # 4. 按字母分片输出
    shards: dict[str, dict] = {}
    for norm, entry in merged.items():
        letter = letter_of(norm)
        shards.setdefault(letter, {})[norm] = entry

    os.makedirs(WORDS_DIR, exist_ok=True)
    for letter in sorted(shards):
        out = {"letter": letter, "version": VERSION, "memos": shards[letter]}
        path = os.path.join(WORDS_DIR, f"memo-{letter}.json")
        with open(path, "w", encoding="utf-8") as f:
            json.dump(out, f, ensure_ascii=False, separators=(",", ":"))

    # 5. 统计
    total = len(merged)
    with_mnemonic = sum(1 for e in merged.values() if e.get("mnemonic"))
    with_roots = sum(1 for e in merged.values() if e.get("roots"))
    with_conf = sum(1 for e in merged.values() if e.get("confusables"))
    with_senses = sum(1 for e in merged.values() if e.get("examSenses"))
    with_infl = sum(1 for e in merged.values() if e.get("inflections"))
    print(f"merged words: {total}")
    print(f"  mnemonic {with_mnemonic} / roots {with_roots} / confusables {with_conf} / examSenses {with_senses} / inflections {with_infl}")
    print(f"  sources: {stats}")
    print(f"  shards: {len(shards)} -> memo-*.json")


if __name__ == "__main__":
    main()
