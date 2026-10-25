# -*- coding: utf-8 -*-
"""A4 验收：memo 内容批次的 schema 校验 + 质量红线 + 覆盖度盘点。

用法：python scripts/validate_memos.py
- 遍历 data-raw/memos/{batch-*,sample}.json（含 batch-m*.json 补派文件）；
- schema：四字段类型/必填项、roots.type 合法值、norm 归一化；
- 质量红线：占位文本（TODO/待补充/xxx/…）、纯英文助记（应含中文）、
  超长助记（>240 字）、confusables 指向自身、examSenses 与已有义项完全重复；
- 覆盖度：对照 selection.json 的 3000 词目标，统计各字段覆盖率与缺失清单；
- 输出报告（不修改任何文件）。
"""
import json
import os
import re
import glob
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MEMOS_DIR = os.path.join(ROOT, "data-raw", "memos")

VALID_ROOT_TYPES = {"prefix", "root", "suffix"}
PLACEHOLDER_RE = re.compile(r"TODO|待补充|待补|placeholder|xxx+|TBD|略略略", re.IGNORECASE)
CJK_RE = re.compile(r"[\u4e00-\u9fff]")
MNEMONIC_MAX = 240

errors: list[str] = []
warnings: list[str] = []


def err(word: str, msg: str) -> None:
    errors.append(f"[{word}] {msg}")


def warn(word: str, msg: str) -> None:
    warnings.append(f"[{word}] {msg}")


def check_entry(norm: str, raw: dict, source: str, allow_inflections: bool) -> set:
    """校验单条 memo，返回该词实际拥有的字段集合。"""
    fields = set()
    if not isinstance(raw, dict):
        err(norm, f"{source}: 条目不是对象")
        return fields

    m = raw.get("mnemonic")
    if m is not None:
        if not isinstance(m, str) or not m.strip():
            err(norm, f"{source}: mnemonic 为空或非字符串")
        elif len(m) > MNEMONIC_MAX:
            warn(norm, f"{source}: mnemonic 超长 {len(m)} 字")
        elif not CJK_RE.search(m):
            warn(norm, f"{source}: mnemonic 无中文（疑似纯英文）: {m[:40]}")
        else:
            fields.add("mnemonic")
            if PLACEHOLDER_RE.search(m):
                err(norm, f"{source}: mnemonic 含占位文本: {m[:40]}")

    roots = raw.get("roots")
    if roots is not None:
        if not isinstance(roots, list) or not roots:
            err(norm, f"{source}: roots 为空列表或类型错误")
        else:
            ok = True
            for r in roots:
                if not isinstance(r, dict):
                    err(norm, f"{source}: roots 含非对象"); ok = False; break
                if r.get("type") not in VALID_ROOT_TYPES:
                    err(norm, f"{source}: roots.type 非法: {r.get('type')}"); ok = False; break
                if not isinstance(r.get("text"), str) or not r["text"].strip():
                    err(norm, f"{source}: roots.text 为空"); ok = False; break
                if not isinstance(r.get("meaning"), str) or not r["meaning"].strip():
                    err(norm, f"{source}: roots.meaning 为空"); ok = False; break
                if PLACEHOLDER_RE.search(r.get("meaning", "")):
                    err(norm, f"{source}: roots.meaning 含占位文本"); ok = False; break
            if ok:
                fields.add("roots")

    conf = raw.get("confusables")
    if conf is not None:
        if not isinstance(conf, list) or not conf:
            err(norm, f"{source}: confusables 为空列表或类型错误")
        else:
            ok = True
            for c in conf:
                if not isinstance(c, dict):
                    err(norm, f"{source}: confusables 含非对象"); ok = False; break
                w = c.get("word", "")
                if not isinstance(w, str) or not w.strip():
                    err(norm, f"{source}: confusables.word 为空"); ok = False; break
                # 大小写敏感：China（中国）与 china（瓷器）是不同词，
                # 大小写之别本身是合法考点（classic pair），不算自指
                if w.strip() == norm:
                    err(norm, f"{source}: confusables 指向自身"); ok = False; break
                if not isinstance(c.get("diff"), str) or not c["diff"].strip():
                    err(norm, f"{source}: confusables.diff 为空"); ok = False; break
                if len(c["diff"]) < 6:
                    warn(norm, f"{source}: confusables.diff 过短: {c['diff']}")
            if ok:
                fields.add("confusables")

    senses = raw.get("examSenses")
    if senses is not None:
        if not isinstance(senses, list) or not senses:
            err(norm, f"{source}: examSenses 为空列表或类型错误")
        else:
            ok = True
            for s in senses:
                if not isinstance(s, dict):
                    err(norm, f"{source}: examSenses 含非对象"); ok = False; break
                if not isinstance(s.get("pos"), str) or not s["pos"].strip():
                    err(norm, f"{source}: examSenses.pos 为空"); ok = False; break
                if not isinstance(s.get("cn"), str) or not s["cn"].strip():
                    err(norm, f"{source}: examSenses.cn 为空"); ok = False; break
                note = s.get("note")
                if note is not None and (not isinstance(note, str) or not note.strip()):
                    err(norm, f"{source}: examSenses.note 为空字符串"); ok = False; break
            if ok:
                fields.add("examSenses")

    infl = raw.get("inflections")
    if infl is not None:
        if not allow_inflections:
            err(norm, f"{source}: batch 不应含 inflections（由规则脚本统一生成）")
        elif isinstance(infl, dict):
            fields.add("inflections")

    return fields


def main() -> int:
    # ---------- 1. batch / sample 校验 ----------
    paths = sorted(
        glob.glob(os.path.join(MEMOS_DIR, "batch-*.json"))
        + [os.path.join(MEMOS_DIR, "sample.json")]
    )
    covered: dict[str, set] = {}
    all_norms: set[str] = set()
    per_file: list[tuple[str, int]] = []

    for path in paths:
        name = os.path.basename(path)
        try:
            data = json.load(open(path, encoding="utf-8"))
        except Exception as e:
            err(name, f"JSON 解析失败: {e}")
            continue
        words = data.get("words")
        if not isinstance(words, dict):
            err(name, "缺 words 对象")
            continue
        count = 0
        for norm, raw in words.items():
            n = norm.strip().lower()
            if n != norm:
                warn(norm, f"{name}: norm 未归一化（应为 {n}）")
            if n in all_norms:
                warn(norm, f"{name}: 与其它文件重复（merge 会字段级合并，可接受）")
            all_norms.add(n)
            fields = check_entry(n, raw, name, allow_inflections=(name == "sample.json"))
            if fields:
                covered.setdefault(n, set()).update(fields)
            count += 1
        per_file.append((name, count))

    # ---------- 2. 覆盖度对照 selection ----------
    sel_path = os.path.join(MEMOS_DIR, "selection.json")
    selection = json.load(open(sel_path, encoding="utf-8"))
    sel_words = selection["words"] if isinstance(selection, dict) else selection
    target_norms = [w["norm"].strip().lower() for w in sel_words]
    target_set = set(target_norms)
    missing = sorted(target_set - set(covered.keys()))
    extra = sorted(set(covered.keys()) - target_set)

    with_mnemonic = sum(1 for f in covered.values() if "mnemonic" in f)
    with_roots = sum(1 for f in covered.values() if "roots" in f)
    with_conf = sum(1 for f in covered.values() if "confusables" in f)
    with_senses = sum(1 for f in covered.values() if "examSenses" in f)

    # ---------- 3. inflections 覆盖 ----------
    infl_path = os.path.join(MEMOS_DIR, "inflections.json")
    infl_data = json.load(open(infl_path, encoding="utf-8"))
    infl_cover = sum(1 for n in target_set if n in infl_data)

    # ---------- 报告 ----------
    print("=" * 62)
    print("A4 memo 批次验收报告")
    print("=" * 62)
    print(f"\n[文件] 共 {len(per_file)} 个：")
    for name, c in per_file:
        print(f"  {name}: {c} 词")
    print(f"\n[覆盖] 目标 {len(target_set)} 词 / 已有内容 {len(covered)} 词")
    print(f"  mnemonic   {with_mnemonic:>5} ({with_mnemonic * 100 // max(1, len(covered))}%)")
    print(f"  roots      {with_roots:>5} ({with_roots * 100 // max(1, len(covered))}%)")
    print(f"  confusables{with_conf:>5} ({with_conf * 100 // max(1, len(covered))}%)")
    print(f"  examSenses {with_senses:>5} ({with_senses * 100 // max(1, len(covered))}%)")
    print(f"  inflections{infl_cover:>5} (规则脚本，目标内)")
    print(f"\n[缺失] {len(missing)} 词无任何 memo 内容")
    if missing:
        print("  " + " ".join(missing[:80]) + (" ..." if len(missing) > 80 else ""))
    if extra:
        print(f"[额外] {len(extra)} 词不在 selection（来自补派上下文，可接受）: {' '.join(extra[:40])}")

    print(f"\n[错误] {len(errors)} 条")
    for e in errors[:60]:
        print(f"  ✗ {e}")
    if len(errors) > 60:
        print(f"  ... 另有 {len(errors) - 60} 条")
    print(f"\n[警告] {len(warnings)} 条")
    for w in warnings[:40]:
        print(f"  ! {w}")
    if len(warnings) > 40:
        print(f"  ... 另有 {len(warnings) - 40} 条")

    print("\n" + ("✅ 通过：无错误" if not errors else "❌ 存在错误，需修复后 merge"))
    return 0 if not errors else 1


if __name__ == "__main__":
    sys.exit(main())
